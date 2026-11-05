"""The compositor (`services/render/composite.py`) and the kernels behind it.

A compositor is the one stage of the render pipeline that cannot be checked by
looking at its inputs: the plan says *what* to draw, and only the pixels say
whether it was drawn. So every assertion here is made on pixels, and the frames
are small — 64×48 — because a property that needs a megapixel to demonstrate is
a property nobody can debug.

What is being pinned is what the engine promises and what a rewrite would
quietly break:

* **Geometry.** Scale, position, rotation, crop and flips land a picture where
  the transform says, and the anchor is what stays put when several of them are
  combined.
* **Order.** Layers composite bottom first and an opaque top layer hides what is
  under it — the one thing an editor must never get wrong.
* **Opacity is honest.** Half-transparent white over black is 128, not 255 and
  not 191: a blend that rounds in the wrong place is a blend that shows seams.
* **Transitions.** A dip and a dissolve differ only by `fill`, and the fill is
  what shows where neither picture does.
* **Effects run, and a missing kernel does not.** The catalogue and the kernels
  are separate artefacts, and the test that they cover the same types is the one
  that keeps a plugin-added effect from being offered and ignored.
* **Determinism.** The same frame twice is byte-identical; two different frames
  of grain are not. ADR-0002 rule 1, and the reason a render can be resumed.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import numpy as np
import pytest

from nova_studio.core.ident import EntityId
from nova_studio.core.temporal import Timebase
from nova_studio.domain.animation import Animatable
from nova_studio.domain.effects import Effect, EffectChain, EffectTarget, Transform
from nova_studio.domain.grade import ColourGrade, CurveChannel, GradeCurve, Lut
from nova_studio.domain.media import ColourMeta, ColourPrimaries, ColourSpace, FrameBuffer
from nova_studio.domain.project import FrameSize, Project, ProjectSettings
from nova_studio.domain.timeline import (
    Clip,
    ClipKind,
    Timeline,
    Track,
    TrackKind,
    Transition,
    TransitionKind,
)
from nova_studio.infra.imaging import OpenCVImageOps
from nova_studio.services.effects import builtin_registry
from nova_studio.services.render import plan_frame
from nova_studio.services.render.composite import apply_grade, composite_frame
from nova_studio.services.render.kernels import (
    KernelRegistry,
    apply_chain,
    builtin_kernels,
    kernel_types,
)

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Building frames and plans
# ---------------------------------------------------------------------------

TB = Timebase(num=30, den=1)
WIDTH, HEIGHT = 64, 48

#: The services take their pixel primitives by injection, so a test picks the
#: implementation it wants — here, the real OpenCV one.
OPS = OpenCVImageOps()


def _clip(
    clip_id: str, *, start: int = 0, source: int = 100, asset_id: str = "a1", **over: Any
) -> Clip:
    return Clip.of(clip_id, asset_id, start_frame=start, source_frames=source, **over)


def _track(track_id: str, *clips: Clip, **over: Any) -> Track:
    return Track(track_id=track_id, kind=TrackKind.VIDEO, clips=clips, **over)


def _project(*tracks: Track, **over: Any) -> Project:
    return Project(
        project_id=EntityId("p1"),
        name="Demo",
        settings=ProjectSettings(frame_size=FrameSize(width=WIDTH, height=HEIGHT)),
        timeline=Timeline.of(*tracks, timebase=TB),
        **over,
    )


def _field(value: int, channels: int = 3, size: tuple[int, int] = (WIDTH, HEIGHT)) -> FrameBuffer:
    """A flat picture of one colour, the size of the composition by default."""
    return FrameBuffer(pixels=np.full((size[1], size[0], channels), value, dtype=np.uint8))


def _pictures(plan: Any, **named: FrameBuffer) -> dict[tuple[str, int, str], FrameBuffer]:
    """Map a plan's decode requests to pictures, by asset id."""
    return {
        request.key: named[request.asset_id]
        for request in plan.decodes()
        if request.asset_id in named
    }


def _single(asset_id: str = "a1", picture: FrameBuffer | None = None, **over: Any) -> Any:
    """A one-clip project, its plan, and the pictures for it."""
    project = _project(_track("v1", _clip("c1", asset_id=asset_id)))
    project = project if not over else replace(project, **over)
    plan = plan_frame(project, 0)
    return plan, {
        request.key: picture if picture is not None else _field(200) for request in plan.decodes()
    }


def _chain(effect_type: str, effect_id: str = "e1", **params: Any) -> EffectChain:
    """One effect of a built-in type, at its defaults."""
    effect = builtin_registry().instantiate(effect_type, effect_id).unwrap()
    for name, value in params.items():
        effect = effect.with_param(
            Animatable.constant(name, *value) if isinstance(value, tuple) else value
        )
    return EffectChain(effects=(effect,))


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


class TestGeometry:
    """A layer lands where its transform says, and the anchor is what stays put."""

    def test_an_untouched_layer_arrives_unchanged(self) -> None:
        plan, pictures = _single(picture=_field(200))
        out = composite_frame(plan, pictures, ops=OPS)
        assert out.pixels.shape == (HEIGHT, WIDTH, 3)
        assert out.pixels.dtype == np.uint8
        assert int(out.pixels.mean()) == 200

    def test_a_smaller_picture_is_centred(self) -> None:
        plan, _ = _single()
        quarter = _field(255, size=(WIDTH // 2, HEIGHT // 2))
        out = composite_frame(plan, _pictures(plan, a1=quarter), ops=OPS)
        assert out.pixels[0, 0].tolist() == [0, 0, 0]
        assert out.pixels[HEIGHT // 2, WIDTH // 2].tolist() == [255, 255, 255]

    def test_scale_and_position_move_the_layer(self) -> None:
        project = _project(_track("v1", _clip("c1"))).with_transform(
            "c1",
            Transform(
                scale=Animatable.constant("scale", 0.5, 0.5),
                position=Animatable.constant("position", 16.0, 0.0),
            ),
        )
        plan = plan_frame(project, 0)
        out = composite_frame(plan, _pictures(plan, a1=_field(255)), ops=OPS)
        # A quarter of the frame, moved half a quarter to the right.
        assert out.pixels.mean() == pytest.approx(255 / 4, abs=1.0)
        assert out.pixels[HEIGHT // 2, WIDTH // 2 + 16].tolist() == [255, 255, 255]
        assert out.pixels[0, 0].tolist() == [0, 0, 0]

    def test_rotation_is_about_the_anchor(self) -> None:
        """The anchor is the point that does not move — that is what an anchor is."""
        project = _project(_track("v1", _clip("c1"))).with_transform(
            "c1",
            Transform(
                scale=Animatable.constant("scale", 0.5, 0.5),
                rotation=Animatable.constant("rotation", 90.0),
            ),
        )
        plan = plan_frame(project, 0)
        out = composite_frame(plan, _pictures(plan, a1=_field(255)), ops=OPS)
        # A quarter-frame square turned on its side: 16 wide and 32 tall, and
        # still centred.
        assert out.pixels[HEIGHT // 2, WIDTH // 2].tolist() == [255, 255, 255]
        # 24 wide and 32 tall, so a point on the long axis is outside the square
        # that was there before the turn and inside it now.
        assert out.pixels[HEIGHT // 2, WIDTH // 2 + 13].tolist() == [0, 0, 0]
        assert out.pixels[HEIGHT // 2 - 13, WIDTH // 2].tolist() == [255, 255, 255]

    def test_crop_happens_before_scaling(self) -> None:
        """A cropped-away half cannot be scaled back in."""
        project = _project(_track("v1", _clip("c1"))).with_transform(
            "c1", Transform(crop=Animatable.constant("crop", 0.5, 0.0, 0.0, 0.0))
        )
        plan = plan_frame(project, 0)
        out = composite_frame(plan, _pictures(plan, a1=_field(255)), ops=OPS)
        # Half the width survives, and it is the right half, centred in the frame.
        assert out.pixels[HEIGHT // 2, WIDTH // 2 + 15].tolist() == [255, 255, 255]
        assert out.pixels[HEIGHT // 2, 4].tolist() == [0, 0, 0]
        assert out.pixels.mean() == pytest.approx(255 / 2, abs=2.0)

    def test_flips_mirror_the_source(self) -> None:
        left = _field(0)
        left.pixels[:, WIDTH // 2 :] = 255
        project = _project(_track("v1", _clip("c1"))).with_transform("c1", Transform(flip_x=True))
        plan = plan_frame(project, 0)
        out = composite_frame(plan, _pictures(plan, a1=left), ops=OPS)
        assert out.pixels[HEIGHT // 2, 2].tolist() == [255, 255, 255]
        assert out.pixels[HEIGHT // 2, WIDTH - 3].tolist() == [0, 0, 0]

    def test_a_plan_without_a_size_is_refused(self) -> None:
        plan, pictures = _single()
        broken = replace(plan, size=(0, 0))
        with pytest.raises(Exception, match="size"):
            composite_frame(broken, pictures, ops=OPS)


# ---------------------------------------------------------------------------
# Layers
# ---------------------------------------------------------------------------


class TestLayers:
    """Bottom first, and an opaque top layer hides what is under it."""

    def _two_track_project(self) -> Project:
        return _project(
            _track("v1", _clip("c1", asset_id="a1")), _track("v2", _clip("c2", asset_id="a2"))
        )

    def test_two_layers_composite_bottom_first(self) -> None:
        """Track storage order is display order: index 0 is the topmost."""
        project = self._two_track_project()
        plan = plan_frame(project, 0)
        assert plan.layer_count == 2
        assert [layer.clip_id for layer in plan.layers] == ["c2", "c1"]
        out = composite_frame(plan, _pictures(plan, a1=_field(40), a2=_field(200)), ops=OPS)
        # v1 is above v2, so the frame is the colour of the clip on v1.
        assert int(out.pixels.mean()) == 40

    def test_a_translucent_layer_lets_the_one_below_through(self) -> None:
        """Half over black is 128, not 255 and not 191."""
        project = self._two_track_project().with_transform(
            "c1", Transform(opacity=Animatable.constant("opacity", 0.5))
        )
        plan = plan_frame(project, 0)
        out = composite_frame(plan, _pictures(plan, a1=_field(255), a2=_field(0)), ops=OPS)
        assert int(out.pixels[HEIGHT // 2, WIDTH // 2][0]) == pytest.approx(128, abs=1)

    def test_a_layer_whose_picture_is_missing_is_skipped(self) -> None:
        """One offline file must not cost the frame."""
        project = self._two_track_project()
        plan = plan_frame(project, 0)
        # v1's picture is missing, so v2's shows through where v1 would have been.
        out = composite_frame(plan, _pictures(plan, a2=_field(90)), ops=OPS)
        assert int(out.pixels.mean()) == 90

    def test_an_empty_frame_is_black(self) -> None:
        plan = plan_frame(_project(_track("v1")), 0)
        out = composite_frame(plan, {}, ops=OPS)
        assert out.pixels.shape == (HEIGHT, WIDTH, 3)
        assert int(out.pixels.max()) == 0

    def test_the_result_carries_the_colour_the_caller_asked_for(self) -> None:
        """The compositor works in the working space; the caller names it."""
        colour = ColourMeta(space=ColourSpace.BT709, primaries=ColourPrimaries.BT709)
        plan, pictures = _single()
        out = composite_frame(plan, pictures, ops=OPS, colour=colour)
        assert out.colour.space is ColourSpace.BT709


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------


class TestTransitions:
    """A mix is a recipe for two pictures; `fill` is what neither of them covers."""

    def _dissolve(self, **over: Any) -> Project:
        transition = Transition(transition_id="t1", clip_id="c2", duration_frames=20, **over)
        track = replace(
            _track("v1", _clip("c1", source=100), _clip("c2", start=100, asset_id="a2")),
            transitions=(transition,),
        )
        return _project(track)

    def test_a_dissolve_blends_the_two_pictures(self) -> None:
        project = self._dissolve()
        plan = plan_frame(project, 100)  # the midpoint: half of each
        out = composite_frame(plan, _pictures(plan, a1=_field(0), a2=_field(200)), ops=OPS)
        assert int(out.pixels.mean()) == pytest.approx(100, abs=6)

    def test_a_dip_shows_the_fill_where_neither_picture_does(self) -> None:
        """The only difference between a dip and a dissolve, and it is one number."""
        project = self._dissolve(kind=TransitionKind.DIP_TO_WHITE)
        plan = plan_frame(project, 100)
        assert plan.top.transition.fill == 1.0
        # At the midpoint both pictures are fully transparent, so what shows is
        # the fill — and the fill is white, not the black of an empty canvas.
        out = composite_frame(plan, _pictures(plan, a1=_field(0), a2=_field(0)), ops=OPS)
        assert int(out.pixels.mean()) == 255

    def test_a_dip_leaves_even_a_bright_picture_behind(self) -> None:
        """A dip-to-black at its midpoint is black, whatever the two pictures are."""
        project = self._dissolve(kind=TransitionKind.DIP_TO_BLACK)
        plan = plan_frame(project, 100)
        assert plan.top.transition.fill == 0.0
        out = composite_frame(plan, _pictures(plan, a1=_field(255), a2=_field(255)), ops=OPS)
        assert int(out.pixels.max()) == 0

    def test_a_dissolve_without_a_dip_never_goes_brighter_than_its_pictures(self) -> None:
        project = self._dissolve()
        plan = plan_frame(project, 100)
        assert plan.top.transition.fill == 0.0
        out = composite_frame(plan, _pictures(plan, a1=_field(0), a2=_field(0)), ops=OPS)
        assert int(out.pixels.max()) == 0


# ---------------------------------------------------------------------------
# Effects
# ---------------------------------------------------------------------------


class TestEffects:
    """The catalogue and the arithmetic are separate artefacts; both must line up."""

    def test_every_builtin_effect_has_a_kernel(self) -> None:
        """An effect offered and silently ignored is the failure this split invites."""
        from nova_studio.services.effects.builtins import BUILTIN_TYPES

        assert kernel_types() == BUILTIN_TYPES

    def test_a_missing_kernel_is_skipped_not_fatal(self) -> None:
        """A project that names a plugin's effect must still render (ADR-0015 r3)."""
        chain = EffectChain(effects=(Effect(effect_id="e1", type="plugin.not-installed"),))
        out = apply_chain(chain, _field(100), registry=KernelRegistry(), ops=OPS, frame=0)
        assert int(out.pixels.mean()) == 100

    def test_a_bypassed_effect_does_nothing(self) -> None:
        effect = builtin_registry().instantiate("nova.invert", "e1").unwrap()
        chain = EffectChain(effects=(replace(effect, enabled=False),))
        out = apply_chain(chain, _field(100), registry=builtin_kernels(), ops=OPS, frame=0)
        assert int(out.pixels.mean()) == 100

    def test_the_wet_dry_mix_blends_the_result_with_its_input(self) -> None:
        effect = replace(builtin_registry().instantiate("nova.invert", "e1").unwrap(), mix=0.5)
        chain = EffectChain(effects=(effect,))
        out = apply_chain(chain, _field(100), registry=builtin_kernels(), ops=OPS, frame=0)
        assert int(out.pixels.mean()) == pytest.approx(128, abs=2)

    def test_invert(self) -> None:
        out = apply_chain(
            _chain("nova.invert"), _field(60), registry=builtin_kernels(), ops=OPS, frame=0
        )
        assert int(out.pixels.mean()) == pytest.approx(195, abs=1)

    def test_saturation_to_zero_is_greyscale(self) -> None:
        pixels = np.zeros((8, 8, 3), np.uint8)
        pixels[..., 0] = 255  # pure red
        chain = _chain("nova.saturation", saturation=Animatable.constant("saturation", 0.0))
        out = apply_chain(
            chain, FrameBuffer(pixels=pixels), registry=builtin_kernels(), ops=OPS, frame=0
        )
        assert out.pixels[4, 4, 0] == out.pixels[4, 4, 1] == out.pixels[4, 4, 2]

    def test_blur_spreads_an_edge(self) -> None:
        pixels = np.zeros((32, 32, 3), np.uint8)
        pixels[:, 16:] = 255
        chain = _chain("nova.blur", radius=Animatable.constant("radius", 6.0))
        out = apply_chain(
            chain, FrameBuffer(pixels=pixels), registry=builtin_kernels(), ops=OPS, frame=0
        )
        assert out.pixels[16, 12, 0] > 0  # light has leaked to the left of the edge
        assert out.pixels[16, 20, 0] < 255  # and darkness to the right

    def test_sharpen_pushes_an_edge_apart(self) -> None:
        pixels = np.full((32, 32, 3), 128, np.uint8)
        pixels[:, 16:] = 160
        chain = _chain("nova.sharpen", amount=Animatable.constant("amount", 200.0))
        out = apply_chain(
            chain, FrameBuffer(pixels=pixels), registry=builtin_kernels(), ops=OPS, frame=0
        )
        assert out.pixels[16, 15, 0] < 128  # a dark halo below the step
        assert out.pixels[16, 16, 0] > 160  # and a bright one on it

    def test_vignette_darkens_the_corners_not_the_centre(self) -> None:
        chain = _chain("nova.vignette", amount=Animatable.constant("amount", 100.0))
        out = apply_chain(
            chain, _field(200, size=(32, 32)), registry=builtin_kernels(), ops=OPS, frame=0
        )
        assert out.pixels[16, 16, 0] == 200
        assert out.pixels[0, 0, 0] < 200

    def test_glow_lifts_the_highlights(self) -> None:
        pixels = np.zeros((32, 32, 3), np.uint8)
        pixels[8:24, 8:24] = 255
        chain = _chain("nova.glow", threshold=Animatable.constant("threshold", 40.0))
        out = apply_chain(
            chain, FrameBuffer(pixels=pixels), registry=builtin_kernels(), ops=OPS, frame=0
        )
        assert out.pixels[16, 2, 0] > 0  # light has bled outside the square

    def test_chromatic_aberration_separates_the_channels_at_the_edge(self) -> None:
        pixels = np.zeros((32, 32, 3), np.uint8)
        pixels[:, 16:] = 255
        chain = _chain("nova.chromatic-aberration", amount=Animatable.constant("amount", 8.0))
        out = apply_chain(
            chain, FrameBuffer(pixels=pixels), registry=builtin_kernels(), ops=OPS, frame=0
        )
        # At the edge, red has been scaled out and blue in: the two no longer
        # arrive at the same pixel.
        assert out.pixels[16, 16, 0] < out.pixels[16, 16, 2]

    def test_grain_is_the_same_noise_twice_and_different_noise_later(self) -> None:
        """ADR-0002 rule 1: reproducible, but it crawls like film."""
        chain = _chain("nova.film-grain", amount=Animatable.constant("amount", 60.0))
        first = apply_chain(chain, _field(120), registry=builtin_kernels(), ops=OPS, frame=0)
        again = apply_chain(chain, _field(120), registry=builtin_kernels(), ops=OPS, frame=0)
        later = apply_chain(chain, _field(120), registry=builtin_kernels(), ops=OPS, frame=7)
        assert np.array_equal(first.pixels, again.pixels)
        assert not np.array_equal(first.pixels, later.pixels)

    def test_a_generator_makes_a_picture_from_nothing(self) -> None:
        """`nova.solid` is why a clip with no file still renders."""
        solid = _chain("nova.solid", colour=(1.0, 1.0, 1.0))
        out = apply_chain(solid, _field(0), registry=builtin_kernels(), ops=OPS, frame=0)
        assert int(out.pixels.mean()) == 255

    def test_a_generated_clip_renders_without_a_picture(self) -> None:
        clip = _clip("c1", kind=ClipKind.SOLID)
        project = _project(_track("v1", clip)).with_effects(
            EffectTarget.CLIP, "c1", _chain("nova.solid", colour=(0.0, 1.0, 0.0))
        )
        plan = plan_frame(project, 0)
        assert plan.decodes() == ()
        out = composite_frame(plan, {}, ops=OPS)
        assert out.pixels[HEIGHT // 2, WIDTH // 2].tolist() == [0, 255, 0]

    def test_registering_a_kernel_replaces_one(self) -> None:
        """How a plugin ships a faster implementation of a built-in."""
        registry = builtin_kernels().register("nova.invert", lambda pixels, params, **_: pixels)
        out = apply_chain(_chain("nova.invert"), _field(60), registry=registry, ops=OPS, frame=0)
        assert int(out.pixels.mean()) == 60
        assert builtin_kernels().has("nova.invert")

    def test_a_layer_effect_runs_before_the_layer_is_placed(self) -> None:
        """An effect on a clip is an effect on that clip, not on the frame."""
        project = _project(_track("v1", _clip("c1"))).with_effects(
            EffectTarget.CLIP, "c1", _chain("nova.invert")
        )
        plan = plan_frame(project, 0)
        out = composite_frame(plan, _pictures(plan, a1=_field(60)), ops=OPS)
        assert int(out.pixels.mean()) == pytest.approx(195, abs=1)


# ---------------------------------------------------------------------------
# Grades
# ---------------------------------------------------------------------------


class TestGrades:
    """Colour runs last, and a neutral grade costs nothing."""

    def test_a_neutral_grade_returns_the_same_picture(self) -> None:
        buffer = _field(120)
        out = apply_grade(ColourGrade().at(0), buffer)
        assert out is buffer

    def test_exposure_doubles_the_light(self) -> None:
        grade = ColourGrade(exposure=Animatable.constant("exposure", 1.0))
        out = apply_grade(grade.at(0), _field(60))
        assert int(out.pixels.mean()) == pytest.approx(120, abs=1)

    def test_saturation_pulls_the_colour_out(self) -> None:
        pixels = np.zeros((8, 8, 3), np.uint8)
        pixels[..., 0] = 255
        grade = ColourGrade(saturation=Animatable.constant("saturation", -1.0))
        out = apply_grade(grade.at(0), FrameBuffer(pixels=pixels))
        assert out.pixels[4, 4, 0] == out.pixels[4, 4, 1]

    def test_lift_raises_the_blacks(self) -> None:
        grade = ColourGrade(lift=Animatable.constant("lift", 0.25, 0.25, 0.25))
        out = apply_grade(grade.at(0), _field(0))
        assert int(out.pixels.mean()) == pytest.approx(64, abs=1)

    def test_a_curve_bends_only_the_channel_it_names(self) -> None:
        curve = GradeCurve(channel=CurveChannel.RED, points=((0.0, 0.0), (1.0, 0.5)))
        pixels = np.zeros((8, 8, 3), np.uint8)
        pixels[..., 0] = 200
        pixels[..., 1] = 200
        out = apply_grade(ColourGrade(curves=(curve,)).at(0), FrameBuffer(pixels=pixels))
        assert out.pixels[4, 4, 0] < out.pixels[4, 4, 1]

    def test_a_lut_is_applied_when_a_reader_is_given(self) -> None:
        """A 17³ identity table leaves the picture alone; a reader is injected, not assumed."""
        size = 17
        axis = np.linspace(0.0, 1.0, size, dtype=np.float32)
        table = np.stack(np.meshgrid(axis, axis, axis, indexing="ij"), axis=-1)
        grade = ColourGrade(lut=Lut(lut_id="l1", name="identity", size=size))
        out = apply_grade(grade.at(0), _field(120), luts=lambda _lut: table)
        assert int(out.pixels.mean()) == pytest.approx(120, abs=1)

    def test_a_lut_with_no_reader_is_refused(self) -> None:
        """Silently ignoring it would deliver a file with the wrong look in it."""
        grade = ColourGrade(lut=Lut(lut_id="l2", name="print-film"))
        with pytest.raises(Exception, match="LUT"):
            apply_grade(grade.at(0), _field(120))

    def test_the_output_grade_runs_over_the_composited_frame(self) -> None:
        """The look of the film belongs to the frame, not to a clip in it."""
        project = _project(_track("v1", _clip("c1"))).with_grade(
            EffectTarget.OUTPUT, "", ColourGrade(exposure=Animatable.constant("exposure", 1.0))
        )
        plan = plan_frame(project, 0)
        out = composite_frame(plan, _pictures(plan, a1=_field(50)), ops=OPS)
        assert int(out.pixels.mean()) == pytest.approx(100, abs=1)


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_the_same_frame_twice_is_the_same_bytes() -> None:
    """ADR-0002 rule 1, in the one place a render could smuggle in a clock."""
    plan, pictures = _single(picture=_field(123))
    first = composite_frame(plan, pictures, ops=OPS)
    second = composite_frame(plan, pictures, ops=OPS)
    assert np.array_equal(first.pixels, second.pixels)


def test_a_frame_accepts_one_and_four_channel_pictures() -> None:
    """A mask and an RGBA title are both legal sources; the result is opaque RGB."""
    plan, _ = _single()
    pictures = _pictures(plan, a1=_field(200, channels=1))
    out = composite_frame(plan, pictures, ops=OPS)
    assert out.pixels.shape[2] == 3
    assert int(out.pixels.mean()) == 200


def test_a_four_channel_source_is_flattened_over_black() -> None:
    """Video has no alpha to carry, so a transparent title card is black behind."""
    pixels = np.zeros((HEIGHT, WIDTH, 4), np.uint8)
    pixels[..., :3] = 200
    plan, _ = _single()
    out = composite_frame(plan, _pictures(plan, a1=FrameBuffer(pixels=pixels)), ops=OPS)
    assert int(out.pixels.mean()) == 0
