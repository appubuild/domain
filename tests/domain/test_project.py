"""The project aggregate root (`domain/project.py`).

This module is where the parts of a project meet, so this is where the tests
that need more than one part live.  What is pinned here is the behaviour a user
would describe as "the app lost my work":

* **A damaged project still opens.**  A clip pointing at an asset the bin does
  not hold, an effect bound to a clip that was deleted, a caption filed under a
  name that would escape the archive — each is *reported* by
  ``validate_project`` and none of them is raised at construction.  An editor
  that refuses to open a broken project is an editor that loses work
  (ADR-0015 rule 3).
* **Deleting a clip takes its looks with it.**  Bindings live on the project
  keyed by the owner's id, so ``with_timeline`` prunes them in one pass rather
  than leaving an effect attached to nothing.
* **Untouched things are not stored.**  An empty chain, an identity transform,
  an empty mask list and a ``NORMAL`` blend all *remove* their binding, so a
  project the user has never decorated carries no bindings at all.
* **One timebase.**  The project reads it from the timeline and never keeps a
  second copy that could disagree with the edit it describes.
* **Nothing here touches a disk.**  Timestamps are passed in, so a save is
  reproducible to the millisecond.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from nova_studio.core import NovaInvariantError
from nova_studio.core.ident import EntityId
from nova_studio.core.temporal import Timebase
from nova_studio.domain.animation import Animatable, Keyframe
from nova_studio.domain.captions import CaptionDocument, CaptionSegment
from nova_studio.domain.effects import (
    BlendMode,
    Effect,
    EffectChain,
    EffectSpec,
    EffectTarget,
    Mask,
    MaskKind,
    ParameterSpec,
    ParamKind,
    Transform,
)
from nova_studio.domain.grade import ColourGrade, GradeCurve, Lut
from nova_studio.domain.media import (
    AssetKind,
    ContentHash,
    MediaAsset,
    MediaInfo,
    VideoStreamInfo,
)
from nova_studio.domain.persistence import caption_document
from nova_studio.domain.project import (
    DEFAULT_CHANNELS,
    DEFAULT_FRAME_HEIGHT,
    DEFAULT_FRAME_WIDTH,
    DEFAULT_SAMPLE_RATE,
    PROJECT_DOCUMENT_FIELDS,
    SUPPORTED_CHANNEL_COUNTS,
    BlendBinding,
    CaptionDocumentRef,
    EffectBinding,
    FrameSize,
    GradeBinding,
    MaskBinding,
    Project,
    ProjectDocuments,
    ProjectMetadata,
    ProjectSettings,
    TransformBinding,
    validate_project,
)
from nova_studio.domain.timeline import (
    DEFAULT_TIMEBASE,
    Clip,
    ClipKind,
    Timeline,
    Track,
    TrackKind,
)

pytestmark = pytest.mark.unit

HASH = "ab" * 32


# -- builders -----------------------------------------------------------------


def _asset(asset_id: str = "a1", path: str = "/media/clip.mp4", **over: Any) -> MediaAsset:
    return MediaAsset(asset_id=EntityId(asset_id), path=path, kind=AssetKind.VIDEO, **over)


def _clip(
    clip_id: str = "c1",
    asset_id: str = "a1",
    start_frame: int = 0,
    source_frames: int = 100,
    **over: Any,
) -> Clip:
    return Clip.of(clip_id, asset_id, start_frame=start_frame, source_frames=source_frames, **over)


def _track(track_id: str = "v1", *clips: Clip, **over: Any) -> Track:
    return Track(**{"track_id": track_id, "kind": TrackKind.VIDEO, "clips": clips, **over})


def _timeline(*tracks: Track, timebase: Timebase = DEFAULT_TIMEBASE) -> Timeline:
    return Timeline.of(*tracks, timebase=timebase)


def _spec(type_name: str = "nova.blur") -> EffectSpec:
    return EffectSpec(
        type=type_name,
        label="Blur",
        parameters=(
            ParameterSpec(name="radius", label="Radius", kind=ParamKind.SCALAR, default=(4.0,)),
        ),
    )


def _chain(effect_id: str = "e1", type_name: str = "nova.blur") -> EffectChain:
    return EffectChain(effects=(Effect.for_spec(effect_id, _spec(type_name)),))


def _transform(x: float = 24.0) -> Transform:
    """A transform that is *not* the identity, so a binding survives."""
    return Transform(position=Animatable.constant("position", x, 0.0))


def _mask(mask_id: str = "m1", **over: Any) -> Mask:
    return Mask(**{"mask_id": mask_id, **over})


def _video_info() -> MediaInfo:
    return MediaInfo(
        kind=AssetKind.VIDEO,
        duration_seconds=4.0,
        video=(
            VideoStreamInfo(
                codec_name="h264",
                width=1920,
                height=1080,
                timebase=Timebase.of(30),
                frame_count=120,
            ),
        ),
    )


def _grade(**over: Any) -> ColourGrade:
    """A grade that is *not* neutral, so a binding survives."""
    return ColourGrade(**{"exposure": Animatable.constant("exposure", 1.0), **over})


def _segment(index: int = 0, start_ms: int = 0, end_ms: int = 1_000, text: str = "hello"):
    return CaptionSegment(index=index, start_ms=start_ms, end_ms=end_ms, text=text)


def _document(document_id: str = "doc-1") -> CaptionDocument:
    return CaptionDocument(
        segments=(_segment(),), language="en" if document_id == "doc-1" else "bn"
    )


def _ref(document_id: str = "doc-1") -> CaptionDocumentRef:
    return CaptionDocumentRef(document_id=document_id, document=_document(document_id))


def _project(**over: Any) -> Project:
    """A project that validates: one asset, one clip that uses it."""
    defaults: dict[str, Any] = {
        "project_id": EntityId("p1"),
        "name": "Demo",
        "assets": (_asset("a1"),),
        "timeline": _timeline(_track("v1", _clip("c1", "a1"))),
    }
    return Project(**{**defaults, **over})


def _round_trip(wire: object) -> object:
    """JSON in and out, which is what the project file does."""
    return json.loads(json.dumps(wire))


class TestFrameSize:
    def test_1080p_is_the_default(self) -> None:
        assert (FrameSize().width, FrameSize().height) == (
            DEFAULT_FRAME_WIDTH,
            DEFAULT_FRAME_HEIGHT,
        )

    def test_the_aspect_ratio_is_width_over_height(self) -> None:
        assert FrameSize(width=1920, height=1080).aspect_ratio == pytest.approx(16 / 9)

    def test_a_vertical_frame_has_a_ratio_below_one(self) -> None:
        assert FrameSize(width=1080, height=1920).aspect_ratio == pytest.approx(0.5625)

    def test_a_zero_dimension_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must be positive"):
            FrameSize(width=0, height=1080)

    def test_a_negative_dimension_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must be positive"):
            FrameSize(width=1920, height=-1080)

    def test_even_dimensions_are_even(self) -> None:
        assert FrameSize(width=1920, height=1080).is_even is True

    def test_an_odd_dimension_is_not_even(self) -> None:
        """Every 4:2:0 encoder we ship needs even dimensions."""
        assert FrameSize(width=1919, height=1080).is_even is False

    def test_the_wire_form_is_two_numbers(self) -> None:
        assert FrameSize(width=1280, height=720).to_wire() == {"width": 1280, "height": 720}

    def test_the_wire_form_survives_a_round_trip(self) -> None:
        size = FrameSize(width=1280, height=720)
        assert FrameSize.from_wire(_round_trip(size.to_wire())) == size

    def test_an_unknown_wire_field_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            FrameSize.from_wire(dict(FrameSize().to_wire(), depth=8))


class TestProjectMetadata:
    def test_the_defaults_are_empty(self) -> None:
        metadata = ProjectMetadata()
        assert (metadata.author, metadata.tags, metadata.created_ms) == ("", (), 0)

    def test_a_negative_created_timestamp_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must not be negative"):
            ProjectMetadata(created_ms=-1)

    def test_a_modification_before_the_creation_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must not precede created_ms"):
            ProjectMetadata(created_ms=100, modified_ms=50)

    def test_the_same_timestamp_twice_is_allowed(self) -> None:
        assert ProjectMetadata(created_ms=100, modified_ms=100).modified_ms == 100

    def test_an_empty_tag_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must not be empty"):
            ProjectMetadata(tags=("colour", ""))

    def test_a_repeated_tag_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="appears twice"):
            ProjectMetadata(tags=("colour", "colour"))

    def test_touching_records_a_later_save(self) -> None:
        assert ProjectMetadata().touched(5_000).modified_ms == 5_000

    def test_touching_refuses_to_move_backwards(self) -> None:
        with pytest.raises(NovaInvariantError, match="cannot move modified_ms backwards"):
            ProjectMetadata(modified_ms=5_000).touched(4_000)

    def test_touching_to_the_same_instant_is_allowed(self) -> None:
        assert ProjectMetadata(modified_ms=5_000).touched(5_000).modified_ms == 5_000

    def test_touching_leaves_the_creation_alone(self) -> None:
        touched = ProjectMetadata(created_ms=1_000, modified_ms=2_000).touched(3_000)
        assert (touched.created_ms, touched.modified_ms) == (1_000, 3_000)

    def test_touching_does_not_mutate_the_original(self) -> None:
        metadata = ProjectMetadata()
        metadata.touched(5_000)
        assert metadata.modified_ms == 0

    def test_the_wire_form_survives_a_round_trip(self) -> None:
        metadata = ProjectMetadata(
            author="Sam", description="A cut", tags=("colour", "vlog"), modified_ms=9_000
        )
        assert ProjectMetadata.from_wire(_round_trip(metadata.to_wire())) == metadata

    def test_tags_round_trip_as_a_tuple(self) -> None:
        metadata = ProjectMetadata.from_wire(ProjectMetadata(tags=("a", "b")).to_wire())
        assert metadata.tags == ("a", "b")

    def test_an_unknown_wire_field_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            ProjectMetadata.from_wire(dict(ProjectMetadata().to_wire(), studio="Nova"))


class TestProjectSettings:
    def test_1080p_stereo_at_48k_is_the_default(self) -> None:
        settings = ProjectSettings()
        assert (
            settings.frame_size.width,
            settings.sample_rate,
            settings.channels,
        ) == (DEFAULT_FRAME_WIDTH, DEFAULT_SAMPLE_RATE, DEFAULT_CHANNELS)

    def test_proxies_are_used_for_preview_by_default(self) -> None:
        assert ProjectSettings().use_proxies is True

    def test_a_non_positive_sample_rate_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="sample_rate must be positive"):
            ProjectSettings(sample_rate=0)

    def test_an_unsupported_channel_count_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="channels must be one of"):
            ProjectSettings(channels=3)

    @pytest.mark.parametrize("channels", sorted(SUPPORTED_CHANNEL_COUNTS))
    def test_every_supported_channel_count_is_accepted(self, channels: int) -> None:
        assert ProjectSettings(channels=channels).channels == channels

    def test_the_working_colour_space_defaults_to_rec_709(self) -> None:
        assert int(ProjectSettings().working_colour_space) == 1

    def test_the_wire_form_survives_a_round_trip(self) -> None:
        settings = ProjectSettings(
            frame_size=FrameSize(width=3840, height=2160), channels=6, use_proxies=False
        )
        assert ProjectSettings.from_wire(_round_trip(settings.to_wire())) == settings

    def test_the_colour_space_travels_as_a_number(self) -> None:
        assert ProjectSettings().to_wire()["working_colour_space"] == 1

    def test_an_unknown_wire_field_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            ProjectSettings.from_wire(dict(ProjectSettings().to_wire(), bit_depth=10))


class TestProjectWithSettings:
    """The one-field replace behind the settings command.

    Deliberately *not* a second `with_timeline`: a settings change has no owners
    to prune, so the pass over every binding that `with_timeline` makes would be
    work done to answer a question the edit did not ask.
    """

    def test_the_settings_change(self) -> None:
        project = _project().with_settings(ProjectSettings(channels=6))
        assert project.settings.channels == 6

    def test_the_edit_is_left_alone(self) -> None:
        project = _project()
        changed = project.with_settings(ProjectSettings(channels=6))
        assert changed.timeline == project.timeline

    def test_the_original_is_left_alone(self) -> None:
        project = _project()
        project.with_settings(ProjectSettings(channels=6))
        assert project.settings.channels == DEFAULT_CHANNELS

    def test_a_binding_on_a_surviving_clip_survives(self) -> None:
        """The difference that matters: `with_timeline` prunes by owner, and a
        settings change has not removed an owner."""
        project = _project().with_effects(EffectTarget.CLIP, "c1", _chain())
        changed = project.with_settings(ProjectSettings(channels=6))
        assert len(changed.effects) == 1

    def test_a_settings_change_survives_a_timeline_change(self) -> None:
        """Two replaces, two concerns: neither field is the other's business."""
        project = _project().with_settings(ProjectSettings(channels=6))
        changed = project.with_timeline(_timeline(_track("v1", _clip("c1", "a1"))))
        assert changed.settings.channels == 6

    def test_the_frame_the_compositor_builds_is_the_settings_not_a_field(self) -> None:
        project = _project().with_settings(
            ProjectSettings(frame_size=FrameSize(width=3840, height=2160))
        )
        assert project.settings.frame_size == FrameSize(width=3840, height=2160)


class TestEffectBinding:
    def test_a_clip_binding_names_its_clip(self) -> None:
        assert EffectBinding(target=EffectTarget.CLIP, owner_id="c1").owner_id == "c1"

    def test_the_output_has_no_owner(self) -> None:
        assert EffectBinding(target=EffectTarget.OUTPUT).owner_id == ""

    def test_a_clip_binding_with_no_owner_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must name its owner"):
            EffectBinding(target=EffectTarget.CLIP)

    def test_an_output_binding_with_an_owner_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="has no owner"):
            EffectBinding(target=EffectTarget.OUTPUT, owner_id="c1")

    def test_an_empty_chain_is_empty(self) -> None:
        assert EffectBinding(target=EffectTarget.OUTPUT).is_empty is True

    def test_a_binding_with_an_effect_is_not_empty(self) -> None:
        binding = EffectBinding(target=EffectTarget.CLIP, owner_id="c1", chain=_chain())
        assert binding.is_empty is False

    def test_the_wire_form_survives_a_round_trip(self) -> None:
        binding = EffectBinding(target=EffectTarget.CLIP, owner_id="c1", chain=_chain())
        assert EffectBinding.from_wire(_round_trip(binding.to_wire())) == binding

    def test_an_unknown_wire_field_is_refused(self) -> None:
        wire = dict(EffectBinding(target=EffectTarget.OUTPUT).to_wire(), mix=0.5)
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            EffectBinding.from_wire(wire)


class TestTransformBinding:
    def test_a_binding_names_its_clip(self) -> None:
        assert TransformBinding(clip_id="c1").clip_id == "c1"

    def test_a_binding_with_no_clip_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must name its clip"):
            TransformBinding(clip_id="")

    def test_the_default_transform_is_the_identity(self) -> None:
        assert TransformBinding(clip_id="c1").transform.at(0).is_identity is True

    def test_the_wire_form_survives_a_round_trip(self) -> None:
        binding = TransformBinding(clip_id="c1", transform=_transform())
        assert TransformBinding.from_wire(_round_trip(binding.to_wire())) == binding


class TestMaskBinding:
    def test_a_binding_names_its_clip(self) -> None:
        assert MaskBinding(clip_id="c1").clip_id == "c1"

    def test_a_binding_with_no_clip_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must name its clip"):
            MaskBinding(clip_id="")

    def test_a_binding_starts_with_no_masks(self) -> None:
        assert MaskBinding(clip_id="c1").masks == ()

    def test_two_masks_may_not_share_an_id(self) -> None:
        with pytest.raises(NovaInvariantError, match="two masks called"):
            MaskBinding(clip_id="c1", masks=(_mask("m1"), _mask("m1")))

    def test_the_wire_form_survives_a_round_trip(self) -> None:
        binding = MaskBinding(clip_id="c1", masks=(_mask("m1"), _mask("m2", invert=True)))
        assert MaskBinding.from_wire(_round_trip(binding.to_wire())) == binding


class TestBlendBinding:
    def test_a_clip_binding_names_its_clip(self) -> None:
        assert BlendBinding(target=EffectTarget.CLIP, owner_id="c1").owner_id == "c1"

    def test_the_default_mode_is_normal(self) -> None:
        binding = BlendBinding(target=EffectTarget.CLIP, owner_id="c1")
        assert binding.mode is BlendMode.NORMAL

    def test_normal_is_the_mode_that_changes_nothing(self) -> None:
        assert BlendBinding(target=EffectTarget.CLIP, owner_id="c1").is_normal is True

    def test_multiply_is_not_normal(self) -> None:
        binding = BlendBinding(target=EffectTarget.CLIP, owner_id="c1", mode=BlendMode.MULTIPLY)
        assert binding.is_normal is False

    def test_the_output_cannot_blend_with_anything(self) -> None:
        with pytest.raises(NovaInvariantError, match="belongs to a clip or a track"):
            BlendBinding(target=EffectTarget.OUTPUT)

    def test_a_binding_with_no_owner_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must name its owner"):
            BlendBinding(target=EffectTarget.CLIP)

    def test_the_wire_form_survives_a_round_trip(self) -> None:
        binding = BlendBinding(target=EffectTarget.TRACK, owner_id="v1", mode=BlendMode.SCREEN)
        assert BlendBinding.from_wire(_round_trip(binding.to_wire())) == binding


class TestCaptionDocumentRef:
    def test_a_ref_knows_where_it_is_filed(self) -> None:
        assert _ref("doc-1").document_name == caption_document("doc-1")

    def test_a_document_name_lives_under_captions(self) -> None:
        assert _ref("doc-1").document_name == "captions/doc-1.json"

    def test_a_document_carries_its_content(self) -> None:
        assert _ref("doc-1").document.segment_count == 1

    def test_an_id_that_would_escape_the_archive_is_refused(self) -> None:
        """A `.nova` file is a ZIP: a crafted id is the zip-slip attack."""
        with pytest.raises(NovaInvariantError, match="must be a bare name"):
            CaptionDocumentRef(document_id="../../evil", document=_document())

    def test_an_id_with_a_separator_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must be a bare name"):
            CaptionDocumentRef(document_id="captions/evil", document=_document())

    def test_an_empty_id_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must be a bare name"):
            CaptionDocumentRef(document_id="", document=_document())

    def test_an_id_that_files_but_does_not_travel_is_refused(self) -> None:
        """A bare name that is still not a safe entry: a Windows drive letter
        is meaningless inside a POSIX archive."""
        with pytest.raises(NovaInvariantError, match="safe document name"):
            CaptionDocumentRef(document_id="c:clip", document=_document())

    def test_the_wire_form_survives_a_round_trip(self) -> None:
        ref = _ref("doc-1")
        assert CaptionDocumentRef.from_wire(_round_trip(ref.to_wire())) == ref

    def test_an_unknown_wire_field_is_refused(self) -> None:
        wire = dict(_ref().to_wire(), language="en")
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            CaptionDocumentRef.from_wire(wire)


class TestProjectShape:
    def test_a_project_needs_an_id(self) -> None:
        with pytest.raises(NovaInvariantError, match="must carry an id"):
            _project(project_id=EntityId(""))

    def test_a_project_needs_a_name(self) -> None:
        with pytest.raises(NovaInvariantError, match="must have a name"):
            _project(name="")

    def test_renaming_checks_the_new_name(self) -> None:
        with pytest.raises(NovaInvariantError, match="must have a name"):
            _project().renamed("")

    def test_renaming_returns_a_new_project(self) -> None:
        assert _project().renamed("Second cut").name == "Second cut"

    def test_renaming_leaves_the_original_alone(self) -> None:
        project = _project()
        project.renamed("Second cut")
        assert project.name == "Demo"

    def test_the_timebase_comes_from_the_timeline(self) -> None:
        project = _project(timeline=_timeline(timebase=Timebase.of(25)))
        assert project.timebase == Timebase.of(25)

    def test_the_timebase_is_not_stored_twice(self) -> None:
        """A second copy is a setting that can disagree with the edit."""
        changed = _project().with_timeline(_timeline(timebase=Timebase.of(24)))
        assert changed.timebase == Timebase.of(24)

    def test_the_duration_is_the_timelines(self) -> None:
        assert _project().duration_frames == 100

    def test_the_duration_in_seconds_uses_the_timebase(self) -> None:
        assert _project().duration_seconds() == pytest.approx(100 / 30)

    def test_a_project_with_nothing_in_it_is_empty(self) -> None:
        assert Project(project_id=EntityId("p1"), name="Empty").is_empty is True

    def test_a_project_with_one_asset_is_not_empty(self) -> None:
        assert _project(assets=(_asset("a1"),), timeline=_timeline()).is_empty is False

    def test_a_project_with_one_caption_is_not_empty(self) -> None:
        project = Project(project_id=EntityId("p1"), name="C", captions=(_ref(),))
        assert project.is_empty is False

    def test_the_counts_are_the_lengths_of_the_collections(self) -> None:
        project = _project(assets=(_asset("a1"), _asset("a2")), captions=(_ref(),))
        assert (project.asset_count, project.caption_count, project.clip_count) == (2, 1, 1)

    def test_two_assets_may_not_share_an_id(self) -> None:
        with pytest.raises(NovaInvariantError, match="two assets share the id"):
            _project(assets=(_asset("a1"), _asset("a1", path="/other.mp4")))

    def test_two_caption_documents_may_not_share_an_id(self) -> None:
        with pytest.raises(NovaInvariantError, match="two caption documents share the id"):
            _project(captions=(_ref("doc-1"), _ref("doc-1")))

    def test_two_effect_bindings_may_not_share_an_owner(self) -> None:
        binding = EffectBinding(target=EffectTarget.CLIP, owner_id="c1", chain=_chain())
        with pytest.raises(NovaInvariantError, match="two effect bindings share the id"):
            _project(effects=(binding, binding))

    def test_two_transform_bindings_may_not_share_a_clip(self) -> None:
        binding = TransformBinding(clip_id="c1", transform=_transform())
        with pytest.raises(NovaInvariantError, match="two transform bindings share the id"):
            _project(transforms=(binding, binding))

    def test_two_mask_bindings_may_not_share_a_clip(self) -> None:
        binding = MaskBinding(clip_id="c1", masks=(_mask(),))
        with pytest.raises(NovaInvariantError, match="two mask bindings share the id"):
            _project(masks=(binding, binding))

    def test_two_blend_bindings_may_not_share_an_owner(self) -> None:
        binding = BlendBinding(target=EffectTarget.CLIP, owner_id="c1")
        with pytest.raises(NovaInvariantError, match="two blend bindings share the id"):
            _project(blends=(binding, binding))

    def test_a_clip_and_a_track_may_share_an_id_without_clashing(self) -> None:
        effects = (
            EffectBinding(target=EffectTarget.CLIP, owner_id="x", chain=_chain()),
            EffectBinding(target=EffectTarget.TRACK, owner_id="x", chain=_chain()),
        )
        assert len(_project(effects=effects).effects) == 2

    def test_touching_records_a_save_on_the_metadata(self) -> None:
        assert _project().touched(7_000).metadata.modified_ms == 7_000

    def test_touching_refuses_to_move_backwards(self) -> None:
        project = _project(metadata=ProjectMetadata(modified_ms=7_000))
        with pytest.raises(NovaInvariantError, match="backwards"):
            project.touched(6_000)

    def test_a_consistent_project_validates_to_nothing(self) -> None:
        assert _project().validate() == ""


class TestProjectAssets:
    def test_an_asset_can_be_found_by_id(self) -> None:
        assert _project().asset("a1") is not None

    def test_an_unknown_asset_is_none(self) -> None:
        assert _project().asset("nope") is None

    def test_adding_an_asset_puts_it_in_the_bin(self) -> None:
        assert _project().with_asset(_asset("a2")).asset_count == 2

    def test_adding_an_asset_twice_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="already in this project"):
            _project().with_asset(_asset("a1"))

    def test_adding_does_not_mutate_the_original(self) -> None:
        project = _project()
        project.with_asset(_asset("a2"))
        assert project.asset_count == 1

    def test_removing_an_asset_takes_it_out_of_the_bin(self) -> None:
        project = _project(assets=(_asset("a1"),), timeline=_timeline())
        assert project.without_asset("a1").asset_count == 0

    def test_removing_an_unknown_asset_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="is not in this project"):
            _project().without_asset("ghost")

    def test_removing_an_asset_that_a_clip_uses_is_refused(self) -> None:
        """An asset silently dropped from under a clip is the worst kind of
        missing media, because nothing tells the user what happened."""
        with pytest.raises(NovaInvariantError, match="remove the clips before"):
            _project().without_asset("a1")

    def test_removing_an_unused_asset_is_allowed(self) -> None:
        project = _project(assets=(_asset("a1"), _asset("a2")))
        assert project.without_asset("a2").asset_count == 1

    def test_relinking_points_the_asset_at_a_new_file(self) -> None:
        assert _project().relink_asset("a1", "/new/clip.mp4").asset("a1").path == ("/new/clip.mp4")

    def test_relinking_keeps_the_edit_valid(self) -> None:
        """Clips reference the asset id, never the path, so a moved folder is
        one operation rather than a hundred edits (ADR-0015 rule 3)."""
        relinked = _project().relink_asset("a1", "/new/clip.mp4")
        assert relinked.clip("c1").asset_id == "a1"
        assert relinked.validate() == ""

    def test_relinking_can_replace_the_hash(self) -> None:
        moved = _project().relink_asset("a1", "/new.mp4", content_hash=ContentHash(HASH))
        assert moved.asset("a1").content_hash == ContentHash(HASH)

    def test_relinking_can_replace_the_probe(self) -> None:
        project = _project().relink_asset("a1", "/new.mp4", probe=_video_info())
        assert project.asset("a1").is_probed is True

    def test_relinking_makes_a_missing_asset_linked_again(self) -> None:
        """The point of the whole workflow: the edit's geometry never moved."""
        project = _project(assets=(_asset("a1").mark_missing(),))
        relinked = project.relink_asset("a1", "/found/clip.mp4", probe=_video_info())
        assert relinked.asset("a1").is_linked is True
        assert relinked.missing_assets() == ()

    def test_relinking_an_unknown_asset_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="is not in this project"):
            _project().relink_asset("ghost", "/new.mp4")

    def test_relinking_leaves_the_original_alone(self) -> None:
        project = _project()
        project.relink_asset("a1", "/new.mp4")
        assert project.asset("a1").path == "/media/clip.mp4"

    def test_a_used_asset_is_referenced(self) -> None:
        assert _project().referenced_asset_ids() == frozenset({"a1"})

    def test_an_unused_asset_is_not_referenced(self) -> None:
        project = _project(assets=(_asset("a1"), _asset("a2")))
        assert project.referenced_asset_ids() == frozenset({"a1"})

    def test_a_generated_clip_references_no_asset(self) -> None:
        """A solid needs no media, which is what makes 'remove unused media'
        safe."""
        solid = _clip("c2", "", kind=ClipKind.SOLID)
        project = _project(timeline=_timeline(_track("v1", _clip("c1", "a1"), solid)))
        assert project.referenced_asset_ids() == frozenset({"a1"})

    def test_the_clip_count_for_an_asset_counts_its_clips(self) -> None:
        timeline = _timeline(_track("v1", _clip("c1", "a1"), _clip("c2", "a1", start_frame=100)))
        assert _project(timeline=timeline).clip_count_for_asset("a1") == 2

    def test_a_missing_file_is_a_state_and_not_an_error(self) -> None:
        missing = _asset("a1").mark_missing()
        project = _project(assets=(missing,))
        assert project.validate() == ""
        assert [str(a.asset_id) for a in project.missing_assets()] == ["a1"]

    def test_a_linked_asset_is_not_missing(self) -> None:
        assert _project().missing_assets() == ()

    def test_an_unused_asset_is_not_reported_missing(self) -> None:
        project = _project(assets=(_asset("a1"), _asset("a2").mark_missing()))
        assert project.missing_assets() == ()

    def test_unused_assets_are_the_ones_no_clip_uses(self) -> None:
        project = _project(assets=(_asset("a1"), _asset("a2")))
        assert [str(a.asset_id) for a in project.unused_assets()] == ["a2"]


class TestProjectEdit:
    def test_a_clip_can_be_found_from_any_track(self) -> None:
        timeline = _timeline(_track("v1", _clip("c1")), _track("v2", _clip("c2")))
        assert _project(timeline=timeline).clip("c2") is not None

    def test_an_unknown_clip_is_none(self) -> None:
        assert _project().clip("nope") is None

    def test_a_track_can_be_found(self) -> None:
        assert _project().track("v1") is not None

    def test_an_unknown_track_is_none(self) -> None:
        assert _project().track("nope") is None

    def test_replacing_the_timeline_replaces_the_edit(self) -> None:
        timeline = _timeline(_track("v1", _clip("c9", "a1", source_frames=50)))
        assert _project().with_timeline(timeline).duration_frames == 50

    def test_deleting_a_clip_takes_its_effects_with_it(self) -> None:
        project = _project().with_effects(EffectTarget.CLIP, "c1", _chain())
        pruned = project.with_timeline(_timeline())
        assert pruned.effects == ()

    def test_deleting_a_clip_takes_its_transform_with_it(self) -> None:
        project = _project().with_transform("c1", _transform())
        assert project.with_timeline(_timeline()).transforms == ()

    def test_deleting_a_clip_takes_its_masks_with_it(self) -> None:
        project = _project().with_masks("c1", (_mask(),))
        assert project.with_timeline(_timeline()).masks == ()

    def test_deleting_a_clip_takes_its_blend_mode_with_it(self) -> None:
        project = _project().with_blend(EffectTarget.CLIP, "c1", BlendMode.MULTIPLY)
        assert project.with_timeline(_timeline()).blends == ()

    def test_deleting_a_track_takes_its_effects_with_it(self) -> None:
        project = _project().with_effects(EffectTarget.TRACK, "v1", _chain())
        assert project.with_timeline(_timeline()).effects == ()

    def test_an_output_grade_survives_the_edit_being_replaced(self) -> None:
        project = _project().with_effects(EffectTarget.OUTPUT, "", _chain())
        assert len(project.with_timeline(_timeline()).effects) == 1

    def test_bindings_on_surviving_clips_are_kept(self) -> None:
        project = _project().with_effects(EffectTarget.CLIP, "c1", _chain())
        kept = project.with_timeline(_timeline(_track("v1", _clip("c1", "a1"))))
        assert len(kept.effects) == 1


class TestProjectEffects:
    def test_a_clip_with_no_chain_has_an_empty_one(self) -> None:
        assert _project().effect_chain_for(EffectTarget.CLIP, "c1").is_empty is True

    def test_a_chain_can_be_attached_to_a_clip(self) -> None:
        project = _project().with_effects(EffectTarget.CLIP, "c1", _chain())
        assert project.effect_chain_for(EffectTarget.CLIP, "c1").count == 1

    def test_a_chain_can_be_attached_to_a_track(self) -> None:
        project = _project().with_effects(EffectTarget.TRACK, "v1", _chain())
        assert project.effect_chain_for(EffectTarget.TRACK, "v1").count == 1

    def test_a_chain_can_be_attached_to_the_output(self) -> None:
        project = _project().with_effects(EffectTarget.OUTPUT, "", _chain())
        assert project.effect_chain_for(EffectTarget.OUTPUT).count == 1

    def test_binding_to_a_missing_clip_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="it is not in this project"):
            _project().with_effects(EffectTarget.CLIP, "ghost", _chain())

    def test_binding_to_a_missing_track_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="it is not in this project"):
            _project().with_effects(EffectTarget.TRACK, "ghost", _chain())

    def test_attaching_an_empty_chain_removes_the_binding(self) -> None:
        """A project whose effects were all deleted looks like one that never
        had any."""
        project = _project().with_effects(EffectTarget.CLIP, "c1", _chain())
        assert project.with_effects(EffectTarget.CLIP, "c1", EffectChain()).effects == ()

    def test_attaching_replaces_rather_than_duplicating(self) -> None:
        project = _project().with_effects(EffectTarget.CLIP, "c1", _chain("e1"))
        replaced = project.with_effects(EffectTarget.CLIP, "c1", _chain("e2"))
        assert len(replaced.effects) == 1
        assert replaced.effect_chain_for(EffectTarget.CLIP, "c1").effect("e2") is not None

    def test_a_chain_can_be_detached(self) -> None:
        project = _project().with_effects(EffectTarget.CLIP, "c1", _chain())
        assert project.without_effects(EffectTarget.CLIP, "c1").effects == ()

    def test_detaching_a_chain_that_is_not_there_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="no clip effect chain"):
            _project().without_effects(EffectTarget.CLIP, "c1")

    def test_a_clip_chain_and_a_track_chain_are_different_bindings(self) -> None:
        project = (
            _project()
            .with_effects(EffectTarget.CLIP, "c1", _chain("e1"))
            .with_effects(EffectTarget.TRACK, "v1", _chain("e2"))
        )
        assert len(project.effects) == 2

    def test_attaching_does_not_mutate_the_original(self) -> None:
        project = _project()
        project.with_effects(EffectTarget.CLIP, "c1", _chain())
        assert project.effects == ()

    def test_the_effect_parameters_come_from_the_spec(self) -> None:
        project = _project().with_effects(EffectTarget.CLIP, "c1", _chain())
        effect = project.effect_chain_for(EffectTarget.CLIP, "c1").effect("e1")
        assert effect is not None
        assert effect.param_at("radius", 0) == (4.0,)


class TestProjectTransforms:
    def test_an_untouched_clip_has_the_identity(self) -> None:
        assert _project().transform_for("c1").at(0).is_identity is True

    def test_a_transform_can_be_set(self) -> None:
        assert _project().with_transform("c1", _transform()).transform_for("c1").at(0).position == (
            24.0,
            0.0,
        )

    def test_setting_the_identity_removes_the_binding(self) -> None:
        """A clip the user has never touched carries nothing at all."""
        project = _project().with_transform("c1", Transform())
        assert project.transforms == ()

    def test_a_transform_for_a_missing_clip_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="no clip 'ghost' in this project"):
            _project().with_transform("ghost", _transform())

    def test_setting_replaces_rather_than_duplicating(self) -> None:
        project = _project().with_transform("c1", _transform(10.0))
        replaced = project.with_transform("c1", _transform(20.0))
        assert len(replaced.transforms) == 1
        assert replaced.transform_for("c1").at(0).position == (20.0, 0.0)

    def test_setting_does_not_mutate_the_original(self) -> None:
        project = _project()
        project.with_transform("c1", _transform())
        assert project.transforms == ()

    def test_an_animated_transform_is_kept_even_at_the_identity(self) -> None:
        """A clip whose transform *moves* is not untouched, even when the value
        at frame 0 happens to be the identity."""
        position = (
            Animatable.constant("position", 0.0, 0.0)
            .with_keyframe(Keyframe.at(0, 0.0, 0.0))
            .with_keyframe(Keyframe.at(10, 100.0, 0.0))
        )
        animated = Transform(position=position)
        project = _project().with_transform("c1", animated)
        assert len(project.transforms) == 1
        assert project.transform_for("c1").at(0).is_identity is True
        assert project.transform_for("c1").at(10).position == (100.0, 0.0)


class TestProjectMasks:
    def test_an_untouched_clip_has_no_masks(self) -> None:
        assert _project().masks_for("c1") == ()

    def test_masks_can_be_set(self) -> None:
        assert len(_project().with_masks("c1", (_mask(),)).masks_for("c1")) == 1

    def test_masks_keep_their_order(self) -> None:
        project = _project().with_masks("c1", (_mask("m1"), _mask("m2", invert=True)))
        assert [mask.mask_id for mask in project.masks_for("c1")] == ["m1", "m2"]

    def test_clearing_the_masks_removes_the_binding(self) -> None:
        project = _project().with_masks("c1", (_mask(),))
        assert project.with_masks("c1").masks == ()

    def test_masks_for_a_missing_clip_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="no clip 'ghost' in this project"):
            _project().with_masks("ghost", (_mask(),))

    def test_two_masks_on_one_clip_may_not_share_an_id(self) -> None:
        with pytest.raises(NovaInvariantError, match="two masks called"):
            _project().with_masks("c1", (_mask("m1"), _mask("m1")))

    def test_setting_masks_does_not_mutate_the_original(self) -> None:
        project = _project()
        project.with_masks("c1", (_mask(),))
        assert project.masks == ()

    def test_a_full_frame_mask_can_be_stored(self) -> None:
        assert _project().with_masks("c1", (_mask(),)).masks_for("c1")[0].is_full_frame


class TestProjectBlends:
    def test_an_untouched_clip_blends_normally(self) -> None:
        assert _project().blend_for(EffectTarget.CLIP, "c1") is BlendMode.NORMAL

    def test_a_blend_mode_can_be_set_on_a_clip(self) -> None:
        project = _project().with_blend(EffectTarget.CLIP, "c1", BlendMode.MULTIPLY)
        assert project.blend_for(EffectTarget.CLIP, "c1") is BlendMode.MULTIPLY

    def test_a_blend_mode_can_be_set_on_a_track(self) -> None:
        project = _project().with_blend(EffectTarget.TRACK, "v1", BlendMode.SCREEN)
        assert project.blend_for(EffectTarget.TRACK, "v1") is BlendMode.SCREEN

    def test_setting_normal_removes_the_binding(self) -> None:
        project = _project().with_blend(EffectTarget.CLIP, "c1", BlendMode.MULTIPLY)
        assert project.with_blend(EffectTarget.CLIP, "c1", BlendMode.NORMAL).blends == ()

    def test_the_output_cannot_be_blended(self) -> None:
        with pytest.raises(NovaInvariantError, match="belongs to a clip or a track"):
            _project().with_blend(EffectTarget.OUTPUT, "", BlendMode.MULTIPLY)

    def test_blending_a_missing_clip_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="it is not in this project"):
            _project().with_blend(EffectTarget.CLIP, "ghost", BlendMode.MULTIPLY)

    def test_setting_replaces_rather_than_duplicating(self) -> None:
        project = (
            _project()
            .with_blend(EffectTarget.CLIP, "c1", BlendMode.MULTIPLY)
            .with_blend(EffectTarget.CLIP, "c1", BlendMode.SCREEN)
        )
        assert len(project.blends) == 1
        assert project.blend_for(EffectTarget.CLIP, "c1") is BlendMode.SCREEN


class TestProjectCaptions:
    def test_a_document_can_be_found_by_id(self) -> None:
        assert _project(captions=(_ref("doc-1"),)).caption("doc-1") is not None

    def test_an_unknown_document_is_none(self) -> None:
        assert _project().caption("nope") is None

    def test_a_document_can_be_added(self) -> None:
        assert _project().with_caption(_ref("doc-2")).caption_count == 1

    def test_adding_a_document_twice_replaces_it(self) -> None:
        project = _project().with_caption(_ref("doc-1")).with_caption(_ref("doc-1"))
        assert project.caption_count == 1

    def test_replacing_a_document_keeps_its_place(self) -> None:
        """Two documents, and the first one is re-saved: it must stay first, or
        the panel the user is looking at reorders itself under them."""
        project = (
            _project()
            .with_caption(_ref("doc-1"))
            .with_caption(_ref("doc-2"))
            .with_caption(_ref("doc-1"))
        )
        assert [ref.document_id for ref in project.captions] == ["doc-1", "doc-2"]

    def test_an_unsafe_document_id_is_refused_on_the_way_in(self) -> None:
        with pytest.raises(NovaInvariantError, match="safe document name"):
            CaptionDocumentRef(document_id="c:clip", document=_document())

    def test_a_document_can_be_removed(self) -> None:
        project = _project().with_caption(_ref("doc-1"))
        assert project.without_caption("doc-1").caption_count == 0

    def test_removing_an_unknown_document_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="no caption document 'ghost'"):
            _project().without_caption("ghost")

    def test_adding_a_document_does_not_mutate_the_original(self) -> None:
        project = _project()
        project.with_caption(_ref("doc-1"))
        assert project.caption_count == 0

    def test_several_documents_can_live_side_by_side(self) -> None:
        project = _project().with_caption(_ref("doc-1")).with_caption(_ref("doc-2"))
        assert project.caption_count == 2


class TestProjectWire:
    def test_the_wire_form_carries_every_part(self) -> None:
        assert sorted(_project().to_wire()) == sorted(
            {
                "project_id",
                "name",
                "metadata",
                "settings",
                "assets",
                "timeline",
                "captions",
                "effects",
                "transforms",
                "masks",
                "blends",
                "grades",
            }
        )

    def test_the_project_id_travels_as_a_string(self) -> None:
        assert _project().to_wire()["project_id"] == "p1"

    def test_a_round_trip_preserves_the_project(self) -> None:
        project = _project()
        assert Project.from_wire(_round_trip(project.to_wire())) == project

    def test_a_round_trip_preserves_the_bindings(self) -> None:
        project = (
            _project()
            .with_effects(EffectTarget.CLIP, "c1", _chain())
            .with_transform("c1", _transform())
            .with_masks("c1", (_mask(),))
            .with_blend(EffectTarget.CLIP, "c1", BlendMode.MULTIPLY)
        )
        assert Project.from_wire(_round_trip(project.to_wire())) == project

    def test_a_round_trip_preserves_the_captions(self) -> None:
        project = _project().with_caption(_ref("doc-1"))
        assert Project.from_wire(_round_trip(project.to_wire())) == project

    def test_a_round_trip_preserves_the_settings(self) -> None:
        project = _project(settings=ProjectSettings(channels=6, use_proxies=False))
        assert Project.from_wire(_round_trip(project.to_wire())).settings == project.settings

    def test_a_round_trip_preserves_the_assets(self) -> None:
        project = _project(assets=(_asset("a1"), _asset("a2", path="/other.mp4")))
        assert Project.from_wire(_round_trip(project.to_wire())).assets == project.assets

    def test_a_round_trip_preserves_the_timebase(self) -> None:
        project = _project(timeline=_timeline(timebase=Timebase.of(25)))
        assert Project.from_wire(_round_trip(project.to_wire())).timebase == Timebase.of(25)

    def test_an_unknown_wire_field_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            Project.from_wire(dict(_project().to_wire(), version=2))

    def test_a_missing_wire_field_is_refused(self) -> None:
        wire = dict(_project().to_wire())
        del wire["settings"]
        with pytest.raises(NovaInvariantError, match="fields must be exactly"):
            Project.from_wire(wire)

    def test_a_document_that_would_escape_the_archive_is_refused_on_load(self) -> None:
        wire = dict(_project().to_wire())
        wire["captions"] = [{"document_id": "c:clip", "document": _document().to_wire()}]
        with pytest.raises(NovaInvariantError, match="safe document name"):
            Project.from_wire(_round_trip(wire))

    def test_a_non_mapping_section_is_refused(self) -> None:
        wire = dict(_project().to_wire(), settings="1080p")
        with pytest.raises(NovaInvariantError, match="must be a mapping"):
            Project.from_wire(wire)

    def test_the_wire_form_is_json_serialisable(self) -> None:
        """One canonical document is what autosave, a checkpoint and an
        integrity digest are taken over."""
        assert json.loads(json.dumps(_project().to_wire()))["name"] == "Demo"

    def test_a_heavily_decorated_project_survives_a_round_trip(self) -> None:
        project = (
            _project(
                assets=(_asset("a1"), _asset("a2", path="/other.mp4")),
                timeline=_timeline(
                    _track("v1", _clip("c1", "a1"), _clip("c2", "a2", start_frame=100)),
                    _track("v2", _clip("c3", "a1", start_frame=50), kind=TrackKind.VIDEO),
                    timebase=Timebase.of(24),
                ),
                metadata=ProjectMetadata(author="Sam", tags=("vlog",), modified_ms=100),
                settings=ProjectSettings(frame_size=FrameSize(width=3840, height=2160)),
            )
            .with_effects(EffectTarget.CLIP, "c1", _chain())
            .with_effects(EffectTarget.TRACK, "v1", _chain("e2"))
            .with_effects(EffectTarget.OUTPUT, "", _chain("e3"))
            .with_transform("c1", _transform())
            .with_masks("c2", (_mask("m1"), _mask("m2", kind=MaskKind.ELLIPSE)))
            .with_blend(EffectTarget.CLIP, "c3", BlendMode.OVERLAY)
            .with_caption(_ref("doc-1"))
            .with_caption(_ref("doc-2"))
        )
        assert Project.from_wire(_round_trip(project.to_wire())) == project
        assert project.validate() == ""


class TestProjectDocuments:
    def test_project_json_leaves_out_the_edit_and_the_captions(self) -> None:
        documents = _project().to_documents()
        assert "timeline" not in documents.project
        assert "captions" not in documents.project

    def test_project_json_holds_everything_else(self) -> None:
        assert sorted(_project().to_documents().project) == sorted(PROJECT_DOCUMENT_FIELDS)

    def test_the_timeline_is_its_own_entry(self) -> None:
        assert _project().to_documents().timeline == _project().timeline.to_wire()

    def test_each_caption_is_its_own_entry(self) -> None:
        documents = _project().with_caption(_ref("doc-1")).to_documents()
        assert documents.captions == (("doc-1", _document("doc-1").to_wire()),)

    def test_a_round_trip_through_the_container_entries_preserves_the_project(self) -> None:
        project = _project().with_caption(_ref("doc-1"))
        documents = project.to_documents()
        rebuilt = Project.from_documents(
            ProjectDocuments(
                project=_round_trip(documents.project),
                timeline=_round_trip(documents.timeline),
                captions=tuple(
                    (document_id, _round_trip(document))
                    for document_id, document in documents.captions
                ),
            )
        )
        assert rebuilt == project

    def test_the_entries_are_json_serialisable(self) -> None:
        """Everything past this boundary is bytes on their way to a ZIP."""
        documents = _project().to_documents()
        assert json.loads(json.dumps(documents.project))["name"] == "Demo"

    def test_a_project_rebuilt_from_entries_still_validates(self) -> None:
        project = _project().with_caption(_ref("doc-1"))
        assert Project.from_documents(project.to_documents()).validate() == ""


class TestGradeBinding:
    def test_a_clip_binding_names_its_clip(self) -> None:
        assert GradeBinding(target=EffectTarget.CLIP, owner_id="c1").owner_id == "c1"

    def test_the_output_has_no_owner(self) -> None:
        assert GradeBinding(target=EffectTarget.OUTPUT).owner_id == ""

    def test_a_clip_binding_with_no_owner_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="must name its owner"):
            GradeBinding(target=EffectTarget.CLIP)

    def test_an_output_binding_with_an_owner_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="has no owner"):
            GradeBinding(target=EffectTarget.OUTPUT, owner_id="c1")

    def test_the_default_grade_changes_nothing(self) -> None:
        assert GradeBinding(target=EffectTarget.OUTPUT).is_neutral is True

    def test_a_graded_binding_is_not_neutral(self) -> None:
        binding = GradeBinding(target=EffectTarget.CLIP, owner_id="c1", grade=_grade())
        assert binding.is_neutral is False

    def test_the_wire_form_survives_a_round_trip(self) -> None:
        binding = GradeBinding(target=EffectTarget.CLIP, owner_id="c1", grade=_grade())
        assert GradeBinding.from_wire(_round_trip(binding.to_wire())) == binding


class TestProjectGrades:
    def test_an_ungraded_clip_is_neutral(self) -> None:
        assert _project().grade_for(EffectTarget.CLIP, "c1").is_neutral is True

    def test_a_grade_can_be_attached_to_a_clip(self) -> None:
        project = _project().with_grade(EffectTarget.CLIP, "c1", _grade())
        assert project.grade_for(EffectTarget.CLIP, "c1").exposure.value == (1.0,)

    def test_a_grade_can_be_attached_to_a_track(self) -> None:
        project = _project().with_grade(EffectTarget.TRACK, "v1", _grade())
        assert project.grade_for(EffectTarget.TRACK, "v1").is_neutral is False

    def test_a_grade_can_be_attached_to_the_output(self) -> None:
        """The output grade is what a colourist means by "the look"."""
        project = _project().with_grade(EffectTarget.OUTPUT, "", _grade())
        assert project.grade_for(EffectTarget.OUTPUT).is_neutral is False

    def test_grading_a_missing_clip_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="it is not in this project"):
            _project().with_grade(EffectTarget.CLIP, "ghost", _grade())

    def test_grading_with_a_neutral_grade_removes_the_binding(self) -> None:
        project = _project().with_grade(EffectTarget.CLIP, "c1", _grade())
        assert project.with_grade(EffectTarget.CLIP, "c1", ColourGrade()).grades == ()

    def test_grading_replaces_rather_than_duplicating(self) -> None:
        project = (
            _project()
            .with_grade(EffectTarget.CLIP, "c1", _grade())
            .with_grade(
                EffectTarget.CLIP,
                "c1",
                _grade(exposure=Animatable.constant("exposure", 2.0)),
            )
        )
        assert len(project.grades) == 1
        assert project.grade_for(EffectTarget.CLIP, "c1").exposure.value == (2.0,)

    def test_a_grade_can_be_detached(self) -> None:
        project = _project().with_grade(EffectTarget.CLIP, "c1", _grade())
        assert project.without_grade(EffectTarget.CLIP, "c1").grades == ()

    def test_detaching_a_grade_that_is_not_there_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="no clip grade on 'c1'"):
            _project().without_grade(EffectTarget.CLIP, "c1")

    def test_deleting_a_clip_takes_its_grade_with_it(self) -> None:
        project = _project().with_grade(EffectTarget.CLIP, "c1", _grade())
        assert project.with_timeline(_timeline()).grades == ()

    def test_an_output_grade_survives_the_edit_being_replaced(self) -> None:
        project = _project().with_grade(EffectTarget.OUTPUT, "", _grade())
        assert len(project.with_timeline(_timeline()).grades) == 1

    def test_grading_does_not_mutate_the_original(self) -> None:
        project = _project()
        project.with_grade(EffectTarget.CLIP, "c1", _grade())
        assert project.grades == ()

    def test_two_grade_bindings_may_not_share_an_owner(self) -> None:
        binding = GradeBinding(target=EffectTarget.CLIP, owner_id="c1", grade=_grade())
        with pytest.raises(NovaInvariantError, match="two grade bindings share the id"):
            _project(grades=(binding, binding))

    def test_a_graded_project_survives_a_round_trip(self) -> None:
        project = (
            _project()
            .with_grade(EffectTarget.CLIP, "c1", _grade())
            .with_grade(EffectTarget.OUTPUT, "", _grade())
        )
        assert Project.from_wire(_round_trip(project.to_wire())) == project

    def test_a_grade_with_curves_and_a_lut_survives_a_round_trip(self) -> None:
        grade = _grade(
            curves=(GradeCurve(points=((0.0, 0.0), (0.5, 0.6), (1.0, 1.0))),),
            lut=Lut(lut_id="teal-orange", name="Teal & Orange"),
        )
        project = _project().with_grade(EffectTarget.OUTPUT, "", grade)
        assert Project.from_wire(_round_trip(project.to_wire())) == project


class TestValidateProject:
    def test_a_consistent_project_has_nothing_to_report(self) -> None:
        assert validate_project(_project()) == ""

    def test_a_structural_problem_in_the_edit_is_reported_first(self) -> None:
        """A project whose timeline is broken is not asked about its captions."""
        overlapping = _timeline(_track("v1", _clip("c1", "a1"), _clip("c2", "a1", start_frame=50)))
        assert validate_project(_project(timeline=overlapping)) != ""

    def test_a_clip_referencing_an_unknown_asset_is_reported(self) -> None:
        project = _project(timeline=_timeline(_track("v1", _clip("c1", "ghost"))))
        assert validate_project(project) == (
            "clip 'c1' references asset 'ghost', which is not in this project"
        )

    def test_a_generated_clip_needs_no_asset(self) -> None:
        solid = _clip("c2", "", kind=ClipKind.SOLID, start_frame=100)
        project = _project(timeline=_timeline(_track("v1", _clip("c1", "a1"), solid)))
        assert validate_project(project) == ""

    def test_an_effect_bound_to_a_deleted_clip_is_reported(self) -> None:
        project = _project(
            effects=(EffectBinding(target=EffectTarget.CLIP, owner_id="ghost", chain=_chain()),)
        )
        assert validate_project(project) == (
            "an effect chain is bound to clip 'ghost', which is not in this project"
        )

    def test_an_effect_bound_to_a_deleted_track_is_reported(self) -> None:
        binding = EffectBinding(target=EffectTarget.TRACK, owner_id="ghost", chain=_chain())
        assert "bound to track 'ghost'" in validate_project(_project(effects=(binding,)))

    def test_an_output_effect_is_never_dangling(self) -> None:
        binding = EffectBinding(target=EffectTarget.OUTPUT, owner_id="", chain=_chain())
        assert validate_project(_project(effects=(binding,))) == ""

    def test_a_transform_bound_to_a_deleted_clip_is_reported(self) -> None:
        project = _project(transforms=(TransformBinding(clip_id="ghost"),))
        assert validate_project(project) == (
            "a transform is bound to clip 'ghost', which is not in this project"
        )

    def test_masks_bound_to_a_deleted_clip_are_reported(self) -> None:
        project = _project(masks=(MaskBinding(clip_id="ghost", masks=(_mask(),)),))
        assert validate_project(project) == (
            "masks are bound to clip 'ghost', which is not in this project"
        )

    def test_a_blend_bound_to_a_deleted_clip_is_reported(self) -> None:
        project = _project(blends=(BlendBinding(target=EffectTarget.CLIP, owner_id="ghost"),))
        assert validate_project(project) == (
            "a blend mode is bound to clip 'ghost', which is not in this project"
        )

    def test_a_grade_bound_to_a_deleted_clip_is_reported(self) -> None:
        binding = GradeBinding(target=EffectTarget.CLIP, owner_id="ghost", grade=_grade())
        assert validate_project(_project(grades=(binding,))) == (
            "a grade is bound to clip 'ghost', which is not in this project"
        )

    def test_an_output_grade_is_never_dangling(self) -> None:
        binding = GradeBinding(target=EffectTarget.OUTPUT, owner_id="", grade=_grade())
        assert validate_project(_project(grades=(binding,))) == ""

    def test_a_broken_caption_document_is_reported_with_its_name(self) -> None:
        broken = CaptionDocument(
            segments=(
                _segment(0, 0, 1_000, "one"),
                _segment(1, 500, 1_500, "two"),
            )
        )
        ref = CaptionDocumentRef(document_id="doc-1", document=broken)
        problem = validate_project(_project(captions=(ref,)))
        assert problem.startswith("caption document 'doc-1': ")

    def test_only_the_first_problem_is_reported(self) -> None:
        """A user fixes one thing at a time; a wall of text helps nobody."""
        project = _project(
            timeline=_timeline(_track("v1", _clip("c1", "ghost"))),
            transforms=(TransformBinding(clip_id="ghost"),),
        )
        assert validate_project(project) == (
            "clip 'c1' references asset 'ghost', which is not in this project"
        )

    def test_the_project_method_delegates_to_the_function(self) -> None:
        project = _project(timeline=_timeline(_track("v1", _clip("c1", "ghost"))))
        assert project.validate() == validate_project(project)

    def test_a_damaged_project_can_still_be_built(self) -> None:
        """Reporting a problem is not the same as refusing to open (ADR-0015
        rule 3)."""
        project = _project(timeline=_timeline(_track("v1", _clip("c1", "ghost"))))
        assert project.clip_count == 1

    def test_a_damaged_project_can_still_be_saved(self) -> None:
        project = _project(timeline=_timeline(_track("v1", _clip("c1", "ghost"))))
        assert Project.from_wire(_round_trip(project.to_wire())).validate() != ""

    def test_relinking_repairs_a_damaged_project(self) -> None:
        project = _project(
            assets=(_asset("a1").mark_missing(),),
            timeline=_timeline(_track("v1", _clip("c1", "a1"))),
        )
        assert project.missing_assets() != ()
        repaired = project.relink_asset("a1", "/found/clip.mp4")
        assert repaired.missing_assets() == ()

    def test_an_empty_project_validates(self) -> None:
        assert validate_project(Project(project_id=EntityId("p1"), name="Empty")) == ""
