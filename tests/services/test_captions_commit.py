"""The caption-to-timeline projection (`services/captions/commit.py`).

ADR-0009 §8 keeps two sources of truth in step: the document an editor writes
captions in, and the clips a timeline shows. This file pins the half that turns
one into the other, and the invariant that makes the reconciliation cheap:

**A commit that changes nothing produces the same clips.** Which is only true
because a clip's id is derived from where the cue is, not minted per commit —
so re-committing an unchanged document is a no-op, and re-transcribing one cue
replaces one clip instead of rebuilding the track.

The applying half lives in `test_timeline_replace_track_clips.py`; the two are
separate on purpose, because this one never needs a timeline.
"""

from __future__ import annotations

import pytest

from nova_studio.core.temporal import Timebase
from nova_studio.domain.captions import (
    DEFAULT_LAYER_ID,
    CaptionDocument,
    CaptionLayer,
    CaptionSegment,
    CaptionWord,
)
from nova_studio.domain.timeline import MIN_CLIP_FRAMES, ClipKind
from nova_studio.services.captions.commit import (
    DEFAULT_CAPTION_TRACK_ID,
    caption_clip,
    clip_id_for,
    commit_document,
    commit_layer,
)

pytestmark = pytest.mark.unit

#: 30 fps, so a millisecond-to-frame test is arithmetic anyone can check.
TB = Timebase(num=30, den=1)


# -- helpers -----------------------------------------------------------------


def _words(text: str, span: tuple[int, int]) -> tuple[CaptionWord, ...]:
    """Words spoken evenly across a span, so none of them falls outside it."""
    start_ms, end_ms = span
    tokens = text.split()
    step = max(1, (end_ms - start_ms) // max(1, len(tokens)))
    return tuple(
        CaptionWord.of(token, start_ms + i * step, start_ms + i * step + step - 1)
        for i, token in enumerate(tokens)
    )


def _cue(
    text: str,
    *,
    start_ms: int = 0,
    end_ms: int = 2_000,
    layer_id: str = DEFAULT_LAYER_ID,
) -> CaptionSegment:
    return CaptionSegment(
        index=0,
        start_ms=start_ms,
        end_ms=end_ms,
        text=text,
        words=_words(text, (start_ms, end_ms)),
        layer_id=layer_id,
    )


def _document(*cues: CaptionSegment, layers: tuple[CaptionLayer, ...] = ()) -> CaptionDocument:
    """A document, with a layer for every id its cues name."""
    named = {cue.layer_id for cue in cues} | {layer.layer_id for layer in layers}
    return CaptionDocument(
        segments=cues,
        layers=tuple(
            CaptionLayer.primary()
            if layer_id == DEFAULT_LAYER_ID
            else CaptionLayer(layer_id=layer_id)
            for layer_id in named
        )
        or (CaptionLayer.primary(),),
    ).reindexed()


# -- one cue, one clip -------------------------------------------------------


class TestOneCueOneClip:
    def test_a_cue_becomes_a_clip(self) -> None:
        assert len(commit_layer(_document(_cue("hello there")), TB).clips) == 1

    def test_the_clip_is_a_caption_clip(self) -> None:
        clip = commit_layer(_document(_cue("hello there")), TB).clips[0]
        assert clip.kind is ClipKind.CAPTION

    def test_the_clip_needs_no_asset(self) -> None:
        """Its content is the document, so there is no asset to point at."""
        clip = commit_layer(_document(_cue("hello there")), TB).clips[0]
        assert clip.asset_id == ""
        assert clip.is_generated is True

    def test_the_clip_carries_the_cue_text_as_its_name(self) -> None:
        clip = commit_layer(_document(_cue("hello there friends")), TB).clips[0]
        assert clip.name == "hello there friends"

    def test_the_clip_starts_where_the_cue_starts(self) -> None:
        clip = commit_layer(_document(_cue("hello there", start_ms=1_000)), TB).clips[0]
        assert clip.start_frame == 30

    def test_the_clip_ends_where_the_cue_ends(self) -> None:
        clip = commit_layer(_document(_cue("hello there", end_ms=3_000)), TB).clips[0]
        assert clip.end_frame == 90

    def test_milliseconds_round_down(self) -> None:
        """A caption includes the frame it starts on, never the one before."""
        clip = commit_layer(_document(_cue("hi", start_ms=50)), TB).clips[0]
        assert clip.start_frame == 1  # 50 ms is 1.5 frames at 30 fps

    def test_a_cue_too_short_to_own_a_frame_still_gets_one(self) -> None:
        clip = commit_layer(_document(_cue("hi", end_ms=10)), TB).clips[0]
        assert clip.duration_frames == MIN_CLIP_FRAMES

    def test_the_track_the_clips_are_for_is_recorded(self) -> None:
        commit = commit_layer(_document(_cue("hi")), TB, track_id="subs")
        assert commit.track_id == "subs"

    def test_the_layer_the_clips_came_from_is_recorded(self) -> None:
        commit = commit_layer(_document(_cue("hi")), TB)
        assert commit.layer_id == DEFAULT_LAYER_ID


# -- the id is derived, not minted -------------------------------------------


class TestTheIdIsTheCuesAddress:
    def test_the_id_names_the_track_the_layer_and_the_place(self) -> None:
        assert clip_id_for("captions", "primary", 3) == "captions.primary.3"

    def test_the_first_cue_is_index_zero(self) -> None:
        commit = commit_layer(_document(_cue("hi"), _cue("there", start_ms=2_000)), TB)
        assert commit.clip_ids == ("captions.primary.0", "captions.primary.1")

    def test_committing_twice_gives_the_same_ids(self) -> None:
        """Otherwise every commit would look like a full rebuild."""
        document = _document(_cue("hi"), _cue("there", start_ms=2_000))
        assert commit_layer(document, TB).clip_ids == commit_layer(document, TB).clip_ids

    def test_committing_twice_gives_the_same_clips(self) -> None:
        document = _document(_cue("hi"), _cue("there", start_ms=2_000))
        assert commit_layer(document, TB).clips == commit_layer(document, TB).clips

    def test_a_translation_gets_its_own_ids(self) -> None:
        clip = commit_layer(_document(_cue("hola", layer_id="es")), TB, layer_id="es").clips[0]
        assert clip.clip_id == "captions.es.0"

    def test_two_layers_never_share_an_id(self) -> None:
        document = _document(_cue("hi"), _cue("hola", layer_id="es"))
        ids = tuple(id_ for commit in commit_document(document, TB) for id_ in commit.clip_ids)
        assert len(ids) == len(set(ids))


# -- the whole document ------------------------------------------------------


class TestTheWholeDocument:
    def test_one_commit_per_layer(self) -> None:
        commits = commit_document(_document(_cue("hi"), _cue("hola", layer_id="es")), TB)
        assert tuple(commit.layer_id for commit in commits) == (DEFAULT_LAYER_ID, "es")

    def test_every_layer_gets_the_same_track_by_default(self) -> None:
        """One track per layer is the caller's choice, not this module's."""
        document = _document(_cue("hi"), _cue("hola", layer_id="es"))
        assert {commit.track_id for commit in commit_document(document, TB)} == {
            DEFAULT_CAPTION_TRACK_ID
        }

    def test_a_document_with_no_cues_commits_nothing(self) -> None:
        commit = commit_layer(_document(), TB)
        assert commit.is_empty is True
        assert commit.clips == ()

    def test_a_layer_that_has_no_cues_commits_nothing(self) -> None:
        assert commit_layer(_document(_cue("hi")), TB, layer_id="es").is_empty is True

    def test_the_clips_are_in_cue_order(self) -> None:
        document = _document(
            _cue("one", start_ms=0, end_ms=2_000),
            _cue("two", start_ms=2_000, end_ms=4_000),
            _cue("three", start_ms=4_000, end_ms=6_000),
        )
        starts = [clip.start_frame for clip in commit_layer(document, TB).clips]
        assert starts == sorted(starts)

    def test_every_cue_of_the_layer_is_committed(self) -> None:
        document = _document(
            _cue("one", start_ms=0, end_ms=2_000),
            _cue("two", start_ms=2_000, end_ms=4_000),
            _cue("three", start_ms=4_000, end_ms=6_000),
        )
        assert len(commit_layer(document, TB).clips) == 3

    def test_a_cue_on_another_layer_is_not_committed_with_this_one(self) -> None:
        assert len(commit_layer(_document(_cue("hi"), _cue("hola", layer_id="es")), TB).clips) == 1


# -- the frame rate ----------------------------------------------------------


class TestTheFrameRate:
    def test_the_same_document_commits_differently_at_another_rate(self) -> None:
        at_30 = caption_clip(_cue("hi", end_ms=1_000), TB)
        at_24 = caption_clip(_cue("hi", end_ms=1_000), Timebase(num=24, den=1))
        assert at_30.duration_frames == 30
        assert at_24.duration_frames == 24

    def test_a_caption_never_starts_before_zero(self) -> None:
        clip = caption_clip(_cue("hi", start_ms=0), TB)
        assert clip.start_frame == 0
