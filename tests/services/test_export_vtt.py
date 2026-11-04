"""WebVTT export (`services/export/vtt.py`).

WebVTT is the one sidecar that knows where a caption goes and who is saying it,
so it is the one with decisions in it — and this file is mostly about those:
the full stop SubRip does not use, the header a browser demands, the three
characters that have to be escaped, and the ``align`` a cue anchored
bottom-left must carry or be rendered in the wrong place.
"""

from __future__ import annotations

import pytest

from nova_studio.domain.captions import (
    CaptionAnchor,
    CaptionDocument,
    CaptionLayer,
    CaptionLayerKind,
    CaptionPosition,
    CaptionSegment,
)
from nova_studio.services.export.codes import ExportErrorCode
from nova_studio.services.export.vtt import to_vtt, vtt_timestamp

pytestmark = pytest.mark.unit


def _cue(
    start_ms: int = 0,
    end_ms: int = 2_000,
    text: str = "a line of caption",
    **over: object,
) -> CaptionSegment:
    return CaptionSegment(
        **{"index": 0, "start_ms": start_ms, "end_ms": end_ms, "text": text, **over}  # type: ignore[arg-type]
    )


def _document(*cues: CaptionSegment) -> CaptionDocument:
    return CaptionDocument.of(*cues)


class TestTheShapeOfAFile:
    def test_it_starts_with_the_header(self):
        assert to_vtt(_document(_cue())).unwrap().startswith("WEBVTT\n\n")

    def test_a_cue_is_a_timing_line_and_the_text(self):
        written = to_vtt(_document(_cue(1_000, 3_000, "Good morning."))).unwrap()
        assert written == "WEBVTT\n\n00:00:01.000 --> 00:00:03.000 align:center\nGood morning.\n"

    def test_cues_are_separated_by_one_blank_line(self):
        written = to_vtt(_document(_cue(0, 1_000, "one"), _cue(1_200, 2_200, "two"))).unwrap()
        assert written.count("\n\n") == 2

    def test_the_file_ends_with_a_newline(self):
        assert to_vtt(_document(_cue())).unwrap().endswith("\n")


class TestTimestamps:
    def test_the_separator_is_a_full_stop(self):
        assert vtt_timestamp(1_234) == "00:00:01.234"

    def test_zero(self):
        assert vtt_timestamp(0) == "00:00:00.000"

    def test_over_an_hour(self):
        assert vtt_timestamp(3_661_234) == "01:01:01.234"

    def test_a_negative_moment_is_clamped_to_zero(self):
        assert vtt_timestamp(-5) == "00:00:00.000"


class TestEscaping:
    def test_an_ampersand(self):
        assert "&amp;" in to_vtt(_document(_cue(text="fish & chips"))).unwrap()

    def test_a_less_than(self):
        assert "3 &lt; 5" in to_vtt(_document(_cue(text="we drank 3 < 5"))).unwrap()

    def test_a_greater_than(self):
        assert "5 &gt; 3" in to_vtt(_document(_cue(text="5 > 3 coffees"))).unwrap()

    def test_plain_text_is_left_alone(self):
        assert "Good morning." in to_vtt(_document(_cue(text="Good morning."))).unwrap()

    def test_a_speaker_name_is_escaped_too(self):
        written = to_vtt(_document(_cue(speaker="a<b"))).unwrap()
        assert "<v a&lt;b>" in written


class TestVoice:
    def test_a_speaker_becomes_a_voice_tag(self):
        written = to_vtt(_document(_cue(speaker="Ada"))).unwrap()
        assert "<v Ada>a line of caption" in written

    def test_the_tag_can_be_turned_off(self):
        written = to_vtt(_document(_cue(speaker="Ada")), voice=False).unwrap()
        assert "<v" not in written

    def test_a_cue_with_noone_speaking_has_no_tag(self):
        assert "<v" not in to_vtt(_document(_cue())).unwrap()


class TestSettings:
    def test_alignment_comes_from_the_anchor(self):
        cue = _cue(position=CaptionPosition(anchor=CaptionAnchor.BOTTOM_LEFT))
        assert "align:left" in to_vtt(_document(cue)).unwrap()

    def test_a_centred_cue_says_so(self):
        cue = _cue(position=CaptionPosition(anchor=CaptionAnchor.MIDDLE_CENTER))
        assert "align:center" in to_vtt(_document(cue)).unwrap()

    def test_a_right_cue_says_so(self):
        cue = _cue(position=CaptionPosition(anchor=CaptionAnchor.BOTTOM_RIGHT))
        assert "align:right" in to_vtt(_document(cue)).unwrap()

    def test_a_cue_that_was_nudged_says_where(self):
        cue = _cue(position=CaptionPosition(x=0.5))
        assert "position:75%" in to_vtt(_document(cue)).unwrap()

    def test_a_cue_moved_up_says_so(self):
        cue = _cue(position=CaptionPosition(y=0.5))
        assert "line:70%" in to_vtt(_document(cue)).unwrap()

    def test_a_cue_sitting_on_its_anchor_needs_no_position(self):
        cue = _cue(position=CaptionPosition())
        assert "position:" not in to_vtt(_document(cue)).unwrap()

    def test_a_percentage_stays_inside_the_frame(self):
        cue = _cue(position=CaptionPosition(x=1.0, y=-1.0))
        written = to_vtt(_document(cue)).unwrap()
        assert "position:100%" in written
        assert "line:100%" in written

    def test_settings_can_be_turned_off(self):
        written = to_vtt(_document(_cue()), settings=False).unwrap()
        assert "align:" not in written


class TestWhichLayer:
    def test_one_layer_is_written_at_a_time(self):
        document = CaptionDocument(
            segments=(
                _cue(0, 1_000, "good morning", layer_id="primary"),
                _cue(0, 1_000, "guten morgen", layer_id="de"),
            ),
            layers=(
                CaptionLayer.primary("en"),
                CaptionLayer(layer_id="de", language="de", kind=CaptionLayerKind.TRANSLATION),
            ),
        ).reindexed()
        written = to_vtt(document, layer_id="de").unwrap()
        assert "guten morgen" in written
        assert "good morning" not in written


class TestWhatIsRefused:
    def test_a_layer_that_is_not_there(self):
        error = to_vtt(_document(_cue()), layer_id="de").unwrap_err()
        assert error.code == ExportErrorCode.LAYER_NOT_FOUND

    def test_a_layer_with_nothing_in_it(self):
        document = CaptionDocument(
            segments=(_cue(0, 1_000, "good morning", layer_id="primary"),),
            layers=(
                CaptionLayer.primary("en"),
                CaptionLayer(layer_id="de", language="de", kind=CaptionLayerKind.TRANSLATION),
            ),
        )
        assert to_vtt(document, layer_id="de").unwrap_err().code == ExportErrorCode.EMPTY_LAYER

    def test_cues_that_overlap(self):
        error = to_vtt(_document(_cue(0, 1_500), _cue(1_200, 2_200))).unwrap_err()
        assert error.code == ExportErrorCode.INVALID_DOCUMENT

    def test_nothing_here_can_be_retried(self):
        assert not to_vtt(_document(_cue()), layer_id="de").unwrap_err().retryable
