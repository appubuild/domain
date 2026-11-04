"""L2 — project: the aggregate root.

Everything below this module is a *piece* of a project: a timeline, a caption
document, an asset, an effect chain.  This module is the thing that owns them
all and can therefore answer the question none of them can answer alone:

    **Is this project consistent?**

A clip that names an asset the bin does not hold, an effect bound to a clip
that was deleted last Tuesday, a caption document filed under a name that would
escape the archive — none of those are visible from inside one module.  The
aggregate root is where they are checked, because it is the only object that can
see all of them at once (ADR-0004 §3, ADR-0015 rule 1).

Two rules shape everything here.

**The project opens even when it is broken.**  Construction refuses only what a
*construction* can see — duplicate ids, an empty name — and
:func:`validate_project` reports the rest as a sentence.  A user whose media
moved, or whose plugin is uninstalled, still gets their edit back and a precise
description of what to fix.  An editor that refuses to open a damaged project
is an editor that loses work.

**One timebase, one source of truth.**  The timeline carries it
(:class:`~nova_studio.domain.timeline.Timeline.timebase`); the project reads it
from there and never stores a second copy that could disagree.  The container
may repeat it in ``project.json`` for a support engineer's benefit, but the
model has exactly one.

Bindings, not fields
--------------------
Effects, transforms, masks and blend modes are stored *here*, keyed by the id
of the clip or track they decorate, and not on
:class:`~nova_studio.domain.timeline.Clip`.  A chain therefore does not know
what it is attached to — which is what lets the same ``EffectChain`` type serve
a clip, a track and the output grade, and what makes "delete this clip" a
single pruning pass instead of a hunt through every entity that might hold a
reference.

Deliberately not here
----------------------
* **I/O.**  Not a path, not a file, not a clock.  ``created_ms`` and
  ``modified_ms`` are passed in, so a save is reproducible in a test.
* **Undo.**  Mutations are :class:`~nova_studio.core.commands.Command` s
  (ADR-0008); this module offers the ``with_*`` builders they compose.
* **Autosave and export.**  :mod:`nova_studio.domain.persistence` owns the
  checkpoint policy; :mod:`nova_studio.domain.export` owns the output spec.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from typing import Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.ident import EntityId
from nova_studio.core.temporal import Timebase, frames_to_seconds
from nova_studio.domain._wire import (
    reject_unknown_fields as _reject_unknown_fields,
    wire_bool as _wire_bool,
    wire_int as _wire_int,
    wire_mappings as _wire_mappings,
    wire_str as _wire_str,
    wire_strings as _wire_strings,
)
from nova_studio.domain.captions import CaptionDocument, validate_caption_document
from nova_studio.domain.effects import BlendMode, EffectChain, EffectTarget, Mask, Transform
from nova_studio.domain.grade import ColourGrade
from nova_studio.domain.media import ColourSpace, ContentHash, MediaAsset, MediaInfo
from nova_studio.domain.persistence import caption_document, is_valid_document_name
from nova_studio.domain.timeline import Timeline

__all__ = [
    "DEFAULT_CHANNELS",
    "DEFAULT_FRAME_HEIGHT",
    "DEFAULT_FRAME_WIDTH",
    "DEFAULT_SAMPLE_RATE",
    "PROJECT_DOCUMENT_FIELDS",
    "SUPPORTED_CHANNEL_COUNTS",
    "BlendBinding",
    "CaptionDocumentRef",
    "EffectBinding",
    "FrameSize",
    "GradeBinding",
    "MaskBinding",
    "Project",
    "ProjectDocuments",
    "ProjectMetadata",
    "ProjectSettings",
    "TransformBinding",
    "validate_project",
]

# ---------------------------------------------------------------------------
# Wire field sets
# ---------------------------------------------------------------------------

_FRAME_SIZE_FIELDS: Final[set[str]] = {"width", "height"}
_METADATA_FIELDS: Final[set[str]] = {
    "author",
    "description",
    "tags",
    "created_ms",
    "modified_ms",
}
_SETTINGS_FIELDS: Final[set[str]] = {
    "frame_size",
    "sample_rate",
    "channels",
    "use_proxies",
    "working_colour_space",
}
_EFFECT_BINDING_FIELDS: Final[set[str]] = {"target", "owner_id", "chain"}
_TRANSFORM_BINDING_FIELDS: Final[set[str]] = {"clip_id", "transform"}
_MASK_BINDING_FIELDS: Final[set[str]] = {"clip_id", "masks"}
_BLEND_BINDING_FIELDS: Final[set[str]] = {"target", "owner_id", "mode"}
_GRADE_BINDING_FIELDS: Final[set[str]] = {"target", "owner_id", "grade"}
_CAPTION_REF_FIELDS: Final[set[str]] = {"document_id", "document"}
_PROJECT_FIELDS: Final[set[str]] = {
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
#: ``project.json`` is the same document with the timeline and the caption
#: documents lifted out into their own entries (ADR-0015).
PROJECT_DOCUMENT_FIELDS: Final[set[str]] = _PROJECT_FIELDS - {"timeline", "captions"}

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

#: 1080p is still what "a video" means to most of the people who will open this.
DEFAULT_FRAME_WIDTH: Final[int] = 1920
DEFAULT_FRAME_HEIGHT: Final[int] = 1080
#: 48 kHz: the rate every delivery spec accepts and the one audio interfaces use.
DEFAULT_SAMPLE_RATE: Final[int] = 48_000
#: Stereo.  A project is not a channel-count experiment.
DEFAULT_CHANNELS: Final[int] = 2

#: Channel counts the mixer and the encoders are written against.  Mono for a
#: voice-over, stereo for everything, 5.1 and 7.1 for delivery.
SUPPORTED_CHANNEL_COUNTS: Final[frozenset[int]] = frozenset({1, 2, 6, 8})

#: Targets a blend mode can be attached to.  The output has nothing beneath it
#: to blend with, so asking for one there is a mistake worth refusing.
_BLENDABLE_TARGETS: Final[frozenset[EffectTarget]] = frozenset(
    {EffectTarget.CLIP, EffectTarget.TRACK}
)


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True, kw_only=True)
class FrameSize:
    """The frame the compositor builds, in pixels.

    This is the *project* frame, not the preview frame: the preview renders the
    same coordinate space at a smaller scale, which is the only way a layer
    positioned 100 px from the centre lands in the same place in both.
    """

    width: int = DEFAULT_FRAME_WIDTH
    height: int = DEFAULT_FRAME_HEIGHT

    def __post_init__(self) -> None:
        if self.width <= 0 or self.height <= 0:
            raise NovaInvariantError(
                f"frame dimensions must be positive, got {self.width}x{self.height}"
            )

    @property
    def aspect_ratio(self) -> float:
        """Width over height: 1.777… for 16:9, 0.5625 for a vertical 9:16."""
        return self.width / self.height

    @property
    def is_even(self) -> bool:
        """Whether both dimensions are even.

        Every 4:2:0 encoder we ship requires it, so a project that is not even
        is a project that will fail at export rather than now — worth being able
        to ask about.
        """
        return self.width % 2 == 0 and self.height % 2 == 0

    def to_wire(self) -> dict[str, object]:
        return {"width": self.width, "height": self.height}

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> FrameSize:
        _reject_unknown_fields(data, _FRAME_SIZE_FIELDS)
        return cls(width=_wire_int(data, "width"), height=_wire_int(data, "height"))


@dataclass(frozen=True, slots=True, kw_only=True)
class ProjectMetadata:
    """Who made this, and when.

    Timestamps are **passed in**, never read from a clock — a save recorded in a
    test is then reproducible to the millisecond (ADR-0002 rule 1).
    """

    author: str = ""
    description: str = ""
    #: Free-form labels for the project manager's search.
    tags: tuple[str, ...] = ()
    created_ms: int = 0
    modified_ms: int = 0

    def __post_init__(self) -> None:
        if self.created_ms < 0 or self.modified_ms < 0:
            raise NovaInvariantError("timestamps must not be negative")
        if self.modified_ms < self.created_ms:
            raise NovaInvariantError(
                f"modified_ms must not precede created_ms: {self.modified_ms} < {self.created_ms}"
            )
        seen: set[str] = set()
        for tag in self.tags:
            if not tag:
                raise NovaInvariantError("a tag must not be empty")
            if tag in seen:
                raise NovaInvariantError(f"the tag {tag!r} appears twice")
            seen.add(tag)

    def touched(self, modified_ms: int) -> ProjectMetadata:
        """The metadata as of ``modified_ms``.

        Refuses to move backwards: a project that claimed to have been saved
        before it was created would sort wrongly in the project manager, and the
        only way it can happen is a caller passing the wrong clock.
        """
        if modified_ms < self.modified_ms:
            raise NovaInvariantError(
                f"cannot move modified_ms backwards: {modified_ms} < {self.modified_ms}"
            )
        return replace(self, modified_ms=modified_ms)

    def to_wire(self) -> dict[str, object]:
        return {
            "author": self.author,
            "description": self.description,
            "tags": list(self.tags),
            "created_ms": self.created_ms,
            "modified_ms": self.modified_ms,
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> ProjectMetadata:
        _reject_unknown_fields(data, _METADATA_FIELDS)
        return cls(
            author=_wire_str(data, "author"),
            description=_wire_str(data, "description"),
            tags=tuple(_wire_strings(data, "tags")),
            created_ms=_wire_int(data, "created_ms"),
            modified_ms=_wire_int(data, "modified_ms"),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class ProjectSettings:
    """What the whole project renders and mixes to.

    Deliberately small.  Everything here is something a user sets once and then
    lives with, because every field is a thing that makes two projects
    incomparable if it differs.
    """

    frame_size: FrameSize = field(default_factory=FrameSize)
    sample_rate: int = DEFAULT_SAMPLE_RATE
    channels: int = DEFAULT_CHANNELS
    #: Whether preview decodes from a proxy when one exists.  Export ignores
    #: this: a render is a render.
    use_proxies: bool = True
    #: The colour space the compositor works in before the output transform.
    working_colour_space: ColourSpace = ColourSpace.BT709

    def __post_init__(self) -> None:
        if self.sample_rate <= 0:
            raise NovaInvariantError(f"sample_rate must be positive, got {self.sample_rate}")
        if self.channels not in SUPPORTED_CHANNEL_COUNTS:
            raise NovaInvariantError(
                f"channels must be one of {sorted(SUPPORTED_CHANNEL_COUNTS)}, got {self.channels}"
            )

    def to_wire(self) -> dict[str, object]:
        return {
            "frame_size": self.frame_size.to_wire(),
            "sample_rate": self.sample_rate,
            "channels": self.channels,
            "use_proxies": self.use_proxies,
            "working_colour_space": int(self.working_colour_space),
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> ProjectSettings:
        _reject_unknown_fields(data, _SETTINGS_FIELDS)
        return cls(
            frame_size=FrameSize.from_wire(_mapping(data, "frame_size")),
            sample_rate=_wire_int(data, "sample_rate"),
            channels=_wire_int(data, "channels"),
            use_proxies=_wire_bool(data, "use_proxies"),
            working_colour_space=ColourSpace(_wire_int(data, "working_colour_space")),
        )


# ---------------------------------------------------------------------------
# Bindings: what decorates what
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True, kw_only=True)
class EffectBinding:
    """An effect chain attached to a clip, a track, or the output.

    The output has nothing to be named by, so its ``owner_id`` is empty by
    convention rather than by special-casing a sentinel.
    """

    target: EffectTarget
    owner_id: str = ""
    chain: EffectChain = field(default_factory=EffectChain)

    def __post_init__(self) -> None:
        if self.target is not EffectTarget.OUTPUT and not self.owner_id:
            raise NovaInvariantError(f"a {self.target} effect binding must name its owner")
        if self.target is EffectTarget.OUTPUT and self.owner_id:
            raise NovaInvariantError(
                f"an output effect binding has no owner, got {self.owner_id!r}"
            )

    @property
    def is_empty(self) -> bool:
        """Whether the binding carries nothing."""
        return self.chain.is_empty

    def to_wire(self) -> dict[str, object]:
        return {
            "target": str(self.target),
            "owner_id": self.owner_id,
            "chain": self.chain.to_wire(),
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> EffectBinding:
        _reject_unknown_fields(data, _EFFECT_BINDING_FIELDS)
        return cls(
            target=EffectTarget(_wire_str(data, "target")),
            owner_id=_wire_str(data, "owner_id"),
            chain=EffectChain.from_wire(_mapping(data, "chain")),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class TransformBinding:
    """The geometry of one clip."""

    clip_id: str
    transform: Transform = field(default_factory=Transform)

    def __post_init__(self) -> None:
        if not self.clip_id:
            raise NovaInvariantError("a transform binding must name its clip")

    def to_wire(self) -> dict[str, object]:
        return {"clip_id": self.clip_id, "transform": self.transform.to_wire()}

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> TransformBinding:
        _reject_unknown_fields(data, _TRANSFORM_BINDING_FIELDS)
        return cls(
            clip_id=_wire_str(data, "clip_id"),
            transform=Transform.from_wire(_mapping(data, "transform")),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class MaskBinding:
    """The masks applied to one clip, in the order they are evaluated."""

    clip_id: str
    masks: tuple[Mask, ...] = ()

    def __post_init__(self) -> None:
        if not self.clip_id:
            raise NovaInvariantError("a mask binding must name its clip")
        seen: set[str] = set()
        for mask in self.masks:
            if mask.mask_id in seen:
                raise NovaInvariantError(
                    f"clip {self.clip_id!r} has two masks called {mask.mask_id!r}"
                )
            seen.add(mask.mask_id)

    def to_wire(self) -> dict[str, object]:
        return {"clip_id": self.clip_id, "masks": [mask.to_wire() for mask in self.masks]}

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> MaskBinding:
        _reject_unknown_fields(data, _MASK_BINDING_FIELDS)
        return cls(
            clip_id=_wire_str(data, "clip_id"),
            masks=tuple(Mask.from_wire(entry) for entry in _wire_mappings(data, "masks")),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class BlendBinding:
    """How one clip or track combines with what is beneath it."""

    target: EffectTarget = EffectTarget.CLIP
    owner_id: str = ""
    mode: BlendMode = BlendMode.NORMAL

    def __post_init__(self) -> None:
        if self.target not in _BLENDABLE_TARGETS:
            raise NovaInvariantError(
                f"a blend mode belongs to a clip or a track, not to {self.target}"
            )
        if not self.owner_id:
            raise NovaInvariantError("a blend binding must name its owner")

    @property
    def is_normal(self) -> bool:
        """Whether the binding changes nothing, and so need not be stored."""
        return self.mode is BlendMode.NORMAL

    def to_wire(self) -> dict[str, object]:
        return {
            "target": str(self.target),
            "owner_id": self.owner_id,
            "mode": str(self.mode),
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> BlendBinding:
        _reject_unknown_fields(data, _BLEND_BINDING_FIELDS)
        return cls(
            target=EffectTarget(_wire_str(data, "target")),
            owner_id=_wire_str(data, "owner_id"),
            mode=BlendMode(_wire_str(data, "mode")),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class GradeBinding:
    """A colour grade attached to a clip, a track, or the output.

    The output grade is the one a colourist means by "the look of the film": it
    is applied once, after everything is composited, which is why it is not an
    effect in a chain and has no mix and no order.
    """

    target: EffectTarget
    owner_id: str = ""
    grade: ColourGrade = field(default_factory=ColourGrade)

    def __post_init__(self) -> None:
        if self.target is not EffectTarget.OUTPUT and not self.owner_id:
            raise NovaInvariantError(f"a {self.target} grade binding must name its owner")
        if self.target is EffectTarget.OUTPUT and self.owner_id:
            raise NovaInvariantError(f"an output grade binding has no owner, got {self.owner_id!r}")

    @property
    def is_neutral(self) -> bool:
        """Whether the grade changes nothing, and so need not be stored."""
        return self.grade.is_neutral

    def to_wire(self) -> dict[str, object]:
        return {
            "target": str(self.target),
            "owner_id": self.owner_id,
            "grade": self.grade.to_wire(),
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> GradeBinding:
        _reject_unknown_fields(data, _GRADE_BINDING_FIELDS)
        return cls(
            target=EffectTarget(_wire_str(data, "target")),
            owner_id=_wire_str(data, "owner_id"),
            grade=ColourGrade.from_wire(_mapping(data, "grade")),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class CaptionDocumentRef:
    """One caption document, and the name it is filed under in the container.

    The id is validated against :func:`is_valid_document_name` because a
    ``.nova`` file is a ZIP: a crafted id is the zip-slip attack, and the rule
    belongs where the id is accepted rather than where it is written.
    """

    document_id: str
    document: CaptionDocument

    def __post_init__(self) -> None:
        if not is_valid_document_name(caption_document(self.document_id)):
            raise NovaInvariantError(
                f"caption document id {self.document_id!r} is not a safe document name"
            )

    @property
    def document_name(self) -> str:
        """Where this document lives inside the archive."""
        return caption_document(self.document_id)

    def to_wire(self) -> dict[str, object]:
        return {"document_id": self.document_id, "document": self.document.to_wire()}

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> CaptionDocumentRef:
        _reject_unknown_fields(data, _CAPTION_REF_FIELDS)
        return cls(
            document_id=_wire_str(data, "document_id"),
            document=CaptionDocument.from_wire(_mapping(data, "document")),
        )


# ---------------------------------------------------------------------------
# The aggregate root
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True, kw_only=True)
class Project:
    """A Nova Studio project: identity, settings, media, edit and captions.

    The whole object is immutable, and every edit is a ``with_*`` call that
    returns a new one.  That is what makes a command's undo a stored previous
    value (ADR-0008) rather than an inverse operation that can drift.
    """

    project_id: EntityId
    name: str
    metadata: ProjectMetadata = field(default_factory=ProjectMetadata)
    settings: ProjectSettings = field(default_factory=ProjectSettings)
    #: The media bin.  Clips reference these by id, never by path.
    assets: tuple[MediaAsset, ...] = ()
    timeline: Timeline = field(default_factory=Timeline)
    captions: tuple[CaptionDocumentRef, ...] = ()
    #: What decorates what.  Kept here, not on the entities, so that deleting a
    #: clip is one pruning pass (see :meth:`with_timeline`).
    effects: tuple[EffectBinding, ...] = ()
    transforms: tuple[TransformBinding, ...] = ()
    masks: tuple[MaskBinding, ...] = ()
    blends: tuple[BlendBinding, ...] = ()
    #: Colour grading, keyed the same way.  Separate from the effect chains
    #: because a grade has no order and no mix: it is one set of corrections
    #: applied after the picture is assembled (§7.11).
    grades: tuple[GradeBinding, ...] = ()

    def __post_init__(self) -> None:
        if not self.project_id:
            raise NovaInvariantError("a project must carry an id")
        if not self.name:
            raise NovaInvariantError("a project must have a name")
        _refuse_duplicates("asset", [str(asset.asset_id) for asset in self.assets])
        _refuse_duplicates("caption document", [ref.document_id for ref in self.captions])
        _refuse_duplicates(
            "effect binding",
            [f"{binding.target}:{binding.owner_id}" for binding in self.effects],
        )
        _refuse_duplicates("transform binding", [binding.clip_id for binding in self.transforms])
        _refuse_duplicates("mask binding", [binding.clip_id for binding in self.masks])
        _refuse_duplicates(
            "blend binding",
            [f"{binding.target}:{binding.owner_id}" for binding in self.blends],
        )
        _refuse_duplicates(
            "grade binding",
            [f"{binding.target}:{binding.owner_id}" for binding in self.grades],
        )

    # -- identity and shape -------------------------------------------------

    @property
    def timebase(self) -> Timebase:
        """The project's frame rate, read from the timeline that owns it.

        There is no second copy: a setting that could disagree with the edit it
        describes is a bug waiting for a user to find it.
        """
        return self.timeline.timebase

    @property
    def duration_frames(self) -> int:
        """How long the edit is, in frames."""
        return self.timeline.duration_frames

    def duration_seconds(self) -> float:
        """How long the edit is, in seconds.  For display and audio only."""
        return frames_to_seconds(self.duration_frames, self.timebase)

    @property
    def is_empty(self) -> bool:
        """Whether there is anything in the project at all."""
        return not self.assets and self.timeline.is_empty and not self.captions

    @property
    def asset_count(self) -> int:
        """How many assets are in the bin."""
        return len(self.assets)

    @property
    def clip_count(self) -> int:
        """How many clips the edit holds."""
        return self.timeline.clip_count

    @property
    def caption_count(self) -> int:
        """How many caption documents the project carries."""
        return len(self.captions)

    def renamed(self, name: str) -> Project:
        """The project under a new name."""
        if not name:
            raise NovaInvariantError("a project must have a name")
        return replace(self, name=name)

    def touched(self, modified_ms: int) -> Project:
        """The project as of ``modified_ms``."""
        return replace(self, metadata=self.metadata.touched(modified_ms))

    def validate(self) -> str:
        """``""`` when the project is consistent, otherwise the first problem."""
        return validate_project(self)

    # -- assets -------------------------------------------------------------

    def asset(self, asset_id: str) -> MediaAsset | None:
        """One asset by id, or ``None`` if the bin does not hold it."""
        for asset in self.assets:
            if asset.asset_id == asset_id:
                return asset
        return None

    def with_asset(self, asset: MediaAsset) -> Project:
        """The project with ``asset`` added to the bin.

        :raises NovaInvariantError: if its id is already there.
        """
        if self.asset(str(asset.asset_id)) is not None:
            raise NovaInvariantError(f"asset '{asset.asset_id}' is already in this project")
        return replace(self, assets=(*self.assets, asset))

    def without_asset(self, asset_id: str) -> Project:
        """The project with one asset removed from the bin.

        Refused while the edit still uses it: an asset silently dropped out from
        under a clip is the worst kind of missing media, because nothing tells
        the user what happened.  Delete the clips first.

        :raises NovaInvariantError: if it is not in the bin, or is in use.
        """
        if self.asset(asset_id) is None:
            raise NovaInvariantError(f"asset '{asset_id}' is not in this project")
        used_by = self.clip_count_for_asset(asset_id)
        if used_by:
            raise NovaInvariantError(
                f"asset '{asset_id}' is used by {used_by} clip(s); "
                "remove the clips before removing the asset"
            )
        return replace(self, assets=tuple(a for a in self.assets if a.asset_id != asset_id))

    def relink_asset(
        self,
        asset_id: str,
        new_path: str,
        *,
        content_hash: ContentHash | None = None,
        probe: MediaInfo | None = None,
    ) -> Project:
        """Point one asset at a new file, keeping the edit's geometry valid.

        This is the relink workflow of ADR-0015 rule 3: a moved folder is one
        operation, not a hundred edits, because clips reference the asset id and
        never the path.
        """
        asset = self.asset(asset_id)
        if asset is None:
            raise NovaInvariantError(f"asset '{asset_id}' is not in this project")
        relinked = asset.relink(new_path, content_hash=content_hash, probe=probe)
        return replace(
            self, assets=tuple(relinked if a.asset_id == asset_id else a for a in self.assets)
        )

    def referenced_asset_ids(self) -> frozenset[str]:
        """Every asset the edit actually uses.

        Generated clips — solids, adjustment layers, text — need no asset and so
        are not counted, which is what makes "remove unused media" safe.
        """
        return frozenset(
            clip.asset_id
            for track in self.timeline.tracks
            for clip in track.clips
            if not clip.is_generated
        )

    def clip_count_for_asset(self, asset_id: str) -> int:
        """How many clips use one asset."""
        return sum(
            1
            for track in self.timeline.tracks
            for clip in track.clips
            if clip.asset_id == asset_id and not clip.is_generated
        )

    def missing_assets(self) -> tuple[MediaAsset, ...]:
        """Assets the edit uses whose files are not where the project says.

        Missing media is a state, not an error: the project opens, the timeline
        keeps its geometry, and this is the list the relink panel shows.
        """
        referenced = self.referenced_asset_ids()
        return tuple(
            asset
            for asset in self.assets
            if str(asset.asset_id) in referenced and not asset.is_linked
        )

    def unused_assets(self) -> tuple[MediaAsset, ...]:
        """Assets in the bin that no clip uses."""
        referenced = self.referenced_asset_ids()
        return tuple(asset for asset in self.assets if str(asset.asset_id) not in referenced)

    # -- the edit -----------------------------------------------------------

    def clip(self, clip_id: str) -> object | None:
        """One clip by id, from any track."""
        return self.timeline.clip(clip_id)

    def track(self, track_id: str) -> object | None:
        """One track by id."""
        return self.timeline.track(track_id)

    def with_timeline(self, timeline: Timeline) -> Project:
        """The project with a new edit, pruning bindings whose owners are gone.

        Deleting a clip must take its effects, its transform, its masks and its
        blend mode with it.  Doing that here — in one pass, at the one place
        where the whole edit is replaced — is why the bindings live on the
        project rather than on the entities they decorate.
        """
        return replace(
            self,
            timeline=timeline,
            effects=tuple(
                binding
                for binding in self.effects
                if _owner_exists(timeline, binding.target, binding.owner_id)
            ),
            transforms=tuple(
                binding for binding in self.transforms if timeline.clip(binding.clip_id)
            ),
            masks=tuple(binding for binding in self.masks if timeline.clip(binding.clip_id)),
            blends=tuple(
                binding
                for binding in self.blends
                if _owner_exists(timeline, binding.target, binding.owner_id)
            ),
            grades=tuple(
                binding
                for binding in self.grades
                if _owner_exists(timeline, binding.target, binding.owner_id)
            ),
        )

    # -- effects and looks --------------------------------------------------

    def effect_chain_for(self, target: EffectTarget, owner_id: str = "") -> EffectChain:
        """The effect chain attached to a clip, a track, or the output."""
        for binding in self.effects:
            if binding.target is target and binding.owner_id == owner_id:
                return binding.chain
        return EffectChain()

    def with_effects(self, target: EffectTarget, owner_id: str, chain: EffectChain) -> Project:
        """Attach an effect chain to a clip, a track, or the output.

        An empty chain *removes* the binding rather than storing an empty one,
        so a project that has had all its effects deleted looks like a project
        that never had any.

        :raises NovaInvariantError: if the owner does not exist.
        """
        _require_owner(self.timeline, target, owner_id)
        kept = tuple(
            binding
            for binding in self.effects
            if not (binding.target is target and binding.owner_id == owner_id)
        )
        if chain.is_empty:
            return replace(self, effects=kept)
        binding = EffectBinding(target=target, owner_id=owner_id, chain=chain)
        return replace(self, effects=(*kept, binding))

    def without_effects(self, target: EffectTarget, owner_id: str) -> Project:
        """Detach the effect chain from a clip, a track, or the output.

        :raises NovaInvariantError: if there is no such binding.
        """
        kept = tuple(
            binding
            for binding in self.effects
            if not (binding.target is target and binding.owner_id == owner_id)
        )
        if len(kept) == len(self.effects):
            raise NovaInvariantError(f"there is no {target} effect chain on '{owner_id}' to remove")
        return replace(self, effects=kept)

    def transform_for(self, clip_id: str) -> Transform:
        """The geometry of one clip; the identity when it has none."""
        for binding in self.transforms:
            if binding.clip_id == clip_id:
                return binding.transform
        return Transform()

    def with_transform(self, clip_id: str, transform: Transform) -> Project:
        """Set one clip's geometry.

        An unanimated identity transform removes the binding, so a clip the user
        has never touched carries nothing at all.

        :raises NovaInvariantError: if the clip does not exist.
        """
        if self.timeline.clip(clip_id) is None:
            raise NovaInvariantError(f"there is no clip '{clip_id}' in this project")
        kept = tuple(binding for binding in self.transforms if binding.clip_id != clip_id)
        if transform.is_static and transform.at(0).is_identity:
            return replace(self, transforms=kept)
        return replace(
            self,
            transforms=(*kept, TransformBinding(clip_id=clip_id, transform=transform)),
        )

    def masks_for(self, clip_id: str) -> tuple[Mask, ...]:
        """The masks on one clip, in evaluation order."""
        for binding in self.masks:
            if binding.clip_id == clip_id:
                return binding.masks
        return ()

    def with_masks(self, clip_id: str, masks: tuple[Mask, ...] = ()) -> Project:
        """Set one clip's masks; an empty tuple removes the binding.

        :raises NovaInvariantError: if the clip does not exist.
        """
        if self.timeline.clip(clip_id) is None:
            raise NovaInvariantError(f"there is no clip '{clip_id}' in this project")
        kept = tuple(binding for binding in self.masks if binding.clip_id != clip_id)
        if not masks:
            return replace(self, masks=kept)
        return replace(self, masks=(*kept, MaskBinding(clip_id=clip_id, masks=masks)))

    def blend_for(self, target: EffectTarget, owner_id: str) -> BlendMode:
        """How one clip or track combines with what is beneath it."""
        for binding in self.blends:
            if binding.target is target and binding.owner_id == owner_id:
                return binding.mode
        return BlendMode.NORMAL

    def with_blend(self, target: EffectTarget, owner_id: str, mode: BlendMode) -> Project:
        """Set the blend mode of one clip or track; ``NORMAL`` removes it.

        :raises NovaInvariantError: if the owner does not exist, or the target
            is the output, which has nothing beneath it to blend with.
        """
        if target not in _BLENDABLE_TARGETS:
            raise NovaInvariantError(f"a blend mode belongs to a clip or a track, not to {target}")
        _require_owner(self.timeline, target, owner_id)
        kept = tuple(
            binding
            for binding in self.blends
            if not (binding.target is target and binding.owner_id == owner_id)
        )
        if mode is BlendMode.NORMAL:
            return replace(self, blends=kept)
        return replace(
            self,
            blends=(*kept, BlendBinding(target=target, owner_id=owner_id, mode=mode)),
        )

    def grade_for(self, target: EffectTarget, owner_id: str = "") -> ColourGrade:
        """The grade on a clip, a track, or the output; neutral when there is
        none."""
        for binding in self.grades:
            if binding.target is target and binding.owner_id == owner_id:
                return binding.grade
        return ColourGrade()

    def with_grade(self, target: EffectTarget, owner_id: str, grade: ColourGrade) -> Project:
        """Attach a grade to a clip, a track, or the output.

        A *neutral* grade removes the binding instead of storing one, so a
        project nobody has graded carries no grade bindings at all.

        :raises NovaInvariantError: if the owner does not exist.
        """
        _require_owner(self.timeline, target, owner_id)
        kept = tuple(
            binding
            for binding in self.grades
            if not (binding.target is target and binding.owner_id == owner_id)
        )
        if grade.is_neutral:
            return replace(self, grades=kept)
        binding = GradeBinding(target=target, owner_id=owner_id, grade=grade)
        return replace(self, grades=(*kept, binding))

    def without_grade(self, target: EffectTarget, owner_id: str) -> Project:
        """Detach the grade from a clip, a track, or the output.

        :raises NovaInvariantError: if there is no such binding.
        """
        kept = tuple(
            binding
            for binding in self.grades
            if not (binding.target is target and binding.owner_id == owner_id)
        )
        if len(kept) == len(self.grades):
            raise NovaInvariantError(f"there is no {target} grade on '{owner_id}' to remove")
        return replace(self, grades=kept)

    # -- captions -----------------------------------------------------------

    def caption(self, document_id: str) -> CaptionDocument | None:
        """One caption document by id, or ``None`` if there is no such document."""
        for ref in self.captions:
            if ref.document_id == document_id:
                return ref.document
        return None

    def with_caption(self, ref: CaptionDocumentRef) -> Project:
        """Add or replace one caption document, keeping its place in the list.

        :raises NovaInvariantError: if the id is not a safe document name.
        """
        kept = tuple(item for item in self.captions if item.document_id != ref.document_id)
        index = len(kept)
        for position, item in enumerate(self.captions):
            if item.document_id == ref.document_id:
                index = position
                break
        ordered = (*kept[:index], ref, *kept[index:])
        return replace(self, captions=ordered)

    def without_caption(self, document_id: str) -> Project:
        """Remove one caption document.

        :raises NovaInvariantError: if there is no such document.
        """
        kept = tuple(item for item in self.captions if item.document_id != document_id)
        if len(kept) == len(self.captions):
            raise NovaInvariantError(f"there is no caption document '{document_id}'")
        return replace(self, captions=kept)

    # -- persistence --------------------------------------------------------

    def to_wire(self) -> dict[str, object]:
        """The whole project as one canonical document.

        This is what autosave, a checkpoint and an integrity digest are taken
        over: one document, one digest, one thing to diff.  The ``.nova``
        container files the same content across several entries — see
        :meth:`to_documents`.
        """
        return {
            "project_id": str(self.project_id),
            "name": self.name,
            "metadata": self.metadata.to_wire(),
            "settings": self.settings.to_wire(),
            "assets": [asset.to_wire() for asset in self.assets],
            "timeline": self.timeline.to_wire(),
            "captions": [ref.to_wire() for ref in self.captions],
            "effects": [binding.to_wire() for binding in self.effects],
            "transforms": [binding.to_wire() for binding in self.transforms],
            "masks": [binding.to_wire() for binding in self.masks],
            "blends": [binding.to_wire() for binding in self.blends],
            "grades": [binding.to_wire() for binding in self.grades],
        }

    @classmethod
    def from_wire(cls, data: Mapping[str, object]) -> Project:
        _reject_unknown_fields(data, _PROJECT_FIELDS)
        return cls(
            project_id=EntityId(_wire_str(data, "project_id")),
            name=_wire_str(data, "name"),
            metadata=ProjectMetadata.from_wire(_mapping(data, "metadata")),
            settings=ProjectSettings.from_wire(_mapping(data, "settings")),
            assets=tuple(MediaAsset.from_wire(entry) for entry in _wire_mappings(data, "assets")),
            timeline=Timeline.from_wire(_mapping(data, "timeline")),
            captions=tuple(
                CaptionDocumentRef.from_wire(entry) for entry in _wire_mappings(data, "captions")
            ),
            effects=tuple(
                EffectBinding.from_wire(entry) for entry in _wire_mappings(data, "effects")
            ),
            transforms=tuple(
                TransformBinding.from_wire(entry) for entry in _wire_mappings(data, "transforms")
            ),
            masks=tuple(MaskBinding.from_wire(entry) for entry in _wire_mappings(data, "masks")),
            blends=tuple(BlendBinding.from_wire(entry) for entry in _wire_mappings(data, "blends")),
            grades=tuple(GradeBinding.from_wire(entry) for entry in _wire_mappings(data, "grades")),
        )

    def to_documents(self) -> ProjectDocuments:
        """The same content, filed the way a ``.nova`` container stores it.

        ``project.json`` carries everything except the edit and the captions;
        the timeline graph is ``timeline/document.json`` and each caption
        document is ``captions/<document_id>.json`` (ADR-0015).  Splitting here
        rather than in the adapter means the split itself is tested.
        """
        wire = self.to_wire()
        return ProjectDocuments(
            project={key: wire[key] for key in sorted(PROJECT_DOCUMENT_FIELDS)},
            timeline=self.timeline.to_wire(),
            captions=tuple((ref.document_id, ref.document.to_wire()) for ref in self.captions),
        )

    @classmethod
    def from_documents(cls, documents: ProjectDocuments) -> Project:
        """Rebuild a project from the container's entries."""
        return cls.from_wire(
            {
                **documents.project,
                "timeline": documents.timeline,
                "captions": [
                    {"document_id": document_id, "document": document}
                    for document_id, document in documents.captions
                ],
            }
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class ProjectDocuments:
    """A project split into the entries of a ``.nova`` container.

    Plain mappings, because this is the boundary: everything past here is bytes
    on their way to a ZIP.
    """

    #: ``project.json`` — identity, settings, media bin and bindings.
    project: Mapping[str, object]
    #: ``timeline/document.json`` — the authoritative edit.
    timeline: Mapping[str, object]
    #: ``captions/<document_id>.json``, one per document.
    captions: tuple[tuple[str, Mapping[str, object]], ...] = ()


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_project(project: Project) -> str:
    """Return ``""`` or a sentence saying the first thing that is wrong.

    The checks are the ones only the aggregate can make — the ones that need
    more than one of its parts at a time.  Each part validates its own internal
    rules; this is about the seams between them.

    Every problem is reported rather than raised, because a project that fails
    one of these is still the user's work and must still open (ADR-0015 rule 3).
    """
    structural = project.timeline.validate()
    if structural:
        return structural

    known = {str(asset.asset_id) for asset in project.assets}
    for track in project.timeline.tracks:
        for clip in track.clips:
            if not clip.is_generated and clip.asset_id not in known:
                return (
                    f"clip '{clip.clip_id}' references asset '{clip.asset_id}', "
                    "which is not in this project"
                )

    for effect in project.effects:
        if not _owner_exists(project.timeline, effect.target, effect.owner_id):
            return (
                f"an effect chain is bound to {effect.target} "
                f"'{effect.owner_id}', which is not in this project"
            )

    for transform in project.transforms:
        if project.timeline.clip(transform.clip_id) is None:
            return (
                f"a transform is bound to clip '{transform.clip_id}', which is not in this project"
            )

    for mask in project.masks:
        if project.timeline.clip(mask.clip_id) is None:
            return f"masks are bound to clip '{mask.clip_id}', which is not in this project"

    for blend in project.blends:
        if not _owner_exists(project.timeline, blend.target, blend.owner_id):
            return (
                f"a blend mode is bound to {blend.target} "
                f"'{blend.owner_id}', which is not in this project"
            )

    for grade in project.grades:
        if not _owner_exists(project.timeline, grade.target, grade.owner_id):
            return (
                f"a grade is bound to {grade.target} "
                f"'{grade.owner_id}', which is not in this project"
            )

    for ref in project.captions:
        problem = validate_caption_document(ref.document)
        if problem:
            return f"caption document '{ref.document_id}': {problem}"

    return ""


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _owner_exists(timeline: Timeline, target: EffectTarget, owner_id: str) -> bool:
    """Whether the thing a binding names is present in the edit."""
    if target is EffectTarget.OUTPUT:
        return owner_id == ""
    if target is EffectTarget.CLIP:
        return timeline.clip(owner_id) is not None
    return timeline.track(owner_id) is not None


def _require_owner(timeline: Timeline, target: EffectTarget, owner_id: str) -> None:
    if not _owner_exists(timeline, target, owner_id):
        raise NovaInvariantError(f"cannot bind to {target} '{owner_id}': it is not in this project")


def _refuse_duplicates(label: str, ids: list[str]) -> None:
    seen: set[str] = set()
    for identifier in ids:
        if identifier in seen:
            raise NovaInvariantError(f"two {label}s share the id '{identifier}'")
        seen.add(identifier)


def _mapping(data: Mapping[str, object], key: str) -> Mapping[str, object]:
    raw = data[key]
    if not isinstance(raw, Mapping):
        raise NovaInvariantError(f"'{key}' must be a mapping, got {type(raw).__name__}")
    return raw
