"""L3 — the frame plan: the recipe for one composed frame.

``media-and-rendering.md`` §7.2 states the invariant this module exists to make
real: **preview and export use the same code path.**  They do not share a
renderer, a resolution or a deadline — but they must share the *recipe*, because
the classic NLE bug class is "the preview looked different from the export".
So the recipe is a value: :class:`FramePlan`, built from a project and a frame
number, carrying everything a compositor needs and nothing about who asked.

What the plan decides, and what it deliberately does not:

* **It decides what contributes and in what order.**  That is
  ``Timeline.resolve``, bottom first — the domain's answer, reused rather than
  re-derived, so a renderer and a test agree with the timeline by construction.
* **It decides what each layer carries into the composite.**  A layer's effects
  come from the project's bindings in a fixed order — the clip's own chain, then
  its track's — because a track is the bus a clip is sent through, not another
  effect on the clip.  Grades follow the same order.  Neutral grades and empty
  chains are dropped, so "most clips in most projects" cost nothing.
* **It does not decide which file to decode.**  That is the media layer's
  policy (§5 of ``services.md``), and features do not import each other
  (rule 2); the caller passes the answer per asset and the plan records it.
* **It does not decode, composite or encode.**  Frames come from
  ``ports/media``, pixels from the compositor, and bytes from ``ports/render``.
  This module is the sheet of paper they are all reading from.

The result is pure and total: ``plan_frame(project, frame)`` is a function of
its arguments, so a plan can be cached, compared in a test, or handed to a
process without carrying a decoder with it.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum
from typing import TYPE_CHECKING

from nova_studio.domain.effects import EffectTarget
from nova_studio.domain.timeline import TrackKind, TransitionEdge, bake_transition

if TYPE_CHECKING:
    from collections.abc import Iterator, Mapping, Sequence

    from nova_studio.domain.effects import EffectChain, Transform
    from nova_studio.domain.grade import ColourGrade
    from nova_studio.domain.project import Project
    from nova_studio.domain.timeline import Clip, Track, Transition, TransitionMix

__all__ = [
    "DECODE_FROM_ORIGINAL",
    "DecodeRequest",
    "FramePlan",
    "LayerPlan",
    "TransitionRole",
    "plan_frame",
    "plan_frames",
]

#: The default source: the user's footage, at full resolution.  Spelled as a
#: string and not an enum, because the decision belongs to the media feature and
#: features do not import each other's types (`services/__init__.py` rule 2).
DECODE_FROM_ORIGINAL: str = "original"


class TransitionRole(StrEnum):
    """Which side of a transition a layer is.

    A transition is a recipe for two pictures, and the compositor has to know
    which is which: :attr:`TransitionMix` gives each its own opacity, offset and
    scale, and swapping them is not a subtle error — a push becomes a pull.

    The domain hangs a transition off *one* clip (delete the clip and its
    transitions go with it), so who is on top is decided here, once, from the
    edge: a transition on a clip's in-point is the arrival of that clip, and one
    on its out-point is its departure.
    """

    #: The picture being revealed: drawn above the outgoing one.
    INCOMING = "incoming"
    #: The picture being replaced: drawn underneath, holding its last frame.
    OUTGOING = "outgoing"


@dataclass(frozen=True, slots=True, kw_only=True)
class DecodeRequest:
    """One picture the compositor needs for one layer.

    A plan's :attr:`FramePlan.decodes` is what the media layer turns into actual
    reads; asking for them up front is what lets a renderer fetch twelve frames
    in one pass instead of discovering them one layer at a time.
    """

    clip_id: str
    asset_id: str
    #: The frame to read, in the source's own numbering.
    source_frame: int
    #: Which copy to read: ``"original"``, ``"proxy"`` or ``"thumbnail"``.
    source: str = DECODE_FROM_ORIGINAL

    @property
    def key(self) -> tuple[str, int, str]:
        """Identity of this read, for deduplication and cache keys."""
        return (self.asset_id, self.source_frame, self.source)


@dataclass(frozen=True, slots=True, kw_only=True)
class LayerPlan:
    """One clip's contribution to one frame, fully described.

    Bottom-first order is the caller's job; a layer knows only what it carries.
    """

    clip: Clip
    track: Track
    #: The source frame to decode, clamped to the clip by the domain.
    source_frame: int
    #: Which copy to read.  Carried rather than decided — see the module note.
    source: str = DECODE_FROM_ORIGINAL
    #: Where the layer sits on the frame.  Every clip has one, touched or not.
    transform: Transform | None = None
    #: Effect chains in application order: the clip's own, then its track's.
    effects: tuple[EffectChain, ...] = ()
    #: Grades in application order: the clip's own, then its track's.  Neutral
    #: grades are omitted, because most clips in most projects are ungraded.
    grades: tuple[ColourGrade, ...] = ()
    #: The A/B mix when this layer is mid-transition, else ``None``.  Carried
    #: by *both* layers of a pair: the mix names what to do with each picture,
    #: so neither side is interpretable without it.
    transition: TransitionMix | None = None
    #: Which side of the transition this layer is, if any.
    transition_role: TransitionRole | None = None

    @property
    def clip_id(self) -> str:
        """The clip this layer is showing."""
        return self.clip.clip_id

    @property
    def needs_decode(self) -> bool:
        """Whether a picture has to be read for this layer.

        A generated clip — a colour field, a title, a committed caption — is
        drawn, not decoded, and asking the media layer for it is a waste of a
        seek and a bug report about a missing file.
        """
        return not self.clip.is_generated

    @property
    def is_transitioning(self) -> bool:
        """Whether this layer is mid-transition."""
        return self.transition_role is not None

    @property
    def is_incoming(self) -> bool:
        """Whether this layer is the one being revealed."""
        return self.transition_role is TransitionRole.INCOMING

    def decode(self) -> DecodeRequest | None:
        """What to read for this layer, or ``None`` for a generated one."""
        if not self.needs_decode:
            return None
        return DecodeRequest(
            clip_id=self.clip.clip_id,
            asset_id=self.clip.asset_id,
            source_frame=self.source_frame,
            source=self.source,
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class FramePlan:
    """Everything one composed frame needs, and nothing about who asked.

    ``layers`` is bottom first, matching :class:`ResolvedFrame`.  The output
    stage — the chain and the grade that apply to the composited result rather
    than to any one clip — is carried here rather than on a layer, because that
    is what "the look of the film" means: applied once, at the end.
    """

    frame: int
    layers: tuple[LayerPlan, ...] = ()
    #: Effects applied to the composited frame, after every layer.
    output_effects: EffectChain | None = None
    #: The output grade.  Colour runs last (§7.2), so this is the final stage.
    output_grade: ColourGrade | None = None
    #: The composition size in composition pixels: ``(width, height)``.
    size: tuple[int, int] = (0, 0)

    @property
    def is_empty(self) -> bool:
        """Whether anything at all is showing.

        A frame between clips is not an error and not a black frame the
        compositor has to draw: it is nothing, and the pipeline may skip every
        stage below the composite.
        """
        return not self.layers

    @property
    def layer_count(self) -> int:
        """How many layers this frame composites."""
        return len(self.layers)

    @property
    def top(self) -> LayerPlan | None:
        """The topmost layer, or ``None`` on an empty frame."""
        return self.layers[-1] if self.layers else None

    @property
    def is_transitioning(self) -> bool:
        """Whether any layer is mid-transition."""
        return any(layer.is_transitioning for layer in self.layers)

    def decodes(self) -> tuple[DecodeRequest, ...]:
        """Every picture this frame needs, deduplicated, in layer order.

        Two layers of the same clip at the same source frame — a clip split and
        left in place, or a transition holding the last frame — are one read.
        """
        seen: set[tuple[str, int, str]] = set()
        requests: list[DecodeRequest] = []
        for layer in self.layers:
            request = layer.decode()
            if request is None or request.key in seen:
                continue
            seen.add(request.key)
            requests.append(request)
        return tuple(requests)

    @property
    def decode_count(self) -> int:
        """How many pictures this frame needs.  Zero for an empty frame."""
        return len(self.decodes())


def plan_frame(
    project: Project,
    frame: int,
    *,
    sources: Mapping[str, str] | None = None,
    default_source: str = DECODE_FROM_ORIGINAL,
) -> FramePlan:
    """Build the recipe for one frame of one project.

    Args:
        project: The project being rendered.  The plan needs the whole project,
            not just its timeline, because effects, grades and transforms are
            bound there.
        frame: The timeline frame, in project frames.
        sources: Which copy of each asset to decode, keyed by asset id.  Decided
            by the media layer and passed in, because this feature does not
            import that one.  A missing entry falls back to ``default_source``.
        default_source: What to use for an asset with no entry.

    Returns:
        A plan.  It never fails for a *frame* — an out-of-range frame plans as
        empty, because a render runs past the end of a timeline by design — but
        it raises :class:`NovaInvariantError` for a negative frame, which is a
        bug in the caller.
    """
    timeline = project.timeline
    chosen = sources or {}
    layers: list[LayerPlan] = []
    position_of: dict[str, int] = {}

    def layer_for(clip: Clip, track: Track, *, source_frame: int | None = None) -> LayerPlan:
        return LayerPlan(
            clip=clip,
            track=track,
            source_frame=(clip.source_frame_at(frame) if source_frame is None else source_frame),
            source=chosen.get(clip.asset_id, default_source),
            transform=project.transform_for(clip.clip_id),
            effects=_chains(project, clip_id=clip.clip_id, track_id=track.track_id),
            grades=_grades(project, clip_id=clip.clip_id, track_id=track.track_id),
        )

    def add(clip: Clip, track: Track) -> None:
        """Put a layer in, once, keeping the order it was first asked for.

        Identity is the clip: the same clip can be reached twice at one frame —
        a transition's partner that is also on screen in its own right — and it
        is still one layer, holding one picture.
        """
        if clip.clip_id in position_of:
            return
        position_of[clip.clip_id] = len(layers)
        layers.append(layer_for(clip, track))

    def place(
        clip: Clip,
        track: Track,
        *,
        mix: TransitionMix,
        role: TransitionRole,
        below: str,
    ) -> None:
        """Put a layer in directly beneath ``below``.

        The outgoing half of a transition is only ever planned once its partner
        is known to be on screen — and the partner may already have been planned
        as an ordinary layer, which would leave the outgoing one on top of it.
        """
        layer = replace(layer_for(clip, track), transition=mix, transition_role=role)
        position = position_of.get(below)
        if position is None or clip.clip_id in position_of:
            wear(clip, track, mix=mix, role=role)
            return
        layers.insert(position, layer)
        _reindex(layers, position_of)

    def wear(clip: Clip, track: Track, *, mix: TransitionMix, role: TransitionRole) -> None:
        """Put a transition layer in, or mark the one already there.

        The partner of a centred transition is often on screen in its own
        right — the outgoing clip during the first half of the dissolve — so it
        may already have been planned as an ordinary layer.  It keeps its place
        in the order and gains the mix, rather than being planned twice.
        """
        layer = replace(layer_for(clip, track), transition=mix, transition_role=role)
        position = position_of.get(clip.clip_id)
        if position is None:
            position_of[clip.clip_id] = len(layers)
            layers.append(layer)
        else:
            layers[position] = replace(layers[position], transition=mix, transition_role=role)

    def add_pair(track: Track, owner: Clip, transition: Transition) -> None:
        """Both pictures a transition needs, outgoing first.

        The domain hangs a transition off one clip, but a mix is a recipe for
        two.  The partner is the clip on the other side of the cut, and it
        contributes a *held* frame — :meth:`Clip.source_frame_at` clamps, so an
        outgoing clip holds its last frame and an incoming one its first.
        """
        mix = _mix(transition, owner, frame)
        partner = _partner(track, owner, transition)
        if partner is None:
            # Nothing on the other side: the mix still describes this clip's
            # fade, so it is planned alone rather than dropped.
            alone = (
                TransitionRole.INCOMING
                if transition.edge is TransitionEdge.START
                else (TransitionRole.OUTGOING)
            )
            wear(owner, track, mix=mix, role=alone)
            return
        outgoing, incoming = (
            (partner, owner) if transition.edge is TransitionEdge.START else (owner, partner)
        )
        place(outgoing, track, mix=mix, role=TransitionRole.OUTGOING, below=incoming.clip_id)
        wear(incoming, track, mix=mix, role=TransitionRole.INCOMING)

    resolved = timeline.resolve(frame)
    for contribution in resolved.contributions:
        if contribution.transition is None:
            add(contribution.clip, contribution.track)
        else:
            add_pair(contribution.track, contribution.clip, contribution.transition)

    # A transition whose window lies before its owner's in-point — the first half
    # of a centred dissolve, or an end-aligned one — is invisible to `resolve`,
    # which only reports clips that contain the frame.  Both pictures are still
    # on screen, so the planner finds them here.
    for track in reversed(timeline.tracks):
        if track.hidden or track.kind is TrackKind.ADJUSTMENT:
            continue
        for transition in track.transitions:
            owner = track.clip(transition.clip_id)
            if owner is None or owner.clip_id in position_of:
                continue
            if transition.covers(owner, frame):
                add_pair(track, owner, transition)

    output_effects = project.effect_chain_for(EffectTarget.OUTPUT)
    output_grade = project.grade_for(EffectTarget.OUTPUT)
    return FramePlan(
        frame=frame,
        layers=tuple(layers),
        output_effects=None if output_effects.is_empty else output_effects,
        output_grade=None if output_grade.is_neutral else output_grade,
        size=(project.settings.frame_size.width, project.settings.frame_size.height),
    )


def plan_frames(
    project: Project,
    frames: Sequence[int] | range,
    *,
    sources: Mapping[str, str] | None = None,
    default_source: str = DECODE_FROM_ORIGINAL,
) -> Iterator[FramePlan]:
    """Plan several frames, lazily.

    A generator rather than a tuple: an export plans a hundred thousand frames
    and must not hold them all.  Callers that want a batch take ``islice``.
    """
    for frame in frames:
        yield plan_frame(project, frame, sources=sources, default_source=default_source)


# -- internals ----------------------------------------------------------------


def _reindex(layers: list[LayerPlan], position_of: dict[str, int]) -> None:
    """Rebuild the id → position map after an insertion.

    Frames carry a handful of layers, so rebuilding is cheaper than the bug a
    stale index would cause: an inserted layer shifts everything above it.
    """
    position_of.clear()
    for position, layer in enumerate(layers):
        position_of[layer.clip_id] = position


def _chains(project: Project, *, clip_id: str, track_id: str) -> tuple[EffectChain, ...]:
    """The effect chains a layer runs, in order: the clip's own, then the track's.

    A track chain is the bus the clip is sent through, so it runs after the
    clip's own effects, and an empty chain is dropped rather than carried — a
    compositor that has to test ``is_empty`` per layer per frame is a compositor
    doing the planner's work.
    """
    chains = (
        project.effect_chain_for(EffectTarget.CLIP, clip_id),
        project.effect_chain_for(EffectTarget.TRACK, track_id),
    )
    return tuple(chain for chain in chains if not chain.is_empty)


def _grades(project: Project, *, clip_id: str, track_id: str) -> tuple[ColourGrade, ...]:
    """The grades a layer runs, in the same order as its chains."""
    grades = (
        project.grade_for(EffectTarget.CLIP, clip_id),
        project.grade_for(EffectTarget.TRACK, track_id),
    )
    return tuple(grade for grade in grades if not grade.is_neutral)


def _partner(track: Track, owner: Clip, transition: Transition) -> Clip | None:
    """The clip on the other side of the cut this transition straddles.

    A transition on a clip's in-point reaches *back* over whatever was there
    before; one on its out-point reaches *forward* over whatever comes next.
    A disabled neighbour is not there at all — it contributes nothing to any
    frame — so the search steps over it to the clip that does.

    ``None`` when there is nothing on that side: a dissolve at the head of a
    track fades up from nothing, which :attr:`TransitionMix.fill` describes
    already, and one at the tail fades out to it.
    """
    if transition.edge is TransitionEdge.START:
        before = [
            clip for clip in track.clips if clip.enabled and clip.end_frame <= owner.start_frame
        ]
        return before[-1] if before else None
    after = [clip for clip in track.clips if clip.enabled and clip.start_frame >= owner.end_frame]
    return after[0] if after else None


def _mix(
    transition: Transition,
    clip: Clip,
    frame: int,
) -> TransitionMix:
    """The A/B mix for a layer mid-transition, or ``None``.

    Baked here rather than in the compositor so that the transition stage and
    the test suite evaluate a transition with the same call — and so that a plan
    can be compared without running a pipeline.  A kind this build cannot shape
    falls back to a cross-dissolve inside :func:`bake_transition`, which is why
    a project from a newer Nova Studio still previews.
    """
    return bake_transition(transition.kind, transition.progress(clip, frame))
