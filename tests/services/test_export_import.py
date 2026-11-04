"""Import (`services/export/`, read half).

The promise under test is the one ADR-0009 §1 makes: **a file someone else
wrote arrives as a `Transcript` — the same shape every provider returns — so it
goes through the same pipeline as a recognition and a project cannot tell the
two apart.**

So the tests here are not "does it parse" but "what does a project get": timings
that land where the file said, markup that is dropped without losing words, a
voice tag that survives as a speaker, and a refusal that names the cue instead
of shrugging.
"""

from __future__ import annotations

import pytest

from nova_studio.domain.asr import Transcript, TranscriptSegment, TranscriptWord
from nova_studio.services.captions.build import document_from_transcript
from nova_studio.services.export import (
    from_srt,
    from_transcript_json,
    from_vtt,
    to_srt,
    to_transcript_json,
    to_vtt,
)
from nova_studio.services.export.codes import ExportErrorCode

pytestmark = pytest.mark.unit

SRT = """1
00:00:01,000 --> 00:00:03,000
Good morning.

2
00:00:03,500 --> 00:00:05,000
We drank three coffees.
"""

VTT = """WEBVTT

1
00:00:01.000 --> 00:00:03.000 align:center
<v Ada>Good morning.

2
00:00:03.500 --> 00:00:05.000
We drank <i>three</i> coffees.
"""


class TestSubRipIn:
    def test_a_file_becomes_a_transcript(self):
        assert isinstance(from_srt(SRT).unwrap(), Transcript)

    def test_one_cue_becomes_one_segment(self):
        assert len(from_srt(SRT).unwrap().segments) == 2

    def test_the_timings_are_the_files(self):
        first = from_srt(SRT).unwrap().segments[0]
        assert (first.start_ms, first.end_ms) == (1_000, 3_000)

    def test_the_text_is_the_files(self):
        assert from_srt(SRT).unwrap().text() == "Good morning.\nWe drank three coffees."

    def test_the_indices_run_from_zero(self):
        assert [segment.index for segment in from_srt(SRT).unwrap().segments] == [0, 1]

    def test_the_numbering_in_the_file_is_not_trusted_for_order(self):
        """Cues are ordered by when they are shown, not by what they are called."""
        text = (
            "2\n00:00:01,000 --> 00:00:02,000\nfirst\n\n1\n00:00:03,000 --> 00:00:04,000\nsecond\n"
        )
        assert [segment.text for segment in from_srt(text).unwrap().segments] == ["first", "second"]

    def test_markup_is_dropped(self):
        text = "1\n00:00:01,000 --> 00:00:02,000\n<i>Hello</i> <b>world</b>\n"
        assert from_srt(text).unwrap().segments[0].text == "Hello world"

    def test_ass_overrides_are_dropped(self):
        text = "1\n00:00:01,000 --> 00:00:02,000\n{\\an8}Hello\n"
        assert from_srt(text).unwrap().segments[0].text == "Hello"

    def test_an_entity_is_left_alone_because_subrip_has_none(self):
        text = "1\n00:00:01,000 --> 00:00:02,000\nfish &amp; chips\n"
        assert from_srt(text).unwrap().segments[0].text == "fish &amp; chips"

    def test_a_second_line_is_kept(self):
        text = "1\n00:00:01,000 --> 00:00:02,000\nthe first line\nthe second\n"
        assert from_srt(text).unwrap().segments[0].text == "the first line\nthe second"

    def test_a_language_can_be_filed(self):
        assert from_srt(SRT, language="en").unwrap().language == "en"

    def test_there_are_no_word_timings_because_the_file_has_none(self):
        assert from_srt(SRT).unwrap().has_word_timings is False


class TestWebVttIn:
    def test_a_file_becomes_a_transcript(self):
        assert isinstance(from_vtt(VTT).unwrap(), Transcript)

    def test_the_timings_are_the_files(self):
        first = from_vtt(VTT).unwrap().segments[0]
        assert (first.start_ms, first.end_ms) == (1_000, 3_000)

    def test_settings_on_the_timing_line_are_ignored(self):
        assert from_vtt(VTT).unwrap().segments[0].start_ms == 1_000

    def test_a_voice_tag_becomes_the_speaker(self):
        assert from_vtt(VTT).unwrap().segments[0].speaker == "Ada"

    def test_the_voice_tag_is_not_left_in_the_text(self):
        assert from_vtt(VTT).unwrap().segments[0].text == "Good morning."

    def test_a_cue_with_no_voice_has_no_speaker(self):
        assert from_vtt(VTT).unwrap().segments[1].speaker is None

    def test_entities_are_put_back(self):
        text = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nfish &amp; chips\n"
        assert from_vtt(text).unwrap().segments[0].text == "fish & chips"

    def test_markup_is_dropped(self):
        assert from_vtt(VTT).unwrap().segments[1].text == "We drank three coffees."

    def test_a_note_block_is_skipped(self):
        text = "WEBVTT\n\nNOTE this is a comment\nacross two lines\n\n00:00:01.000 --> 00:00:02.000\nHello\n"
        assert [segment.text for segment in from_vtt(text).unwrap().segments] == ["Hello"]

    def test_a_style_block_is_skipped(self):
        text = "WEBVTT\n\nSTYLE\n::cue { color: red; }\n\n00:00:01.000 --> 00:00:02.000\nHello\n"
        assert len(from_vtt(text).unwrap().segments) == 1

    def test_a_cue_identifier_is_not_taken_for_text(self):
        text = "WEBVTT\n\nintro\n00:00:01.000 --> 00:00:02.000\nHello\n"
        assert from_vtt(text).unwrap().segments[0].text == "Hello"

    def test_a_timestamp_without_hours_is_read(self):
        text = "WEBVTT\n\n00:01.500 --> 00:02.500\nHello\n"
        assert from_vtt(text).unwrap().segments[0].start_ms == 1_500

    def test_the_header_may_carry_a_title(self):
        text = "WEBVTT - a talk about coffee\n\n00:00:01.000 --> 00:00:02.000\nHello\n"
        assert from_vtt(text).is_ok()

    def test_a_byte_order_mark_is_tolerated(self):
        text = "﻿WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n"
        assert from_vtt(text).is_ok()


class TestJsonIn:
    @pytest.fixture
    def transcript(self) -> Transcript:
        return Transcript(
            segments=(
                TranscriptSegment(
                    start_ms=0,
                    end_ms=1_000,
                    index=0,
                    text="hello world",
                    words=(
                        TranscriptWord(text="hello", start_ms=0, end_ms=500),
                        TranscriptWord(text="world", start_ms=500, end_ms=1_000),
                    ),
                ),
            ),
            language="en",
            model="fake",
            audio_duration_ms=1_000,
        )

    def test_a_transcript_survives_the_round_trip(self, transcript: Transcript):
        assert from_transcript_json(to_transcript_json(transcript)).unwrap() == transcript

    def test_the_words_survive(self, transcript: Transcript):
        assert from_transcript_json(to_transcript_json(transcript)).unwrap().word_count == 2

    def test_the_file_is_readable_by_a_human(self, transcript: Transcript):
        assert '"language": "en"' in to_transcript_json(transcript)

    def test_a_character_own_script_is_written_as_itself(self, transcript: Transcript):
        japanese = Transcript(segments=(), language="ja")
        assert "日本語" in to_transcript_json(
            Transcript(
                segments=(
                    TranscriptSegment(
                        start_ms=0,
                        end_ms=1_000,
                        index=0,
                        text="日本語",
                        words=(TranscriptWord(text="日本語", start_ms=0, end_ms=1_000),),
                    ),
                ),
                language="ja",
            )
        )
        assert japanese.language == "ja"


class TestRoundTrips:
    @pytest.fixture
    def document(self):
        transcript = Transcript(
            segments=(
                TranscriptSegment(start_ms=0, end_ms=2_000, index=0, text="good morning"),
                TranscriptSegment(start_ms=2_500, end_ms=4_000, index=1, text="and coffee"),
            ),
            language="en",
        )
        return document_from_transcript(transcript).unwrap()

    def test_what_goes_out_as_subrip_comes_back(self, document):
        written = to_srt(document).unwrap()
        assert [segment.text for segment in from_srt(written).unwrap().segments] == [
            "good morning",
            "and coffee",
        ]

    def test_what_goes_out_as_webvtt_comes_back(self, document):
        written = to_vtt(document).unwrap()
        assert [segment.text for segment in from_vtt(written).unwrap().segments] == [
            "good morning",
            "and coffee",
        ]

    def test_a_speaker_survives_the_webvtt_round_trip(self):
        transcript = Transcript(
            segments=(
                TranscriptSegment(
                    start_ms=0, end_ms=2_000, index=0, text="good morning", speaker="Ada"
                ),
            ),
            language="en",
        )
        document = document_from_transcript(transcript).unwrap()
        written = to_vtt(document).unwrap()
        assert from_vtt(written).unwrap().segments[0].speaker == "Ada"


class TestWhatIsRefused:
    def test_a_file_with_no_cues(self):
        assert from_srt("hello\n").unwrap_err().code == ExportErrorCode.MALFORMED_FILE

    def test_a_file_that_is_not_webvtt(self):
        assert from_vtt("1\n00:00:01,000 --> 00:00:02,000\nHi\n").unwrap_err().code == (
            ExportErrorCode.MALFORMED_FILE
        )

    def test_a_webvtt_file_with_no_cues(self):
        assert from_vtt("WEBVTT\n").unwrap_err().code == ExportErrorCode.MALFORMED_FILE

    def test_the_refusal_says_which_format(self):
        assert "SubRip" in from_srt("hello\n").unwrap_err().message

    def test_a_block_with_no_timing_line_is_skipped(self):
        """A stray number at the end of a file is not a cue, and not a failure."""
        text = "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n"
        assert [segment.text for segment in from_srt(text).unwrap().segments] == ["Hello"]

    def test_the_refusal_names_the_cue(self):
        error = from_srt("1\nsometime --> later\nHello\n").unwrap_err()
        assert error.details["cue"] == 1

    def test_a_timing_line_that_is_not_one(self):
        error = from_srt("1\nsometime --> later\nHello\n").unwrap_err()
        assert error.code == ExportErrorCode.MALFORMED_CUE

    def test_the_refusal_quotes_the_line(self):
        error = from_srt("1\nsometime --> later\nHello\n").unwrap_err()
        assert error.details["line"] == "sometime --> later"

    def test_a_cue_that_ends_before_it_starts(self):
        error = from_srt("1\n00:00:05,000 --> 00:00:03,000\nHello\n").unwrap_err()
        assert "before it starts" in error.message

    def test_cues_that_overlap(self):
        error = from_srt(
            "1\n00:00:01,000 --> 00:00:05,000\none\n\n2\n00:00:02,000 --> 00:00:06,000\ntwo\n"
        ).unwrap_err()
        assert error.code == ExportErrorCode.MALFORMED_CUE

    def test_an_overlap_says_which_cue_was_first(self):
        error = from_srt(
            "1\n00:00:01,000 --> 00:00:05,000\none\n\n2\n00:00:02,000 --> 00:00:06,000\ntwo\n"
        ).unwrap_err()
        assert error.details["cue"] == 2

    def test_two_cues_that_touch_are_allowed(self):
        text = "1\n00:00:01,000 --> 00:00:02,000\none\n\n2\n00:00:02,000 --> 00:00:03,000\ntwo\n"
        assert len(from_srt(text).unwrap().segments) == 2

    def test_a_cue_with_no_text_is_skipped(self):
        text = "1\n00:00:01,000 --> 00:00:02,000\n\n2\n00:00:02,000 --> 00:00:03,000\nHello\n"
        assert [segment.text for segment in from_srt(text).unwrap().segments] == ["Hello"]

    def test_json_that_is_not_json(self):
        assert from_transcript_json("{oops").unwrap_err().code == ExportErrorCode.MALFORMED_JSON

    def test_json_that_is_not_a_transcript(self):
        error = from_transcript_json('{"nope": 1}').unwrap_err()
        assert error.code == ExportErrorCode.MALFORMED_JSON

    def test_a_list_is_not_a_transcript(self):
        assert from_transcript_json("[]").unwrap_err().code == ExportErrorCode.MALFORMED_JSON

    def test_nothing_here_can_be_retried(self):
        assert not from_srt("hello\n").unwrap_err().retryable
