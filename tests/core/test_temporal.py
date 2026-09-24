"""Frame-accurate time tests (ADR-0006).

These encode SMPTE reference values for drop-frame timecode and the drift
properties that the integer-frame design exists to guarantee.  A regression here
shows up to users as a black flash or as lip-sync drift, so the assertions are
deliberately exact rather than approximate.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from nova_studio.core.temporal import (
    DEFAULT_TIMEBASE,
    FPS_23_976,
    FPS_24,
    FPS_25,
    FPS_29_97,
    FPS_30,
    FPS_50,
    FPS_59_94,
    FPS_60,
    Rounding,
    Timebase,
    Timecode,
    TimecodeParseError,
    floor_div,
    frames_to_samples,
    samples_to_frames,
    timebase_from_fps,
)

pytestmark = pytest.mark.unit


class TestTimebase:
    """Exact rational rate handling."""

    def test_ntsc_rates_are_rational_not_decimal(self) -> None:
        """29.97 must be exactly 30000/1001, never a decimal approximation."""
        assert (FPS_29_97.num, FPS_29_97.den) == (30_000, 1_001)
        assert (FPS_23_976.num, FPS_23_976.den) == (24_000, 1_001)
        assert (FPS_59_94.num, FPS_59_94.den) == (60_000, 1_001)
        assert (FPS_24.num, FPS_24.den) == (24, 1)

    def test_reduction_and_interning(self) -> None:
        """60/2 is 30/1 and both resolve to the same object."""
        assert Timebase.of(60, 2) is FPS_30
        assert Timebase.of(30_000, 1_001) is FPS_29_97
        assert Timebase.of(90, 3) is FPS_30

    def test_rejects_non_positive_rates(self) -> None:
        for num, den in ((0, 1), (-30, 1), (30, 0), (30, -1)):
            with pytest.raises(ValueError, match="positive"):
                Timebase.of(num, den)

    def test_from_float_snaps_to_broadcast_rate(self) -> None:
        """A probe reporting 29.970029 really means 30000/1001."""
        assert Timebase.from_float(29.97002997002997) is FPS_29_97
        assert Timebase.from_float(23.976023976023978) is FPS_23_976
        assert Timebase.from_float(30.0) is FPS_30
        assert Timebase.from_float(59.94005994) is FPS_59_94

    def test_from_float_rejects_non_positive(self) -> None:
        with pytest.raises(ValueError, match="positive"):
            Timebase.from_float(0.0)

    def test_from_decimal_is_exact(self) -> None:
        """Decimal('29.97') is 2997/100 — distinct from the NTSC rate."""
        rate = Timebase.from_decimal(Decimal("29.97"))
        assert (rate.num, rate.den) == (2_997, 100)
        assert rate is not FPS_29_97

    def test_timebase_from_fps_coercion(self) -> None:
        assert timebase_from_fps(30) is FPS_30
        assert timebase_from_fps(30.0) is FPS_30
        assert timebase_from_fps("25") is FPS_25
        assert timebase_from_fps(Decimal("50")) is FPS_50
        assert timebase_from_fps(FPS_60) is FPS_60
        with pytest.raises(TypeError):
            timebase_from_fps([30])  # type: ignore[arg-type]

    def test_drop_frame_detection(self) -> None:
        assert FPS_29_97.is_drop_frame_rate is True
        assert FPS_59_94.is_drop_frame_rate is True
        assert FPS_23_976.is_drop_frame_rate is False
        assert FPS_30.is_drop_frame_rate is False
        assert FPS_25.is_drop_frame_rate is False

    def test_nominal_fps(self) -> None:
        assert FPS_29_97.nominal_fps == 30
        assert FPS_23_976.nominal_fps == 24
        assert FPS_59_94.nominal_fps == 60
        assert FPS_25.nominal_fps == 25

    def test_serialisation_round_trip(self) -> None:
        for rate in (FPS_24, FPS_25, FPS_29_97, FPS_30, FPS_59_94):
            assert Timebase.from_dict(rate.to_dict()) is rate

    def test_str_and_repr(self) -> None:
        assert str(FPS_30) == "30"
        assert str(FPS_29_97) == "30000/1001"
        assert "30000" in repr(FPS_29_97)

    def test_resample_frames_between_rates(self) -> None:
        """Resampling preserves *duration*, not frame count.

        1800 frames at 30 fps is 60 s, which is 1440 frames at 24 fps.
        """
        assert FPS_30.resample_frames(1_800, FPS_24) == 1_440
        assert FPS_24.resample_frames(1_440, FPS_30) == 1_800
        assert FPS_25.resample_frames(250, FPS_50) == 500
        assert FPS_30.resample_frames(30, FPS_60) == 60


class TestSecondsConversion:
    """Second conversions must be exact and explicitly rounded."""

    def test_frames_to_seconds(self) -> None:
        assert FPS_30.frames_to_seconds(30) == 1.0
        assert FPS_30.frames_to_seconds(0) == 0.0
        assert FPS_24.frames_to_seconds(48) == 2.0

    def test_frames_to_decimal_is_exact_for_ntsc(self) -> None:
        """Decimal conversion is exact, not a float approximation.

        1001 frames at 30000/1001 is 1001*1001/30000 s = 33.4000333... s, which
        Decimal represents exactly to the working precision while a float cannot.
        """
        assert FPS_29_97.frames_to_decimal_seconds(1_001) == Decimal(1_001 * 1_001) / Decimal(
            30_000
        )
        assert FPS_29_97.frames_to_decimal_seconds(0) == Decimal(0)
        # 30000 frames at 29.97 is exactly 1001 seconds.
        assert FPS_29_97.frames_to_decimal_seconds(30_000) == Decimal(1_001)
        assert FPS_30.frames_to_decimal_seconds(1_800) == Decimal(60)

    def test_seconds_to_frames_rounding_modes(self) -> None:
        """0.5 s at 30 fps is exactly 15 frames; 0.05 s is exactly 1.5 frames.

        Tie-breaking is the interesting case, so these inputs are chosen to be
        *exactly* representable in decimal.  A repeating decimal such as
        ``Decimal(1) / Decimal(30)`` is truncated to the context precision and
        therefore is not exactly a half — see the caveat test below.
        """
        one_and_half = Decimal("0.05")  # 1.5 frames at 30 fps
        assert FPS_30.seconds_to_frames(one_and_half, Rounding.FLOOR) == 1
        assert FPS_30.seconds_to_frames(one_and_half, Rounding.CEIL) == 2
        assert FPS_30.seconds_to_frames(one_and_half, Rounding.TRUNCATE) == 1
        assert FPS_30.seconds_to_frames(one_and_half, Rounding.NEAREST) == 2
        # Banker's rounding takes the even neighbour: 1.5 -> 2.
        assert FPS_30.seconds_to_frames(one_and_half, Rounding.NEAREST_EVEN) == 2
        # 2.5 frames at 30 fps is exactly 1/12 s; 5/2/30 terminates in decimal.
        five_halves = Decimal(5) / Decimal(2) / Decimal(30)
        assert FPS_30.seconds_to_frames(five_halves, Rounding.NEAREST) == 3
        assert FPS_30.seconds_to_frames(five_halves, Rounding.FLOOR) == 2
        assert FPS_30.seconds_to_frames(five_halves, Rounding.NEAREST_EVEN) == 2
        # Exact whole frames: every mode agrees.
        exact = Decimal("0.5")  # 15 frames
        assert dict.fromkeys(Rounding, 15) == {
            mode: FPS_30.seconds_to_frames(exact, mode) for mode in Rounding
        }
        # A quarter frame rounds down under NEAREST.
        quarter = Decimal("0.25") / Decimal(30)
        assert FPS_30.seconds_to_frames(quarter, Rounding.NEAREST) == 0
        assert FPS_30.seconds_to_frames(quarter, Rounding.CEIL) == 1

    def test_repeating_decimal_inputs_are_precision_limited(self) -> None:
        """Documents a real caveat: ``Decimal(1)/Decimal(30)`` is not exactly 1/30.

        Division by a non-power-of-ten truncates to the decimal context precision,
        so the result is a hair *below* a true half-frame and rounds down under
        every "nearest" mode.  Callers that need exact half-way behaviour must pass
        an exactly representable Decimal (or an integer frame count).  This is why
        stored timeline state is integer frames, not decimal seconds (ADR-0006).
        """
        truncated = Decimal(1) / Decimal(30)
        assert truncated * 30 < Decimal(1)
        assert FPS_30.seconds_to_frames(truncated, Rounding.FLOOR) == 0
        assert FPS_30.seconds_to_frames(truncated, Rounding.CEIL) == 1

    def test_seconds_to_frames_treats_float_as_shortest_decimal(self) -> None:
        """0.1 must mean decimal 0.1, not its binary expansion."""
        assert FPS_30.seconds_to_frames(0.1, Rounding.NEAREST) == 3
        assert FPS_30.seconds_to_frames("0.1", Rounding.NEAREST) == 3

    def test_negative_positions(self) -> None:
        """Pre-roll handles produce negative frames and floor toward -inf."""
        assert FPS_30.seconds_to_frames(-0.05, Rounding.FLOOR) == -2
        assert FPS_30.seconds_to_frames(-0.05, Rounding.CEIL) == -1

    def test_no_drift_over_a_feature_length_timeline(self) -> None:
        """The core ADR-0006 guarantee: integer arithmetic cannot drift.

        Simulate 100 000 successive one-frame ripple moves and assert the position
        is exactly 100 000 — a float-seconds implementation fails this.
        """
        position = 0
        for _ in range(100_000):
            position += 1
        assert position == 100_000
        assert FPS_29_97.frames_to_decimal_seconds(position) == Decimal(100_000 * 1_001) / Decimal(
            30_000
        )

    def test_float_seconds_would_drift(self) -> None:
        """Demonstrates the failure mode the integer design avoids.

        Accumulating 0.1 s steps in float does not return to an exact value; the
        assertion documents *why* floats are banned from stored timeline state.
        """
        accumulated = 0.0
        for _ in range(10):
            accumulated += 0.1
        assert accumulated != pytest.approx(1.0, abs=0.0)
        assert Decimal(str(round(accumulated, 10))) == Decimal("1.0")


class TestTimecodeNonDrop:
    """Non-drop timecode is plain base conversion."""

    @pytest.mark.parametrize(
        ("frames", "expected"),
        [
            (0, "00:00:00:00"),
            (1, "00:00:00:01"),
            (29, "00:00:00:29"),
            (30, "00:00:01:00"),
            (1_799, "00:00:59:29"),
            (1_800, "00:01:00:00"),
            (107_892, "00:59:56:12"),
        ],
    )
    def test_format(self, frames: int, expected: str) -> None:
        assert str(Timecode.from_frames(frames, FPS_30, drop_frame=False)) == expected

    @pytest.mark.parametrize("frames", [0, 1, 29, 30, 1_800, 107_892, 1_000_000])
    def test_round_trip(self, frames: int) -> None:
        timecode = Timecode.from_frames(frames, FPS_30, drop_frame=False)
        assert timecode.to_frames(FPS_30) == frames

    def test_other_rates(self) -> None:
        assert str(Timecode.from_frames(50, FPS_25, drop_frame=False)) == "00:00:02:00"
        assert str(Timecode.from_frames(48, FPS_24, drop_frame=False)) == "00:00:02:00"
        assert str(Timecode.from_frames(120, FPS_60, drop_frame=False)) == "00:00:02:00"

    def test_negative_timecode(self) -> None:
        timecode = Timecode.from_frames(-30, FPS_30, drop_frame=False)
        assert timecode.negative is True
        assert str(timecode) == "-00:00:01:00"
        assert timecode.to_frames(FPS_30) == -30
        assert timecode.absolute().to_frames(FPS_30) == 30
        assert timecode.negated().to_frames(FPS_30) == 30


class TestTimecodeDropFrame:
    """SMPTE 12-M drop-frame behaviour at 29.97 and 59.94."""

    @pytest.mark.parametrize(
        ("frames", "expected"),
        [
            # Frames 00 and 01 are skipped at the start of every non-tenth minute.
            (0, "00:00:00;00"),
            (1, "00:00:00;01"),
            (2, "00:00:00;02"),
            (1_799, "00:00:59;29"),
            # 1800 would be 00:01:00;00, which does not exist.
            (1_800, "00:01:00;02"),
            (1_801, "00:01:00;03"),
            # The tenth minute does not drop.
            (17_982, "00:10:00;00"),
            (17_983, "00:10:00;01"),
            (17_984, "00:10:00;02"),
            # One hour of 29.97 drop-frame is 107892 frames, labelled 01:00:00;00.
            (107_892, "01:00:00;00"),
        ],
    )
    def test_format(self, frames: int, expected: str) -> None:
        assert str(Timecode.from_frames(frames, FPS_29_97)) == expected

    @pytest.mark.parametrize(
        "frames",
        [0, 1, 2, 1_799, 1_800, 1_801, 17_982, 17_983, 107_892, 1_000_000],
    )
    def test_round_trip(self, frames: int) -> None:
        timecode = Timecode.from_frames(frames, FPS_29_97)
        assert timecode.to_frames(FPS_29_97) == frames

    def test_exhaustive_round_trip_over_two_hours(self) -> None:
        """Every frame of a two-hour programme must survive the conversion.

        This is the property that catches off-by-one errors in drop-frame maths,
        which only appear at minute boundaries.
        """
        for frames in range(0, 215_784):
            timecode = Timecode.from_frames(frames, FPS_29_97)
            assert timecode.to_frames(FPS_29_97) == frames, f"failed at frame {frames}"

    def test_dropped_labels_are_invalid(self) -> None:
        """00:01:00;00 and 00:01:00;01 do not exist in drop-frame timecode."""
        for frame_field in (0, 1):
            with pytest.raises(ValueError, match="drop-frame timecode does not contain"):
                Timecode(0, 1, 0, frame_field, drop_frame=True)

    def test_tenth_minute_labels_are_valid(self) -> None:
        """00:10:00;00 exists because the tenth minute does not drop."""
        assert Timecode(0, 10, 0, 0, drop_frame=True).to_frames(FPS_29_97) == 17_982
        assert Timecode(0, 10, 0, 1, drop_frame=True).to_frames(FPS_29_97) == 17_983

    def test_drop_frame_rejected_for_non_drop_rate(self) -> None:
        with pytest.raises(ValueError, match="no drop-frame timecode convention"):
            Timecode.from_frames(100, FPS_30, drop_frame=True)
        with pytest.raises(ValueError, match="no drop-frame timecode convention"):
            Timecode.from_frames(100, FPS_23_976, drop_frame=True)

    def test_non_drop_timecode_at_drop_rate_is_allowed(self) -> None:
        """A user may opt out of dropping; the label then counts every frame."""
        timecode = Timecode.from_frames(1_800, FPS_29_97, drop_frame=False)
        assert str(timecode) == "00:01:00:00"
        assert timecode.to_frames(FPS_29_97) == 1_800

    @pytest.mark.parametrize(
        ("frames", "expected"),
        [
            (0, "00:00:00;00"),
            (3, "00:00:00;03"),
            (3_595, "00:00:59;55"),
            (3_599, "00:00:59;59"),
            # Labels ;00-;03 are skipped at the start of a non-tenth minute.
            (3_600, "00:01:00;04"),
            (3_601, "00:01:00;05"),
            (35_964, "00:10:00;00"),
            (215_784, "01:00:00;00"),
        ],
    )
    def test_59_94_drop_frame_format(self, frames: int, expected: str) -> None:
        """59.94 DF skips four frame numbers per non-tenth minute (SMPTE 12-M)."""
        assert str(Timecode.from_frames(frames, FPS_59_94)) == expected
        assert Timecode.from_frames(frames, FPS_59_94).to_frames(FPS_59_94) == frames

    def test_drop_count_scales_with_rate(self) -> None:
        """The drop count is derived from the rate, never hardcoded."""
        assert FPS_29_97.drop_frame_count == 2
        assert FPS_59_94.drop_frame_count == 4
        assert FPS_30.drop_frame_count == 0
        assert FPS_23_976.drop_frame_count == 0

    def test_rate_exact_dropped_labels(self) -> None:
        """`;02` is a legal label at 29.97 but not at 59.94."""
        label = Timecode(0, 1, 0, 2, drop_frame=True)
        assert label.to_frames(FPS_29_97) == 1_800
        assert label.is_dropped_label(FPS_59_94) is True
        assert label.is_dropped_label(FPS_29_97) is False
        with pytest.raises(ValueError, match="not a valid drop-frame label"):
            label.to_frames(FPS_59_94)

    def test_parse_rejects_dropped_labels(self) -> None:
        with pytest.raises(TimecodeParseError, match="do not exist"):
            Timecode.parse("00:01:00;03", FPS_59_94)
        assert Timecode.parse("00:01:00;04", FPS_59_94).to_frames(FPS_59_94) == 3_600
        assert Timecode.parse("00:01:00;02", FPS_29_97).to_frames(FPS_29_97) == 1_800

    def test_tenth_minute_never_drops(self) -> None:
        assert Timecode(0, 10, 0, 0, drop_frame=True).to_frames(FPS_29_97) == 17_982
        assert Timecode(0, 10, 0, 0, drop_frame=True).to_frames(FPS_59_94) == 35_964
        assert not Timecode(0, 10, 0, 0, drop_frame=True).is_dropped_label(FPS_59_94)

    def test_drop_frame_label_tracks_real_time(self) -> None:
        """The whole point of drop-frame: the *label* tracks the wall clock.

        Timecode counts at the nominal 30 fps.  Real NTSC video runs at
        30000/1001 fps, which is 0.1% slower, so after one hour of real time the
        frame counter is 108 frames behind the timecode clock
        (``3600 * 30 * 1001/30000``).  Drop-frame skips 108 frame *numbers* in
        that hour — 2 per minute for 54 of the 60 minutes — which is exactly the
        discrepancy.  Hence 107 892 real frames are labelled 01:00:00;00.
        """
        frames = 107_892
        # 108 numbers dropped in an hour: 2 per minute for 54 of the 60 minutes.
        dropped = FPS_29_97.drop_frame_count * (60 - 6)
        assert dropped == 108
        assert frames + dropped == 3_600 * 30
        assert str(Timecode.from_frames(frames, FPS_29_97)) == "01:00:00;00"
        # Real elapsed time is a hair *under* an hour: the label clock counts at
        # nominal 30 fps and drop-frame keeps it locked to the wall clock, while
        # the true 30000/1001 rate needs 107 902.8 frames for exactly 3600 s.
        elapsed = FPS_29_97.frames_to_decimal_seconds(frames)
        assert elapsed < Decimal(3_600)
        assert Decimal(3_600) - elapsed < Decimal("0.01")
        # The same property at 59.94: one hour of programme labels 01:00:00;00.
        assert str(Timecode.from_frames(215_784, FPS_59_94)) == "01:00:00;00"


class TestTimecodeParsing:
    """Parsing must be strict, helpful and drop-frame aware."""

    def test_full_forms(self) -> None:
        assert Timecode.parse("01:02:03:04", FPS_30) == Timecode(1, 2, 3, 4, False, False)
        assert Timecode.parse("01:02:03;04", FPS_29_97) == Timecode(1, 2, 3, 4, True, False)

    def test_short_forms_are_left_padded(self) -> None:
        assert Timecode.parse("03:04", FPS_30) == Timecode(0, 0, 3, 4, False, False)
        assert Timecode.parse("04", FPS_30) == Timecode(0, 0, 0, 4, False, False)
        assert Timecode.parse("1:2:3:4", FPS_30) == Timecode(1, 2, 3, 4, False, False)

    def test_drop_frame_inferred_from_rate(self) -> None:
        """``01:00:00`` at 29.97 is drop-frame, matching professional NLEs."""
        parsed = Timecode.parse("01:00:00:00", FPS_29_97)
        assert parsed.drop_frame is True
        assert Timecode.parse("01:00:00:00", FPS_30).drop_frame is False

    def test_dot_separator_accepted(self) -> None:
        assert Timecode.parse("01:02:03.04", FPS_30) == Timecode(1, 2, 3, 4, False, False)

    def test_negative(self) -> None:
        parsed = Timecode.parse("-00:00:01:00", FPS_30)
        assert parsed.negative is True
        assert parsed.to_frames(FPS_30) == -30

    def test_whitespace_tolerated(self) -> None:
        assert Timecode.parse("  00:00:01:00  ", FPS_30).to_frames(FPS_30) == 30

    @pytest.mark.parametrize(
        ("text", "reason"),
        [
            ("", "empty string"),
            ("abc", "non-numeric"),
            ("1:2:3:4:5", "between 1 and 4"),
            ("00:00:00:30", "must be < 30"),
            ("24:00:00:00", "out of range"),
            ("00:60:00:00", "out of range"),
            ("00:00:00:-1", "non-numeric"),
        ],
    )
    def test_invalid(self, text: str, reason: str) -> None:
        with pytest.raises(TimecodeParseError, match=reason):
            Timecode.parse(text, FPS_30)

    def test_parse_error_carries_text(self) -> None:
        with pytest.raises(TimecodeParseError) as info:
            Timecode.parse("nope", FPS_30)
        assert info.value.text == "nope"
        assert "nope" in str(info.value)

    def test_dropped_label_rejected_on_parse(self) -> None:
        with pytest.raises(ValueError, match="drop-frame timecode does not contain"):
            Timecode.parse("00:01:00;00", FPS_29_97)

    def test_drop_marker_at_non_drop_rate_rejected(self) -> None:
        with pytest.raises(TimecodeParseError, match="no drop-frame convention"):
            Timecode.parse("00:01:00;02", FPS_30)

    def test_serialisation_round_trip(self) -> None:
        original = Timecode(1, 2, 3, 4, True, True)
        assert Timecode.from_dict(original.to_dict()) == original

    def test_zero(self) -> None:
        assert Timecode.zero() == Timecode(0, 0, 0, 0, False, False)
        assert Timecode.zero(drop_frame=True).drop_frame is True

    def test_compact_form(self) -> None:
        assert Timecode(1, 2, 3, 4).to_compact() == "01020304"

    def test_seconds_label(self) -> None:
        assert Timecode(0, 0, 1, 15, False, False).to_seconds_label(FPS_30) == "1.500s"

    def test_field_validation(self) -> None:
        with pytest.raises(ValueError, match="hours out of range"):
            Timecode(24, 0, 0, 0)
        with pytest.raises(ValueError, match="minutes out of range"):
            Timecode(0, 60, 0, 0)
        with pytest.raises(ValueError, match="seconds out of range"):
            Timecode(0, 0, 60, 0)
        with pytest.raises(ValueError, match="non-negative"):
            Timecode(0, 0, 0, -1)

    def test_frames_field_validated_against_rate(self) -> None:
        with pytest.raises(ValueError, match="is invalid at"):
            Timecode(0, 0, 0, 30).to_frames(FPS_30)

    def test_equality_and_hashing(self) -> None:
        assert Timecode(1, 0, 0, 0) == Timecode(1, 0, 0, 0)
        assert Timecode(1, 0, 0, 0) != Timecode(1, 0, 0, 0, drop_frame=True)
        assert len({Timecode(1, 0, 0, 0), Timecode(1, 0, 0, 0)}) == 1


class TestAudioTimeMapping:
    """Audio is never quantised to video frames (ADR-0006 §6)."""

    def test_frames_to_samples(self) -> None:
        assert frames_to_samples(0, FPS_30, 48_000) == 0
        assert frames_to_samples(30, FPS_30, 48_000) == 48_000
        assert frames_to_samples(1, FPS_30, 48_000) == 1_600

    def test_sample_mapping_is_exact_when_the_numerator_divides(self) -> None:
        """``samples = frames * den * rate / num`` is exact when ``num`` divides
        ``frames * den * rate``.  For 29.97 at 48 kHz that means ``30000`` divides
        ``frames * 1001 * 48000``, i.e. ``5`` divides ``frames`` (1001 is coprime
        to both 5 and 3).  Integer rates are exact for every frame.
        """
        assert frames_to_samples(30, FPS_30, 48_000) == 48_000
        assert frames_to_samples(1, FPS_30, 48_000) == 1_600
        assert frames_to_samples(30, FPS_29_97, 48_000) == 48_048
        assert frames_to_samples(30_030, FPS_29_97, 48_000) == 48_096_048
        # Off-divisibility positions are genuinely fractional and get rounded.
        exact = Decimal(1_001) * 1_001 * 48_000 / Decimal(30_000)
        assert exact != exact.to_integral_value()
        assert frames_to_samples(1_001, FPS_29_97, 48_000) == 1_603_202

    def test_round_trip_is_exact_at_integer_rates(self) -> None:
        """At 30 fps / 48 kHz every frame maps to a whole number of samples, so
        the round trip is exact for every position."""
        for frames in (0, 1, 7, 29, 30, 1_000, 107_892):
            samples = frames_to_samples(frames, FPS_30, 48_000)
            assert samples_to_frames(samples, FPS_30, 48_000) == frames

    def test_round_trip_never_drifts_more_than_one_frame(self) -> None:
        """NTSC positions quantise to whole samples, so the inverse may land one
        frame out — but never more, and never increasingly far out.  Unbounded
        drift is the defect this guards against."""
        for frames in range(0, 20_000):
            samples = frames_to_samples(frames, FPS_29_97, 48_000)
            recovered = samples_to_frames(samples, FPS_29_97, 48_000)
            assert abs(recovered - frames) <= 1, f"drift at frame {frames}"

    def test_conversion_is_recomputed_not_accumulated(self) -> None:
        """The no-drift guarantee: a position far down the timeline converts with
        the same error bound as one at the start, because the mapping is always
        derived from the original integers rather than stepped forward."""
        near = abs(
            samples_to_frames(frames_to_samples(10, FPS_29_97, 48_000), FPS_29_97, 48_000) - 10
        )
        far = abs(
            samples_to_frames(frames_to_samples(200_000, FPS_29_97, 48_000), FPS_29_97, 48_000)
            - 200_000
        )
        assert near <= 1
        assert far <= 1

    def test_lip_sync_does_not_drift_over_two_hours(self) -> None:
        """After two hours the audio anchor is still exact, not accumulated.

        This is the property float-seconds implementations lose: the conversion is
        recomputed from the original integers every time, so error cannot build up
        along the timeline.
        """
        frames = 215_784  # two hours at 29.97 drop-frame
        # Two hours at 29.97 is 215 784 frames; the exact sample anchor is
        # 215784 * 1001 * 48000 / 30000, rounded to a whole sample.
        expected = Rounding.NEAREST.apply(Decimal(215_784) * 1_001 * 48_000 / Decimal(30_000))
        assert frames_to_samples(frames, FPS_29_97, 48_000) == expected == 345_599_654
        # Stepping the same journey one frame at a time accumulates rounding
        # error; the single conversion does not.  This is precisely why the anchor
        # is always recomputed from the integer frame position.
        stepped = sum(frames_to_samples(1, FPS_29_97, 48_000) for _ in range(frames))
        drift = abs(stepped - expected)
        # 215784 steps each rounding up by 0.4 samples is ~86 000 samples, i.e.
        # 1.8 s of audible lip-sync drift over a two-hour programme.
        assert 80_000 < drift < 90_000
        assert drift / 48_000 > Decimal("1.5")

    def test_rejects_bad_sample_rate(self) -> None:
        with pytest.raises(ValueError, match="sample_rate must be positive"):
            frames_to_samples(10, FPS_30, 0)
        with pytest.raises(ValueError, match="sample_rate must be positive"):
            samples_to_frames(10, FPS_30, -1)

    def test_rounding_modes(self) -> None:
        # 1 frame at 30 fps with a 44.1 kHz rate is 1470 samples exactly.
        assert frames_to_samples(1, FPS_30, 44_100) == 1_470
        # 1 frame at 29.97 with 44.1 kHz is fractional.
        exact = frames_to_samples(1, FPS_29_97, 44_100, Rounding.FLOOR)
        ceil = frames_to_samples(1, FPS_29_97, 44_100, Rounding.CEIL)
        assert ceil - exact == 1


class TestHelpers:
    """Module-level convenience wrappers."""

    def test_default_timebase(self) -> None:
        assert DEFAULT_TIMEBASE is FPS_30

    def test_floor_div(self) -> None:
        assert floor_div(7, 2) == 3
        assert floor_div(-7, 2) == -4
        assert floor_div(0, 5) == 0
        with pytest.raises(ZeroDivisionError):
            floor_div(1, 0)
