"""L3 — which file a clip decodes from, and whether one should be made.

``media-and-rendering.md`` §7.2 states the invariant: *proxies are
transparent.*  A clip references an asset; the asset resolves to ``original |
proxy | thumbnail``; nothing downstream knows which one it decoded.  That
sentence needs somewhere to live, and this module is that somewhere — a policy,
not a domain fact, because the same 4K file deserves a proxy on a laptop and not
on a workstation, and because the decision depends on what the *preview* is
doing, which the domain has no business knowing.

Two questions, deliberately separate:

**Which source should this decode use?** :meth:`ProxyPolicy.decide` — a pure
function of the preview scale factor and what is actually available.  The rule
is a fidelity budget: rendering at an eighth scale cannot show more detail than
a thumbnail holds, so decode the thumbnail; at a half scale, decode the proxy;
at full scale, decode the original, because that is the one case where the user
is judging colour, grain and sharpness.

**Should we make a proxy at all?** :meth:`ProxyPolicy.plan` — a pure function of
the probe summary.  Two things earn a proxy: the source is *bigger than the
preview ever needs* (decoding 4K to draw 360 px is wasted work), or the source's
codec is *not on the edit-friendly list* — long-GOP H.264/HEVC/AV1 charge a whole
group of pictures for a sparse seek, which is exactly what scrubbing does.  A
codec the policy has never heard of counts as the latter, because building a
proxy that turns out to be unnecessary costs disk, and not building one that was
needed costs the user's patience.

Making the proxy is not this module's job: that is a ``NORMAL``-priority job on
the scheduler (ADR-0010), because transcoding a folder of footage while the user
is trying to edit is how an editor earns a reputation for freezing.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.core.temporal import Rounding

if TYPE_CHECKING:
    from nova_studio.domain.media import MediaInfo

__all__ = [
    "DEFAULT_PROXY_POLICY",
    "DecodeSource",
    "ProxyPlan",
    "ProxyPolicy",
]

#: Codecs a decoder can seek cheaply: every frame stands on its own (or nearly),
#: so a sparse read costs one frame and not a group of pictures.  Lowercase,
#: because that is how PyAV and the FFmpeg CLI both report ``codec_name``.
EDIT_FRIENDLY_CODECS: Final[frozenset[str]] = frozenset(
    {
        # PyAV reports ProRes under both names: ``codec_name`` is "prores" and
        # the container tag is the fourCC, so a policy needs both spellings.
        "prores",
        "prores_ks",
        "prores_aw",
        "apch",  # ProRes 422 High Quality
        "apcn",  # ProRes 422 Standard
        "apcs",  # ProRes 422 LT
        "apco",  # ProRes 422 Proxy
        "ap4h",  # ProRes 4444
        "dnxhd",
        "dnxhr",
        "mjpeg",
        "mjpa",
        "png",
        "rawvideo",
        "qtrle",
        "huff",
        "ffv1",
        "magicyuv",
    }
)


class DecodeSource(StrEnum):
    """Which file a decode is served from."""

    #: The user's footage, at full resolution.
    ORIGINAL = "original"
    #: A generated, edit-friendly, lower-resolution copy.
    PROXY = "proxy"
    #: A single still — enough for a tile or an eighth-scale preview.
    THUMBNAIL = "thumbnail"


@dataclass(frozen=True, slots=True, kw_only=True)
class ProxyPlan:
    """What to do about a proxy for one asset."""

    #: Whether a proxy should be built.
    needed: bool
    #: Why, in one sentence, or why not — shown in the media panel.
    reason: str
    #: Where the proxy should land, or ``0, 0`` when none is needed.
    target_width: int = 0
    target_height: int = 0
    #: Which video stream the proxy is taken from.
    source_index: int = 0

    @property
    def target_size(self) -> tuple[int, int]:
        """``(width, height)`` for the encoder, which wants them in that order."""
        return (self.target_width, self.target_height)


@dataclass(frozen=True, slots=True, kw_only=True)
class ProxyPolicy:
    """The two decisions, as data.

    Thresholds rather than hard-coded constants so that a laptop install and a
    workstation install can differ by one binding in the container, and so that
    the numbers can be tuned from measured budgets without touching the logic
    that reads them.
    """

    #: Height of a generated proxy, before the aspect ratio is applied.  A
    #: source smaller than this is never enlarged.
    proxy_height: int = 720
    #: Preview scale at or below which a proxy is the right thing to decode.
    #: ``0.5`` — a half-scale preview cannot show 4K detail.
    scale_that_uses_a_proxy: float = 0.5
    #: Preview scale at or below which a single still is enough.  ``0.125`` —
    #: an eighth-scale tile is a thumbnail in everything but name.
    scale_that_uses_a_thumbnail: float = 0.125
    #: Codecs a decoder can seek cheaply; see :data:`EDIT_FRIENDLY_CODECS`.
    edit_friendly_codecs: frozenset[str] = EDIT_FRIENDLY_CODECS

    def __post_init__(self) -> None:
        if self.proxy_height < 1:
            raise NovaInvariantError(f"proxy_height must be positive, got {self.proxy_height}")
        if not 0 < self.scale_that_uses_a_thumbnail <= self.scale_that_uses_a_proxy <= 1:
            raise NovaInvariantError(
                "the scale thresholds must satisfy "
                f"0 < thumbnail <= proxy <= 1, got {self.scale_that_uses_a_thumbnail} "
                f"and {self.scale_that_uses_a_proxy}"
            )

    # -- which file to decode ---------------------------------------------

    def decide(
        self,
        *,
        scale: float,
        available: frozenset[DecodeSource] = frozenset(),
    ) -> DecodeSource:
        """Which source a decode at ``scale`` should be served from.

        Args:
            scale: Preview height divided by source height — ``1.0`` is a
                full-resolution preview, ``0.25`` a quarter-scale one.
            available: The generated sources that exist for this asset.  The
                original is always assumed to be there: it is the user's
                footage, and if it is not, that is a relink problem, not a
                source-selection one.

        The fidelity budget, best first: a decode that shows *more* than the
        preview can display is wasted work, so the smallest sufficient source
        wins.
        """
        if scale <= 0:
            raise NovaInvariantError(f"scale must be positive, got {scale}")
        if DecodeSource.THUMBNAIL in available and scale <= self.scale_that_uses_a_thumbnail:
            return DecodeSource.THUMBNAIL
        if DecodeSource.PROXY in available and scale <= self.scale_that_uses_a_proxy:
            return DecodeSource.PROXY
        return DecodeSource.ORIGINAL

    # -- whether to make one ----------------------------------------------

    def plan(self, info: MediaInfo) -> ProxyPlan:
        """Whether this asset earns a proxy, and at what size.

        A file with no video stream (a music bed, an unreadable file) gets a
        plan that says no with the reason: it has no picture to proxy.
        """
        video = info.primary_video()
        if video is None:
            return ProxyPlan(needed=False, reason="there is no video stream to proxy")

        codec = video.codec_name.lower()
        too_big = video.display_height > self.proxy_height
        # One vocabulary, not two: a codec either appears in the friendly set
        # or we cannot claim it seeks cheaply.  An unfamiliar codec therefore
        # earns a proxy, which is the safe direction to be wrong in.
        hostile = codec not in self.edit_friendly_codecs

        if not too_big and not hostile:
            return ProxyPlan(
                needed=False,
                reason=(
                    f"{video.display_width}x{video.display_height} {video.codec_name} "
                    "is already cheap to scrub"
                ),
            )

        width, height = _scaled(
            video.display_width, video.display_height, target_height=self.proxy_height
        )
        if too_big and hostile:
            reason = (
                f"{video.display_height}p {video.codec_name} is larger than the preview "
                "needs and expensive to seek"
            )
        elif too_big:
            reason = f"{video.display_height}p is larger than the preview needs"
        else:
            reason = f"{video.codec_name} is not known to seek cheaply"
        return ProxyPlan(
            needed=True,
            reason=reason,
            target_width=width,
            target_height=height,
            source_index=video.index,
        )

    def is_edit_friendly(self, info: MediaInfo) -> bool:
        """Whether the source decodes cheaply enough not to need a proxy."""
        video = info.primary_video()
        return video is not None and video.codec_name.lower() in self.edit_friendly_codecs


#: What a fresh install runs with.
DEFAULT_PROXY_POLICY: Final[ProxyPolicy] = ProxyPolicy()


def _scaled(width: int, height: int, *, target_height: int) -> tuple[int, int]:
    """Scale ``width x height`` to ``target_height``, never enlarging.

    Two details an encoder insists on: both dimensions are **even** (4:2:0
    subsampling cannot represent an odd one), and the aspect ratio comes from
    the *display* size, so anamorphic footage is not squashed.
    """
    if height <= 0:
        raise NovaInvariantError(f"height must be positive, got {height}")
    out_height = min(target_height, height)
    ratio = Decimal(out_height) / Decimal(height)
    out_width = Rounding.NEAREST_EVEN.apply(Decimal(width) * ratio)
    return (max(2, out_width), max(2, _even(out_height)))


def _even(value: int) -> int:
    """The nearest even number, rounding down: never larger than the source."""
    return value - (value % 2)
