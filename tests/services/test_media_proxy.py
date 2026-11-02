"""The proxy policy (`services/media/proxy.py`).

Two questions, pinned separately: **which copy do I decode** (a fidelity budget
— never draw more detail than the preview can show) and **is a proxy worth
building** (bigger than the preview needs, or hostile to seeking). Plus the
arithmetic detail every encoder insists on and every hand-rolled scaler gets
wrong: both dimensions come out even.
"""

from __future__ import annotations

from typing import Any

import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.temporal import Timebase
from nova_studio.domain.media import AssetKind, AudioStreamInfo, MediaInfo, VideoStreamInfo
from nova_studio.services.media import (
    DEFAULT_PROXY_POLICY,
    DecodeSource,
    ProxyPlan,
    ProxyPolicy,
)

pytestmark = pytest.mark.unit


def _video(
    codec_name: str = "h264",
    *,
    width: int = 1920,
    height: int = 1080,
    rotation: int = 0,
    **over: Any,
) -> MediaInfo:
    stream = VideoStreamInfo(
        codec_name=codec_name,
        width=width,
        height=height,
        timebase=Timebase(num=30, den=1),
        frame_count=300,
        rotation=rotation,
    )
    return MediaInfo(kind=AssetKind.VIDEO, duration_seconds=10.0, video=(stream,), **over)


def _audio_only() -> MediaInfo:
    return MediaInfo(
        kind=AssetKind.AUDIO,
        duration_seconds=10.0,
        audio=(AudioStreamInfo(codec_name="aac", sample_rate=48_000, channels=2),),
    )


def _policy(**over: Any) -> ProxyPolicy:
    return ProxyPolicy(**over)


class TestTheDefaults:
    def test_a_proxy_is_720p(self) -> None:
        assert DEFAULT_PROXY_POLICY.proxy_height == 720

    def test_a_half_scale_preview_uses_a_proxy(self) -> None:
        assert DEFAULT_PROXY_POLICY.scale_that_uses_a_proxy == 0.5

    def test_an_eighth_scale_preview_uses_a_still(self) -> None:
        assert DEFAULT_PROXY_POLICY.scale_that_uses_a_thumbnail == 0.125

    def test_the_thresholds_are_ordered(self) -> None:
        assert (
            DEFAULT_PROXY_POLICY.scale_that_uses_a_thumbnail
            <= DEFAULT_PROXY_POLICY.scale_that_uses_a_proxy
        )

    def test_a_nonsense_policy_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError):
            _policy(proxy_height=0)

    def test_thresholds_out_of_order_are_refused(self) -> None:
        with pytest.raises(NovaInvariantError):
            _policy(scale_that_uses_a_proxy=0.1, scale_that_uses_a_thumbnail=0.5)

    def test_a_scale_above_one_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError):
            _policy(scale_that_uses_a_proxy=1.5)


class TestDecidingWhatToDecode:
    def test_a_full_scale_preview_decodes_the_original(self) -> None:
        """The one case where the user is judging colour and sharpness."""
        assert DEFAULT_PROXY_POLICY.decide(scale=1.0, available=_all()) is DecodeSource.ORIGINAL

    def test_a_half_scale_preview_decodes_the_proxy(self) -> None:
        assert DEFAULT_PROXY_POLICY.decide(scale=0.5, available=_all()) is DecodeSource.PROXY

    def test_a_tenth_scale_preview_decodes_the_thumbnail(self) -> None:
        assert DEFAULT_PROXY_POLICY.decide(scale=0.1, available=_all()) is DecodeSource.THUMBNAIL

    def test_a_missing_proxy_falls_back_to_the_original(self) -> None:
        """Nothing downstream knows the difference; there is no 'unavailable'."""
        assert DEFAULT_PROXY_POLICY.decide(scale=0.25) is DecodeSource.ORIGINAL

    def test_a_thumbnail_alone_is_not_enough_at_a_quarter_scale(self) -> None:
        """A quarter-scale preview shows more detail than a still holds."""
        assert (
            DEFAULT_PROXY_POLICY.decide(scale=0.25, available=frozenset({DecodeSource.THUMBNAIL}))
            is DecodeSource.ORIGINAL
        )

    def test_the_original_is_never_absent(self) -> None:
        """It is the user's footage; if it is gone, that is a relink, not a choice."""
        assert DEFAULT_PROXY_POLICY.decide(scale=0.05, available=frozenset()) is (
            DecodeSource.ORIGINAL
        )

    def test_a_non_positive_scale_is_a_bug_in_the_caller(self) -> None:
        with pytest.raises(NovaInvariantError):
            DEFAULT_PROXY_POLICY.decide(scale=0.0)

    def test_the_threshold_itself_uses_the_cheaper_source(self) -> None:
        """'At or below' — documented one way, tested the other."""
        assert (
            DEFAULT_PROXY_POLICY.decide(
                scale=DEFAULT_PROXY_POLICY.scale_that_uses_a_proxy, available=_all()
            )
            is DecodeSource.PROXY
        )


class TestPlanningAProxy:
    def test_4k_h264_earns_a_proxy(self) -> None:
        plan = DEFAULT_PROXY_POLICY.plan(_video("h264", width=3840, height=2160))
        assert plan.needed is True

    def test_it_lands_at_720p(self) -> None:
        plan = DEFAULT_PROXY_POLICY.plan(_video("h264", width=3840, height=2160))
        assert plan.target_size == (1280, 720)

    def test_the_reason_names_both_problems(self) -> None:
        plan = DEFAULT_PROXY_POLICY.plan(_video("h264", width=3840, height=2160))
        assert "h264" in plan.reason and "2160" in plan.reason

    def test_it_says_which_stream_it_came_from(self) -> None:
        assert DEFAULT_PROXY_POLICY.plan(_video("h264", height=2160)).source_index == 0

    def test_small_footage_does_not_earn_a_proxy(self) -> None:
        plan = DEFAULT_PROXY_POLICY.plan(_video("prores", width=1280, height=720))
        assert plan.needed is False

    def test_a_refusal_says_why(self) -> None:
        plan = DEFAULT_PROXY_POLICY.plan(_video("prores", width=1280, height=720))
        assert "cheap to scrub" in plan.reason

    def test_small_but_hostile_footage_still_earns_a_proxy(self) -> None:
        """Long-GOP 720p costs a whole group of pictures per seek."""
        plan = DEFAULT_PROXY_POLICY.plan(_video("hevc", width=1280, height=720))
        assert plan.needed is True
        assert "seek" in plan.reason

    def test_large_but_friendly_footage_still_earns_a_proxy(self) -> None:
        plan = DEFAULT_PROXY_POLICY.plan(_video("prores", width=4096, height=2160))
        assert plan.needed is True
        assert "larger than the preview needs" in plan.reason

    def test_a_music_bed_does_not_earn_a_proxy(self) -> None:
        assert DEFAULT_PROXY_POLICY.plan(_audio_only()).needed is False

    def test_a_refusal_for_audio_says_there_is_no_picture(self) -> None:
        assert "no video stream" in DEFAULT_PROXY_POLICY.plan(_audio_only()).reason

    def test_a_refusal_carries_no_size(self) -> None:
        assert DEFAULT_PROXY_POLICY.plan(_audio_only()).target_size == (0, 0)

    def test_the_plan_is_a_value(self) -> None:
        assert isinstance(DEFAULT_PROXY_POLICY.plan(_video()), ProxyPlan)

    def test_a_tighter_policy_asks_for_a_smaller_proxy(self) -> None:
        plan = _policy(proxy_height=360).plan(_video("h264", width=3840, height=2160))
        assert plan.target_size == (640, 360)


class TestTheArithmetic:
    def test_the_aspect_ratio_survives(self) -> None:
        plan = DEFAULT_PROXY_POLICY.plan(_video("h264", width=4000, height=2000))
        assert plan.target_size == (1440, 720)

    def test_both_dimensions_are_even(self) -> None:
        """4:2:0 chroma subsampling cannot represent an odd dimension."""
        plan = DEFAULT_PROXY_POLICY.plan(_video("h264", width=3841, height=2161))
        assert plan.target_width % 2 == 0
        assert plan.target_height % 2 == 0

    def test_a_proxy_is_never_bigger_than_its_source(self) -> None:
        plan = DEFAULT_PROXY_POLICY.plan(_video("h264", width=640, height=360))
        assert plan.target_height <= 360

    def test_a_tiny_source_still_gets_a_usable_size(self) -> None:
        plan = DEFAULT_PROXY_POLICY.plan(_video("h264", width=32, height=18))
        assert plan.target_size == (32, 18)

    def test_rotated_footage_is_scaled_by_what_you_see(self) -> None:
        """A phone held sideways is 1080 wide and 1920 tall, not the reverse."""
        plan = DEFAULT_PROXY_POLICY.plan(_video("h264", width=1920, height=1080, rotation=90))
        assert plan.target_height == 720
        # Portrait stays portrait: the proxy is narrower than it is tall.
        assert plan.target_width < plan.target_height


class TestBeingEditFriendly:
    def test_prores_is_edit_friendly(self) -> None:
        assert DEFAULT_PROXY_POLICY.is_edit_friendly(_video("prores")) is True

    def test_h264_is_not(self) -> None:
        assert DEFAULT_PROXY_POLICY.is_edit_friendly(_video("h264")) is False

    def test_the_codec_name_is_matched_without_regard_to_case(self) -> None:
        assert DEFAULT_PROXY_POLICY.is_edit_friendly(_video("ProRes")) is True

    def test_an_audio_only_file_is_neither(self) -> None:
        assert DEFAULT_PROXY_POLICY.is_edit_friendly(_audio_only()) is False

    def test_a_narrower_policy_can_disagree(self) -> None:
        strict = _policy(edit_friendly_codecs=frozenset({"prores"}))
        assert strict.is_edit_friendly(_video("dnxhr")) is False


def _all() -> frozenset[DecodeSource]:
    return frozenset({DecodeSource.PROXY, DecodeSource.THUMBNAIL})
