"""SubRip export (`services/export/srt.py`).

SubRip is read by everything and honoured by nothing: no styling, no position,
no animation. So the tests here are about being boring in exactly the right way
— a comma where the format says a comma, three digits where it says three, one
blank line between cues and a number that starts at one. A file that is off by
one character in a timestamp is a file a platform rejects, and it rejects it
after the upload.
"""

from __future__ import annotations

import pytest

from nova_studio.domain.captions import (
    CaptionDocument,
    CaptionLayer,
    CaptionLayerKind,
    CaptionSegment,
)
from nova_studio.services.export.codes import ExportErrorCode
from nova_studio.services.export.srt import srt_timestamp, to_srt

pytestmark = pytest.mark.unit


def _cue(
    start_ms: int,
    end_ms: int,
    text: str = "a line of caption",
    **over: object,
) -> CaptionSegment:
    return CaptionSegment(
        **{"index": 0, "start_ms": start_ms, "end_ms": end_ms, "text": text, **over}  # type: ignore[arg-type]
    )


def _document(*cues: CaptionSegment) -> CaptionDocument:
    return CaptionDocument.of(*cues)


class TestTheShapeOfAFile:
    def test_one_cue_is_three_lines(self):
        written = to_srt(_document(_cue(1_000, 3_000, "Good morning."))).unwrap()
        assert written == "1\n00:00:01,000 --> 00:00:03,000\nGood morning.\n"

    def test_cues_are_separated_by_one_blank_line(self):
        written = to_srt(_document(_cue(0, 1_000, "one"), _cue(1_200, 2_200, "two"))).unwrap()
        assert (
            written
            == "1\n00:00:00,000 --> 00:00:01,000\none\n\n2\n00:00:01,200 --> 00:00:02,200\ntwo\n"
        )

    def test_the_numbering_starts_at_one(self):
        written = to_srt(_document(_cue(0, 1_000))).unwrap()
        assert written.startswith("1\n")

    def test_the_numbering_has_no_gaps(self):
        written = to_srt(
            _document(_cue(0, 1_000), _cue(1_200, 2_200), _cue(2_400, 3_400), _cue(3_600, 4_600))
        ).unwrap()
        assert [line for line in written.split("\n") if line.isdigit()] == ["1", "2", "3", "4"]

    def test_the_file_ends_with_a_newline(self):
        assert to_srt(_document(_cue(0, 1_000))).unwrap().endswith("\n")

    def test_a_two_line_cue_stays_two_lines(self):
        written = to_srt(_document(_cue(0, 2_000, "the first line\nthe second"))).unwrap()
        assert written.endswith("the first line\nthe second\n")


class TestTimestamps:
    def test_zero(self):
        assert srt_timestamp(0) == "00:00:00,000"

    def test_the_milliseconds_are_always_three_digits(self):
        assert srt_timestamp(7).endswith(",007")

    def test_the_separator_is_a_comma(self):
        assert "," in srt_timestamp(1_234)

    @pytest.mark.parametrize(
        ("ms", "expected"),
        [
            (999, "00:00:00,999"),
            (1_000, "00:00:01,000"),
            (61_234, "00:01:01,234"),
            (3_661_234, "01:01:01,234"),
        ],
    )
    def test_moments_are_written_in_full(self, ms: int, expected: str):
        assert srt_timestamp(ms) == expected

    def test_a_negative_moment_is_clamped_to_zero(self):
        assert srt_timestamp(-5) == "00:00:00,000"

    def test_a_cue_uses_its_own_times(self):
        written = to_srt(_document(_cue(1_500, 4_250))).unwrap()
        assert "00:00:01,500 --> 00:00:04,250" in written


class TestSpeakerNames:
    def test_they_are_left_out_by_default(self):
        written = to_srt(_document(_cue(0, 1_000, "Good morning.", speaker="Ada"))).unwrap()
        assert "Ada" not in written

    def test_they_can_be_asked_for(self):
        written = to_srt(
            _document(_cue(0, 1_000, "Good morning.", speaker="Ada")), speakers=True
        ).unwrap()
        assert "Ada: Good morning." in written

    def test_a_cue_with_noone_speaking_is_left_alone(self):
        written = to_srt(_document(_cue(0, 1_000, "Good morning.")), speakers=True).unwrap()
        assert written.endswith("Good morning.\n")


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
        written = to_srt(document, layer_id="de").unwrap()
        assert "guten morgen" in written
        assert "good morning" not in written

    def test_a_translation_is_written_on_its_own(self):
        """It sits on top of the original, which is no reason not to write it."""
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
        assert to_srt(document, layer_id="de").is_ok()


class TestWhatIsRefused:
    def test_a_layer_that_is_not_there(self):
        error = to_srt(_document(_cue(0, 1_000)), layer_id="de").unwrap_err()
        assert error.code == ExportErrorCode.LAYER_NOT_FOUND

    def test_the_refusal_names_the_layers_there_are(self):
        error = to_srt(_document(_cue(0, 1_000)), layer_id="de").unwrap_err()
        assert "primary" in error.remedy

    def test_a_layer_with_nothing_in_it(self):
        document = CaptionDocument(
            segments=(_cue(0, 1_000, "good morning", layer_id="primary"),),
            layers=(
                CaptionLayer.primary("en"),
                CaptionLayer(layer_id="de", language="de", kind=CaptionLayerKind.TRANSLATION),
            ),
        )
        error = to_srt(document, layer_id="de").unwrap_err()
        assert error.code == ExportErrorCode.EMPTY_LAYER

    def test_cues_that_overlap(self):
        document = _document(_cue(0, 1_500), _cue(1_200, 2_200))
        error = to_srt(document).unwrap_err()
        assert error.code == ExportErrorCode.INVALID_DOCUMENT

    def test_the_refusal_says_which_cue(self):
        document = _document(_cue(0, 1_500), _cue(1_200, 2_200))
        assert "segment 1" in to_srt(document).unwrap_err().message

    def test_a_cue_too_short_to_read(self):
        error = to_srt(_document(_cue(0, 100))).unwrap_err()
        assert error.code == ExportErrorCode.INVALID_DOCUMENT

    def test_nothing_here_can_be_retried(self):
        error = to_srt(_document(_cue(0, 1_000)), layer_id="de").unwrap_err()
        assert not error.retryable
