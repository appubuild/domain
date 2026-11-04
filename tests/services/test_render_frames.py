"""The frame plan (`services/render/frames.py`).

The invariant under test is the one `media-and-rendering.md` §7.2 promises:
**preview and export use the same recipe.** A plan is a value, so these tests
can pin the whole recipe without a decoder, a pixel or a clock — which is the
only practical way to keep a renderer honest about "the preview looked
different from the export".
"""

from __future__ import annotations

import pytest

from nova_studio.core.ident import EntityId
from nova_studio.core.temporal import Timebase
from nova_studio.domain.animation import Animatable
from nova_studio.domain.effects import EffectTarget, Transform
from nova_studio.domain.grade import ColourGrade
from nova_studio.domain.media import AssetKind, MediaAsset
from nova_studio.domain.project import FrameSize, Project, ProjectSettings
from nova_studio.domain.timeline import (
    Clip,
    ClipKind,
    Timeline,
    Track,
    TrackKind,
    Transition,
)
from nova_studio.services.effects import builtin_registry
from nova_studio.services.render import (
    DECODE_FROM_ORIGINAL,
    DecodeRequest,
    FramePlan,
    LayerPlan,
    plan_frame,
    plan_frames,
)

pytestmark = pytest.mark.unit

TB = Timebase(num=30, den=1)


def _clip(
    clip_id: str,
    *,
    start: int = 0,
    source: int = 100,
    asset_id: str = "a1",
    **over: object,
) -> Clip:
    return Clip.of(clip_id, asset_id, start_frame=start, source_frames=source, **over)  # type: ignore[arg-type]


def _track(track_id: str, *clips: Clip, **over: object) -> Track:
    return Track(track_id=track_id, kind=TrackKind.VIDEO, clips=clips, **over)  # type: ignore[arg-type]


def _timeline(*tracks: Track) -> Timeline:
    return Timeline.of(*tracks, timebase=TB)


def _project(*tracks: Track, **over: object) -> Project:
    defaults: dict[str, object] = {
        "project_id": EntityId("p1"),
        "name": "Demo",
        "settings": ProjectSettings(frame_size=FrameSize(width=1920, height=1080)),
        "timeline": _timeline(*tracks),
    }
    defaults.update(over)
    return Project(**defaults)  # type: ignore[arg-type]


def _chain(effect_type: str = "nova.saturation", effect_id: str = "e1"):
    return builtin_registry().instantiate(effect_type, effect_id).unwrap()


def _effects(effect_type: str = "nova.saturation", effect_id: str = "e1"):
    from nova_studio.domain.effects import EffectChain

    return EffectChain(effects=(_chain(effect_type, effect_id),))


def _grade(exposure: float = 1.0) -> ColourGrade:
    return ColourGrade(exposure=Animatable.constant("exposure", exposure))


class TestAnEmptyFrame:
    def test_a_frame_with_nothing_on_it_plans_as_empty(self) -> None:
        assert plan_frame(_project(_track("v1")), 0).is_empty is True

    def test_a_frame_past_the_end_plans_as_empty(self) -> None:
        """A render runs past the end of a timeline by design."""
        assert plan_frame(_project(_track("v1", _clip("c1", source=100))), 500).is_empty is True

    def test_an_empty_frame_asks_for_no_decodes(self) -> None:
        assert plan_frame(_project(_track("v1")), 0).decode_count == 0

    def test_an_empty_frame_has_no_top(self) -> None:
        assert plan_frame(_project(_track("v1")), 0).top is None

    def test_the_frame_number_travels_with_the_plan(self) -> None:
        assert plan_frame(_project(_track("v1")), 42).frame == 42

    def test_a_negative_frame_is_a_bug_in_the_caller(self) -> None:
        from nova_studio.core.errors import NovaInvariantError

        with pytest.raises(NovaInvariantError):
            plan_frame(_project(_track("v1")), -1)


class TestLayers:
    def test_one_clip_is_one_layer(self) -> None:
        plan = plan_frame(_project(_track("v1", _clip("c1"))), 0)
        assert plan.layer_count == 1

    def test_two_stacked_clips_are_two_layers(self) -> None:
        plan = plan_frame(
            _project(_track("v1", _clip("c1")), _track("v2", _clip("c2", asset_id="a2"))), 0
        )
        assert plan.layer_count == 2

    def test_layers_are_bottom_first(self) -> None:
        """Index 0 is the topmost *track*, so it is drawn last."""
        plan = plan_frame(
            _project(_track("v1", _clip("c1")), _track("v2", _clip("c2", asset_id="a2"))), 0
        )
        assert [layer.clip_id for layer in plan.layers] == ["c2", "c1"]

    def test_the_top_layer_is_the_last_one(self) -> None:
        plan = plan_frame(_project(_track("v1", _clip("c1"))), 0)
        assert plan.top.clip_id == "c1"

    def test_a_layer_carries_the_source_frame(self) -> None:
        plan = plan_frame(_project(_track("v1", _clip("c1", source=100))), 30)
        assert plan.top.source_frame == 30

    def test_a_reversed_clip_reads_from_the_other_end(self) -> None:
        plan = plan_frame(_project(_track("v1", _clip("c1", source=100, speed=-1))), 0)
        assert plan.top.source_frame == 99

    def test_a_disabled_clip_contributes_nothing(self) -> None:
        clip = _clip("c1", enabled=False)
        assert plan_frame(_project(_track("v1", clip)), 0).is_empty is True

    def test_a_hidden_track_contributes_nothing(self) -> None:
        plan = plan_frame(_project(_track("v1", _clip("c1"), hidden=True)), 0)
        assert plan.is_empty is True

    def test_a_clip_that_does_not_reach_the_frame_contributes_nothing(self) -> None:
        plan = plan_frame(_project(_track("v1", _clip("c1", source=10))), 50)
        assert plan.is_empty is True

    def test_a_layer_knows_its_track(self) -> None:
        plan = plan_frame(_project(_track("v9", _clip("c1"))), 0)
        assert plan.top.track.track_id == "v9"


class TestDecoding:
    def test_a_layer_asks_for_its_picture(self) -> None:
        assert plan_frame(_project(_track("v1", _clip("c1"))), 0).decode_count == 1

    def test_the_request_names_the_asset_and_frame(self) -> None:
        request: DecodeRequest = plan_frame(
            _project(_track("v1", _clip("c1", asset_id="a7"))), 12
        ).decodes()[0]
        assert (request.asset_id, request.source_frame) == ("a7", 12)

    def test_the_default_source_is_the_original(self) -> None:
        assert plan_frame(_project(_track("v1", _clip("c1"))), 0).decodes()[0].source == (
            DECODE_FROM_ORIGINAL
        )

    def test_a_source_can_be_chosen_per_asset(self) -> None:
        plan = plan_frame(
            _project(_track("v1", _clip("c1", asset_id="a1"))), 0, sources={"a1": "proxy"}
        )
        assert plan.decodes()[0].source == "proxy"

    def test_an_asset_with_no_choice_falls_back_to_the_default(self) -> None:
        plan = plan_frame(
            _project(_track("v1", _clip("c1", asset_id="a1"))), 0, sources={"a2": "proxy"}
        )
        assert plan.decodes()[0].source == DECODE_FROM_ORIGINAL

    def test_the_default_itself_can_be_changed(self) -> None:
        plan = plan_frame(_project(_track("v1", _clip("c1"))), 0, default_source="thumbnail")
        assert plan.decodes()[0].source == "thumbnail"

    def test_a_generated_clip_asks_for_nothing(self) -> None:
        """A colour field is drawn, not decoded."""
        clip = Clip.of("c1", "", start_frame=0, source_frames=100, kind=ClipKind.SOLID)
        plan = plan_frame(_project(_track("v1", clip)), 0)
        assert plan.decode_count == 0

    def test_two_clips_reading_one_asset_at_one_frame_are_one_read(self) -> None:
        plan = plan_frame(
            _project(_track("v1", _clip("c1", asset_id="a1")), _track("v2", _clip("c2"))), 0
        )
        assert plan.decode_count == 1

    def test_different_frames_are_different_reads(self) -> None:
        project = _project(_track("v1", _clip("c1", source=100)))
        assert len({plan.decodes()[0].key for plan in plan_frames(project, range(3))}) == 3

    def test_the_request_key_is_what_a_cache_keys_on(self) -> None:
        request = plan_frame(_project(_track("v1", _clip("c1", asset_id="a1"))), 5).decodes()[0]
        assert request.key == ("a1", 5, DECODE_FROM_ORIGINAL)


class TestWhatALayerWears:
    def test_every_layer_carries_a_transform(self) -> None:
        assert plan_frame(_project(_track("v1", _clip("c1"))), 0).top.transform is not None

    def test_the_projects_transform_is_the_one_used(self) -> None:
        moved = Transform(position=Animatable.constant("position", 120.0, 0.0))
        project = _project(_track("v1", _clip("c1"))).with_transform("c1", moved)
        assert plan_frame(project, 0).top.transform == moved

    def test_a_clip_with_no_effects_carries_no_chains(self) -> None:
        assert plan_frame(_project(_track("v1", _clip("c1"))), 0).top.effects == ()

    def test_a_clips_own_chain_is_carried(self) -> None:
        project = _project(_track("v1", _clip("c1"))).with_effects(
            EffectTarget.CLIP, "c1", _effects()
        )
        assert len(plan_frame(project, 0).top.effects) == 1

    def test_a_tracks_chain_is_carried_too(self) -> None:
        project = _project(_track("v1", _clip("c1"))).with_effects(
            EffectTarget.TRACK, "v1", _effects()
        )
        assert len(plan_frame(project, 0).top.effects) == 1

    def test_the_clips_chain_runs_before_its_tracks(self) -> None:
        """A track is the bus a clip is sent through, not another clip effect."""
        project = _project(_track("v1", _clip("c1")))
        project = project.with_effects(EffectTarget.CLIP, "c1", _effects("nova.blur", "e1"))
        project = project.with_effects(EffectTarget.TRACK, "v1", _effects("nova.glow", "e2"))
        chains = plan_frame(project, 0).top.effects
        assert [chain.effects[0].type for chain in chains] == ["nova.blur", "nova.glow"]

    def test_an_empty_chain_is_dropped_rather_than_carried(self) -> None:
        from nova_studio.domain.effects import EffectChain

        project = _project(_track("v1", _clip("c1"))).with_effects(
            EffectTarget.CLIP, "c1", EffectChain()
        )
        assert plan_frame(project, 0).top.effects == ()

    def test_a_neutral_grade_is_dropped(self) -> None:
        project = _project(_track("v1", _clip("c1"))).with_grade(
            EffectTarget.CLIP, "c1", ColourGrade()
        )
        assert plan_frame(project, 0).top.grades == ()

    def test_a_real_grade_is_carried(self) -> None:
        project = _project(_track("v1", _clip("c1"))).with_grade(EffectTarget.CLIP, "c1", _grade())
        assert len(plan_frame(project, 0).top.grades) == 1

    def test_the_clip_grade_runs_before_its_tracks(self) -> None:
        project = _project(_track("v1", _clip("c1")))
        project = project.with_grade(EffectTarget.CLIP, "c1", _grade(1.0))
        project = project.with_grade(EffectTarget.TRACK, "v1", _grade(2.0))
        assert len(plan_frame(project, 0).top.grades) == 2


class TestTheOutputStage:
    def test_an_output_chain_is_carried_on_the_frame(self) -> None:
        project = _project(_track("v1", _clip("c1"))).with_effects(
            EffectTarget.OUTPUT, "", _effects()
        )
        assert plan_frame(project, 0).output_effects is not None

    def test_no_output_chain_means_none(self) -> None:
        assert plan_frame(_project(_track("v1", _clip("c1"))), 0).output_effects is None

    def test_a_neutral_output_grade_is_not_carried(self) -> None:
        project = _project(_track("v1", _clip("c1"))).with_grade(
            EffectTarget.OUTPUT, "", ColourGrade()
        )
        assert plan_frame(project, 0).output_grade is None

    def test_a_real_output_grade_is_carried(self) -> None:
        project = _project(_track("v1", _clip("c1"))).with_grade(EffectTarget.OUTPUT, "", _grade())
        assert plan_frame(project, 0).output_grade is not None

    def test_the_output_stage_is_not_a_layer(self) -> None:
        project = _project(_track("v1", _clip("c1"))).with_effects(
            EffectTarget.OUTPUT, "", _effects()
        )
        assert plan_frame(project, 0).layer_count == 1


class TestTransitions:
    def _dissolve(self, **over: object) -> Project:
        transition = Transition(transition_id="t1", clip_id="c2", duration_frames=20, **over)  # type: ignore[arg-type]
        track = _track("v1", _clip("c1", source=100), _clip("c2", start=100, asset_id="a2"))
        return _project(replace_track_with(track, transitions=(transition,)))

    def test_a_frame_with_no_transition_carries_no_mix(self) -> None:
        assert plan_frame(self._dissolve(), 50).top.transition is None

    def test_a_transition_needs_two_pictures(self) -> None:
        """A mix is a recipe for two images; one layer cannot carry it."""
        assert plan_frame(self._dissolve(), 105).layer_count == 2

    def test_the_outgoing_layer_is_drawn_below(self) -> None:
        plan = plan_frame(self._dissolve(), 105)
        assert [layer.transition_role.value for layer in plan.layers] == ["outgoing", "incoming"]

    def test_the_incoming_clip_is_the_one_the_transition_hangs_off(self) -> None:
        """A transition on a clip's in-point is that clip's arrival."""
        assert plan_frame(self._dissolve(), 105).top.clip_id == "c2"

    def test_the_outgoing_clip_holds_its_last_frame(self) -> None:
        """It has stopped playing; the dissolve holds what was there."""
        plan = plan_frame(self._dissolve(), 105)
        assert plan.layers[0].source_frame == 99

    def test_both_layers_carry_the_same_mix(self) -> None:
        plan = plan_frame(self._dissolve(), 105)
        assert plan.layers[0].transition is plan.layers[1].transition

    def test_the_mix_progresses_across_the_window(self) -> None:
        plan = plan_frame(self._dissolve(), 105)
        assert plan.top.transition.b_opacity == pytest.approx(0.75)

    def test_a_centred_dissolve_is_symmetric_about_the_cut(self) -> None:
        """The first half is as visible as the second — the cut is the middle."""
        before = plan_frame(self._dissolve(), 95).top.transition.b_opacity
        after = plan_frame(self._dissolve(), 105).top.transition.b_opacity
        assert before == pytest.approx(0.25)
        assert after == pytest.approx(0.75)

    def test_a_dip_is_not_a_dissolve(self) -> None:
        """`fill` is the only reason dip-to-white is not the same bake."""
        from nova_studio.domain.timeline import TransitionKind

        assert (
            plan_frame(self._dissolve(kind=TransitionKind.DIP_TO_WHITE), 105).top.transition.fill
            == 1.0
        )

    def test_a_transition_at_the_head_of_a_track_has_no_partner(self) -> None:
        """It fades up from nothing, which the mix already describes."""
        transition = Transition(transition_id="t1", clip_id="c1", duration_frames=10)
        track = replace_track_with(_track("v1", _clip("c1")), transitions=(transition,))
        plan = plan_frame(_project(track), 0)
        assert plan.layer_count == 1

    def test_a_transition_on_an_out_point_reaches_forward(self) -> None:
        from nova_studio.domain.timeline import TransitionEdge

        transition = Transition(
            transition_id="t1", clip_id="c1", edge=TransitionEdge.END, duration_frames=20
        )
        track = _track("v1", _clip("c1", source=100), _clip("c2", start=100, asset_id="a2"))
        project = _project(replace_track_with(track, transitions=(transition,)))
        plan = plan_frame(project, 105)
        assert [layer.clip_id for layer in plan.layers] == ["c1", "c2"]

    def test_a_frame_outside_the_window_is_untouched(self) -> None:
        assert plan_frame(self._dissolve(), 50).layer_count == 1

    def test_a_disabled_neighbour_does_not_join_the_transition(self) -> None:
        transition = Transition(transition_id="t1", clip_id="c2", duration_frames=20)
        track = _track(
            "v1", _clip("c1", source=100, enabled=False), _clip("c2", start=100, asset_id="a2")
        )
        plan = plan_frame(_project(replace_track_with(track, transitions=(transition,))), 105)
        assert plan.layer_count == 1


def replace_track_with(track: Track, **over: object) -> Track:
    from dataclasses import replace

    return replace(track, **over)  # type: ignore[arg-type]


class TestPlanningSeveralFrames:
    def test_planning_a_range_gives_one_plan_per_frame(self) -> None:
        project = _project(_track("v1", _clip("c1", source=100)))
        assert [plan.frame for plan in plan_frames(project, range(3))] == [0, 1, 2]

    def test_planning_is_lazy(self) -> None:
        """An export plans a hundred thousand frames and holds none of them."""
        project = _project(_track("v1", _clip("c1", source=100)))
        plans = plan_frames(project, range(1_000_000))
        assert next(iter(plans)).frame == 0

    def test_plans_agree_frame_by_frame(self) -> None:
        project = _project(_track("v1", _clip("c1", source=100)))
        assert all(
            plan == plan_frame(project, frame)
            for frame, plan in enumerate(plan_frames(project, range(5)))
        )

    def test_the_plan_is_a_value(self) -> None:
        assert isinstance(plan_frame(_project(_track("v1", _clip("c1"))), 0), FramePlan)

    def test_a_layer_is_a_value(self) -> None:
        assert isinstance(plan_frame(_project(_track("v1", _clip("c1"))), 0).top, LayerPlan)

    def test_the_plan_carries_the_composition_size(self) -> None:
        assert plan_frame(_project(_track("v1", _clip("c1"))), 0).size == (1920, 1080)

    def test_an_asset_the_project_does_not_have_still_plans(self) -> None:
        """Missing media is a warning, not a refusal (ADR-0015 rule 3)."""
        project = _project(_track("v1", _clip("c1", asset_id="ghost")))
        plan = plan_frame(project, 0)
        assert plan.decode_count == 1

    def test_a_probed_asset_does_not_change_the_plan(self) -> None:
        asset = MediaAsset(asset_id=EntityId("a1"), path="/a.mp4", kind=AssetKind.VIDEO)
        project = _project(_track("v1", _clip("c1")), assets=(asset,))
        assert plan_frame(project, 0).decode_count == 1
