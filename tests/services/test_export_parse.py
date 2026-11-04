"""The shared parsing rules (`services/export/parse.py`).

SubRip and WebVTT are written differently and read almost identically, so the
reading rules live in one module and this is the file that pins them down. The
timestamps are the part worth testing hardest: a file that writes ``02:03.5``
means two minutes and three and a half seconds, and an hour-long reading of it
puts a cue an hour late.
"""

from __future__ import annotations

import pytest

from nova_studio.services.export.codes import ExportErrorCode
from nova_studio.services.export.parse import (
    blocks_of,
    malformed_cue,
    malformed_file,
    plain_text,
    timestamp_of,
    timing_of,
    unescape,
    voice_of,
)

pytestmark = pytest.mark.unit


class TestTimestamps:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("00:00:01,000", 1_000),
            ("00:00:01.000", 1_000),
            ("01:02:03,456", 3_723_456),
            ("00:00:00,000", 0),
            ("00:01:00,000", 60_000),
            ("01:00:00,000", 3_600_000),
        ],
    )
    def test_the_ordinary_forms(self, text: str, expected: int):
        assert timestamp_of(text) == expected

    def test_a_comma_and_a_full_stop_mean_the_same(self):
        assert timestamp_of("00:00:01,500") == timestamp_of("00:00:01.500")

    def test_two_parts_are_minutes_and_seconds(self):
        assert timestamp_of("02:03.500") == 123_500

    def test_two_parts_are_never_read_as_hours(self):
        """The bug this module exists to prevent: a cue an hour late."""
        assert timestamp_of("02:03.5") < 3_600_000

    def test_one_part_is_seconds(self):
        assert timestamp_of("90.250") == 90_250

    def test_a_short_fraction_is_padded_on_the_right(self):
        """.5 means 500 ms, not 5."""
        assert timestamp_of("00:00:01.5") == 1_500

    def test_no_fraction_at_all(self):
        assert timestamp_of("00:00:01") == 1_000

    def test_surrounding_space_is_ignored(self):
        assert timestamp_of("  00:00:01,000  ") == 1_000

    def test_something_that_is_not_a_timestamp(self):
        assert timestamp_of("later") is None

    def test_an_empty_string(self):
        assert timestamp_of("") is None

    def test_too_many_parts(self):
        assert timestamp_of("1:2:3:4") is None

    def test_a_negative_number_is_not_a_timestamp(self):
        assert timestamp_of("-1") is None


class TestTimingLines:
    def test_a_plain_arrow(self):
        assert timing_of("00:00:01,000 --> 00:00:03,000") == (1_000, 3_000)

    def test_webvtt_settings_on_the_same_line(self):
        assert timing_of("00:00:01.000 --> 00:00:03.000 align:center") == (1_000, 3_000)

    def test_a_timing_line_without_an_arrow(self):
        assert timing_of("00:00:01,000") is None

    def test_an_unreadable_end(self):
        assert timing_of("00:00:01,000 --> later") is None

    def test_an_unreadable_start(self):
        assert timing_of("earlier --> 00:00:03,000") is None


class TestBlocks:
    def test_blocks_are_split_on_blank_lines(self):
        assert blocks_of("one\n\ntwo\n") == (("one",), ("two",))

    def test_a_block_may_hold_several_lines(self):
        assert blocks_of("a\nb\n\nc\n") == (("a", "b"), ("c",))

    def test_windows_line_endings_are_tolerated(self):
        assert blocks_of("a\r\n\r\nb\r\n") == (("a",), ("b",))

    def test_old_mac_line_endings_are_tolerated(self):
        assert blocks_of("a\r\rb\r") == (("a",), ("b",))

    def test_a_byte_order_mark_is_removed(self):
        assert blocks_of("\ufeffone\n") == (("one",),)

    def test_blank_lines_at_the_ends_are_not_blocks(self):
        assert blocks_of("\n\none\n\n") == (("one",),)

    def test_an_empty_file_has_no_blocks(self):
        assert blocks_of("") == ()


class TestMarkup:
    def test_a_tag_goes_and_its_text_stays(self):
        assert plain_text("<i>Hello</i>") == "Hello"

    def test_a_tag_with_a_class(self):
        assert plain_text("<c.blue>Hello</c.blue>") == "Hello"

    def test_a_webvtt_timestamp_tag(self):
        assert plain_text("<00:00:01.000>Hello") == "Hello"

    def test_an_ass_override(self):
        assert plain_text("{\\an8}Hello") == "Hello"

    def test_entities_are_left_alone_unless_asked_for(self):
        assert plain_text("a &amp; b") == "a &amp; b"

    def test_entities_are_put_back_when_asked(self):
        assert plain_text("a &amp; b", unescape_entities=True) == "a & b"

    def test_an_ampersand_entity(self):
        assert unescape("&amp;") == "&"

    def test_the_angle_brackets(self):
        assert unescape("&lt;i&gt;") == "<i>"

    def test_a_non_breaking_space(self):
        assert unescape("a&nbsp;b") == "a\u00a0b"

    def test_direction_marks_go(self):
        assert unescape("a&lrm;b&rlm;c") == "abc"


class TestVoice:
    def test_a_voice_tag_is_split_off(self):
        assert voice_of("<v Ada>Hello") == ("Ada", "Hello")

    def test_the_space_after_the_v_is_optional(self):
        assert voice_of("<v.Ada>Hello") == ("Ada", "Hello")

    def test_the_speaker_is_trimmed(self):
        assert voice_of("<v  Ada  >Hello") == ("Ada", "Hello")

    def test_a_voice_tag_not_at_the_start_is_not_one(self):
        assert voice_of("Hello <v Ada>") is None

    def test_text_with_no_voice(self):
        assert voice_of("Hello") is None


class TestTheErrors:
    def test_a_broken_file_names_the_format(self):
        assert "SubRip" in malformed_file("SubRip", "no cues").message

    def test_a_broken_file_says_why(self):
        assert "no cues" in malformed_file("SubRip", "no cues").message

    def test_a_broken_cue_names_the_cue(self):
        assert malformed_cue("SubRip", 3, "why").details["cue"] == 3

    def test_a_broken_cue_can_quote_the_line(self):
        assert malformed_cue("SubRip", 3, "why", line="oops").details["line"] == "oops"

    def test_a_broken_cue_uses_the_cue_code(self):
        assert malformed_cue("SubRip", 3, "why").code == ExportErrorCode.MALFORMED_CUE

    def test_a_broken_file_uses_the_file_code(self):
        assert malformed_file("SubRip", "why").code == ExportErrorCode.MALFORMED_FILE
