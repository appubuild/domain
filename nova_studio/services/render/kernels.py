"""L3 — effect kernels: the arithmetic behind the catalogue.

`services/effects/builtins.py` publishes what the built-in effects *are*; this is
where they do something. The split is deliberate and it is the one ADR-0011
needs: a spec is metadata that ships in the catalogue, a kernel is arithmetic
that runs in the render engine, and a plugin contributes either without the other
having to exist. An effect with a spec and no kernel is inert rather than
broken — which is exactly why adding one to the catalogue is safe.

What a kernel is
----------------
A pure function from pixels to pixels:

* input and output are **float32 RGB in 0..1**, `HxWx3`;
* it knows nothing about frames, clips, projects or files;
* it is given its parameters already resolved at a frame — plain floats, strings
  and tuples — because sampling keyframes is the runner's job, not the kernel's.

The float range is the contract that makes stacking cheap: converting to float
once per chain instead of once per effect is the difference between one
conversion and nine, and clipping at the end rather than between effects is what
keeps a blur-then-sharpen from banding.

Alpha, and why kernels never see it
-----------------------------------
A mask (one channel) is expanded to RGB and an RGBA source is flattened over
black before any kernel runs, and the result goes back to the compositor as
opaque RGB. No built-in kernel has a defensible opinion about alpha, and a
kernel that received it would have to invent one — most likely by blurring the
alpha channel, which is the wrong answer for every effect in the catalogue.

Determinism
-----------
`nova.film-grain` needs noise, and ADR-0002 rule 1 forbids unseeded randomness:
the same frame rendered twice must produce the same bytes, or an export cannot be
resumed and a preview cannot be compared with its export. The seed is derived
from the effect's id and the frame number, so grain crawls the way film does
while staying reproducible.

Adding a kernel
---------------
Write a function, register it under the spec's `type`. Nothing else in the
engine changes: the runner looks the type up, and a plugin's kernel is
indistinguishable from a built-in one.
"""

from __future__ import annotations

import math
import zlib
from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING, Any, Final, Protocol, runtime_checkable

import numpy as np

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.media import ColourMeta, FrameBuffer
from nova_studio.ports.imaging import Interpolation

if TYPE_CHECKING:
    from collections.abc import Mapping

    from nova_studio.domain.effects import EffectChain
    from nova_studio.ports.imaging import ImageOps

__all__ = [
    "KernelRegistry",
    "apply_chain",
    "builtin_kernels",
    "from_float_rgb",
    "kernel_types",
    "to_float_rgb",
]


# ---------------------------------------------------------------------------
# The kernel contract
# ---------------------------------------------------------------------------


@runtime_checkable
class EffectKernel(Protocol):
    """One effect's arithmetic: float RGB in, float RGB out.

    ``params`` holds the effect's parameters already sampled at ``frame``, keyed
    by the names the spec declares. A kernel reads what it needs and ignores the
    rest, which is what lets a plugin add a parameter without breaking the
    kernel that does not use it.
    """

    def __call__(
        self,
        pixels: Any,
        params: Mapping[str, Any],
        *,
        frame: int,
        seed: int,
        ops: ImageOps,
    ) -> Any: ...


def _scalar(params: Mapping[str, Any], name: str, default: float) -> float:
    """One number, or the default when the parameter is missing or mistyped.

    A kernel must never raise over a parameter: an effect instance produced by an
    older build, or by a plugin that added a parameter this kernel has never
    heard of, still has to render the frame.
    """
    value = params.get(name)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return float(value)


def _choice(params: Mapping[str, Any], name: str, default: str) -> str:
    value = params.get(name)
    return str(value) if isinstance(value, str) else default


def _flag(params: Mapping[str, Any], name: str, default: bool) -> bool:
    value = params.get(name)
    return bool(value) if isinstance(value, bool) else default


def _colour(params: Mapping[str, Any], name: str, default: tuple[float, float, float]) -> Any:
    """A colour parameter as an RGB triple in 0..1."""
    value = params.get(name)
    if isinstance(value, (tuple, list)) and len(value) >= 3:
        return np.array([float(value[0]), float(value[1]), float(value[2])], dtype=np.float32)
    return np.array(default, dtype=np.float32)


#: Rec.709 luma coefficients. Every "how bright is this" question in here is
#: answered with these, because saturation and the glow threshold are both
#: perceptual and both wrong if they use a plain mean.
_LUMA: Final[Any] = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def _odd(value: float, *, at_least: int = 1) -> int:
    """The nearest odd kernel size, floored.

    OpenCV insists on odd kernels, and a radius small enough to round to zero
    means "no blur at all", not "a negative kernel".
    """
    size = max(at_least, round(value))
    return size if size % 2 else size + 1


# ---------------------------------------------------------------------------
# The kernels
# ---------------------------------------------------------------------------


def _blur(pixels: Any, params: Mapping[str, Any], *, frame: int, seed: int, ops: ImageOps) -> Any:
    radius = max(0.0, _scalar(params, "radius", 4.0))
    mode = _choice(params, "mode", "gaussian")
    if radius <= 0.0:
        return pixels
    if mode == "box":
        return ops.box(pixels, _odd(radius * 2 + 1))
    if mode == "motion":
        # A line, not a disc: the kernel is one row, rotated. Built by hand
        # because OpenCV has no motion blur and a square kernel would be a lie.
        angle = math.radians(_scalar(params, "angle", 0.0))
        length = _odd(radius * 2 + 1)
        kernel = np.zeros((length, length), dtype=np.float32)
        kernel[length // 2, :] = 1.0 / length
        kernel = _rotate_kernel(kernel, angle, length, ops)
        return ops.convolve(pixels, kernel)
    # Gaussian: the adapter derives the kernel from sigma, so a radius of 100
    # does not build a 201x201 kernel by hand.
    return ops.gaussian(pixels, max(radius / 3.0, 0.0))


def _sharpen(
    pixels: Any, params: Mapping[str, Any], *, frame: int, seed: int, ops: ImageOps
) -> Any:
    """Unsharp masking: the difference between the picture and a soft copy.

    The classic halo is a property of the radius, not of the amount, which is why
    both are parameters and neither is a single "sharpness" dial.
    """
    amount = _scalar(params, "amount", 40.0) / 100.0
    radius = max(0.1, _scalar(params, "radius", 1.0))
    if amount == 0.0:
        return pixels
    soft = ops.gaussian(pixels, radius / 2.0)
    return pixels + (pixels - soft) * amount


def _saturation(
    pixels: Any, params: Mapping[str, Any], *, frame: int, seed: int, ops: ImageOps
) -> Any:
    amount = _scalar(params, "saturation", 100.0) / 100.0
    if amount == 1.0:
        return pixels
    luma = pixels @ _LUMA
    return luma[..., None] + (pixels - luma[..., None]) * amount


def _invert(pixels: Any, params: Mapping[str, Any], *, frame: int, seed: int, ops: ImageOps) -> Any:
    channel = _choice(params, "channels", "rgb")
    if channel == "rgb":
        return 1.0 - pixels
    index = {"red": 0, "green": 1, "blue": 2}.get(channel)
    if index is None:
        return pixels
    out = pixels.copy()
    out[..., index] = 1.0 - out[..., index]
    return out


def _vignette(
    pixels: Any, params: Mapping[str, Any], *, frame: int, seed: int, ops: ImageOps
) -> Any:
    amount = _scalar(params, "amount", 30.0) / 100.0
    size = _scalar(params, "size", 50.0) / 100.0
    feather = max(_scalar(params, "feather", 50.0), 0.0) / 100.0
    if amount == 0.0:
        return pixels

    height, width = pixels.shape[:2]
    # Normalised to the half-diagonal so the corners are always 1.0 and a round
    # frame and a wide one vignette by the same *amount*.
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    dx = (xs - (width - 1) / 2.0) / (width / 2.0)
    dy = (ys - (height - 1) / 2.0) / (height / 2.0)
    radius = np.sqrt(dx * dx + dy * dy) / math.sqrt(2.0)

    if feather <= 0.0:
        mask = (radius > size).astype(np.float32)
    else:
        mask = np.clip((radius - size) / feather, 0.0, 1.0).astype(np.float32)
    return pixels * (1.0 - amount * mask[..., None])


def _glow(pixels: Any, params: Mapping[str, Any], *, frame: int, seed: int, ops: ImageOps) -> Any:
    """Threshold, blur, screen back over the picture.

    Screen rather than add: an additive bloom blows out the highlights it is
    meant to halo, and screen cannot exceed white.
    """
    threshold = _scalar(params, "threshold", 60.0) / 100.0
    radius = max(0.0, _scalar(params, "radius", 20.0))
    intensity = _scalar(params, "intensity", 100.0) / 100.0
    if intensity == 0.0:
        return pixels
    bright = np.clip(pixels - threshold, 0.0, 1.0)
    if radius > 0.0:
        bright = ops.gaussian(bright, radius / 3.0)
    bloom = np.clip(bright * intensity, 0.0, 1.0)
    return 1.0 - (1.0 - pixels) * (1.0 - bloom)


def _film_grain(
    pixels: Any, params: Mapping[str, Any], *, frame: int, seed: int, ops: ImageOps
) -> Any:
    amount = _scalar(params, "amount", 20.0) / 100.0
    size = max(0.5, _scalar(params, "size", 1.0))
    monochrome = _flag(params, "monochrome", True)
    if amount == 0.0:
        return pixels

    height, width = pixels.shape[:2]
    channels = 1 if monochrome else 3
    # Grain lives between the pixels, so it is generated small and stretched up:
    # `size` is how many screen pixels one grain covers.
    small_height = max(1, round(height / size))
    small_width = max(1, round(width / size))
    rng = np.random.default_rng([seed, frame])
    noise = rng.normal(0.0, 1.0, (small_height, small_width, channels)).astype(np.float32)
    if small_height != height or small_width != width:
        noise = ops.resize(noise, (width, height), interpolation=Interpolation.LINEAR)
    if channels == 1:
        noise = np.repeat(noise, 3, axis=2)
    # A fifth of the amount at full strength: grain at 100 % should read as
    # pushed film, not as television static.
    return pixels + noise * (amount * 0.2)


def _rotate_kernel(kernel: Any, angle: float, length: int, ops: ImageOps) -> Any:
    """Turn the blur's line kernel, and renormalise it afterwards.

    The matrix is six numbers of arithmetic, so it is built here rather than
    asked of the imaging port: a rotation is maths, not a library call. The
    weights are renormalised after the turn because interpolation spreads a
    line's mass unevenly, and a kernel that does not sum to one is a brightness
    change wearing a blur's clothes.
    """
    centre = (length / 2 - 0.5, length / 2 - 0.5)
    cosine, sine = math.cos(angle), math.sin(angle)
    matrix = np.array(
        [
            [cosine, sine, (1.0 - cosine) * centre[0] - sine * centre[1]],
            [-sine, cosine, sine * centre[0] + (1.0 - cosine) * centre[1]],
        ],
        dtype=np.float64,
    )
    rotated = np.asarray(
        ops.warp_affine(kernel, matrix, (length, length), interpolation=Interpolation.LINEAR),
        dtype=np.float32,
    )
    total = float(rotated.sum())
    if total > 0.0:
        rotated /= total
    return rotated


def _resample_about_centre(
    channel: Any, factor: float, height: int, width: int, ops: ImageOps
) -> Any:
    """One channel, scaled about the middle and fitted back to the frame.

    Enlarging crops in; shrinking pads out, and the pad replicates the edge
    rather than filling with black — a black rim reads as a matte, not as an
    aberration.
    """
    scaled = ops.resize(
        channel,
        (max(1, round(width * factor)), max(1, round(height * factor))),
        interpolation=Interpolation.LINEAR,
    )
    scaled_height, scaled_width = scaled.shape[:2]
    if factor >= 1.0:
        top = (scaled_height - height) // 2
        left = (scaled_width - width) // 2
        return scaled[top : top + height, left : left + width]
    top = (height - scaled_height) // 2
    left = (width - scaled_width) // 2
    return ops.edge_pad(
        scaled, top, height - scaled_height - top, left, width - scaled_width - left
    )


def _chromatic_aberration(
    pixels: Any, params: Mapping[str, Any], *, frame: int, seed: int, ops: ImageOps
) -> Any:
    """Red and blue scaled apart about the centre, in pixels at the frame edge.

    A lens separates radially, not sideways, so the channels are scaled about the
    middle rather than shifted: the centre stays registered and the corners
    fringe, which is the artefact the effect is named after.
    """
    amount = _scalar(params, "amount", 2.0)
    if amount == 0.0:
        return pixels
    height, width = pixels.shape[:2]
    half_diagonal = math.hypot(width, height) / 2.0
    step = amount / half_diagonal if half_diagonal else 0.0

    out = pixels.copy()
    for index, factor in ((0, 1.0 + step), (2, 1.0 - step)):
        if factor <= 0.0:
            continue
        out[..., index] = _resample_about_centre(pixels[..., index], factor, height, width, ops)
    return out


def _solid(pixels: Any, params: Mapping[str, Any], *, frame: int, seed: int, ops: ImageOps) -> Any:
    """A generator: it replaces the picture rather than filtering it."""
    colour = _colour(params, "colour", (0.0, 0.0, 0.0))
    return np.tile(colour, (*pixels.shape[:2], 1)).astype(np.float32)


# ---------------------------------------------------------------------------
# The registry
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class KernelRegistry:
    """Which effect types have arithmetic behind them, in this process.

    A value, like the effect registry: :meth:`register` returns a new registry,
    so a plugin that fails to install leaves the running one untouched and a
    snapshot for a render worker is a reference rather than a copy.
    """

    kernels: Mapping[str, EffectKernel] = field(default_factory=dict)

    def has(self, effect_type: str) -> bool:
        """Whether a kernel exists for this type."""
        return effect_type in self.kernels

    def kernel(self, effect_type: str) -> EffectKernel | None:
        return self.kernels.get(effect_type)

    def register(self, effect_type: str, kernel: EffectKernel) -> KernelRegistry:
        """The registry with one more kernel.

        Replacing an existing type is allowed and deliberate: that is how a
        plugin ships a faster implementation of a built-in, and how a site
        overrides one without forking the catalogue.
        """
        if not effect_type:
            raise NovaInvariantError("an effect type must not be empty")
        return replace(self, kernels={**self.kernels, effect_type: kernel})

    @property
    def types(self) -> frozenset[str]:
        return frozenset(self.kernels)


#: The kernels a fresh install has, keyed by the type in the catalogue.
_BUILTIN_KERNELS: Final[Mapping[str, EffectKernel]] = {
    "nova.blur": _blur,
    "nova.sharpen": _sharpen,
    "nova.saturation": _saturation,
    "nova.vignette": _vignette,
    "nova.invert": _invert,
    "nova.glow": _glow,
    "nova.film-grain": _film_grain,
    "nova.chromatic-aberration": _chromatic_aberration,
    "nova.solid": _solid,
}


def builtin_kernels() -> KernelRegistry:
    """Every kernel Nova Studio ships."""
    return KernelRegistry(kernels=dict(_BUILTIN_KERNELS))


def kernel_types() -> frozenset[str]:
    """The types `builtin_kernels()` can run.

    Asserted against the catalogue by a test, because an effect in
    `builtins.py` with no kernel here is one the UI offers and the renderer
    silently ignores — the one failure mode this split was meant to be safe
    against.
    """
    return frozenset(_BUILTIN_KERNELS)


# ---------------------------------------------------------------------------
# Running a chain
# ---------------------------------------------------------------------------


def _value_at(param: Any, frame: int) -> Any:
    """One parameter's value at one frame, ready for a kernel.

    An :class:`~nova_studio.domain.animation.Animatable` is a vector, so a
    parameter that holds a single number arrives as a one-tuple and a kernel
    that asks for a float should be handed one. Colours and two-dimensional
    values keep their shape; anything else — a string, a bool — passes through.
    """
    value = param.at(frame)
    if isinstance(value, tuple) and len(value) == 1:
        return value[0]
    return value


def _seed_for(effect_id: str) -> int:
    """A stable number from an id, for the one kernel that needs noise."""
    return zlib.crc32(effect_id.encode("utf-8"))


def to_float_rgb(buffer: FrameBuffer) -> Any:
    """Any `FrameBuffer` as opaque float RGB in 0..1. See the module note on alpha."""
    pixels = buffer.pixels
    if buffer.channels == 1:
        return np.repeat(pixels, 3, axis=2).astype(np.float32) / 255.0
    if buffer.channels == 4:
        # Flattened over black: an RGBA source is premultiplied by its own alpha
        # and the result is opaque, because video has no alpha channel to carry.
        alpha = pixels[..., 3:4].astype(np.float32) / 255.0
        return (pixels[..., :3].astype(np.float32) * alpha) / 255.0
    return pixels.astype(np.float32) / 255.0


def from_float_rgb(pixels: Any, colour: ColourMeta) -> FrameBuffer:
    """Float RGB back to the domain's `FrameBuffer`."""
    clipped = np.clip(pixels, 0.0, 1.0)
    return FrameBuffer(pixels=(clipped * 255.0 + 0.5).astype(np.uint8), colour=colour)


def apply_chain(
    chain: EffectChain,
    buffer: FrameBuffer,
    *,
    registry: KernelRegistry,
    ops: ImageOps,
    frame: int,
) -> FrameBuffer:
    """Run one chain over one picture, in stack order.

    Bypassed effects are skipped without leaving the stack. Each kernel's result
    is mixed with its own input by the effect's wet/dry mix, so a mix of 0.6 is
    sixty percent effect rather than an effect at sixty percent strength — the
    difference that lets a user soften a blur without re-tuning its radius.

    An effect whose type has no kernel is skipped, and that is a decision rather
    than an oversight: a project that names an effect whose plugin is not
    installed must still render (ADR-0015 rule 3), and a missing kernel is the
    same situation as a missing plugin.

    The float round trip happens once per chain, not once per effect, and only
    when something is actually going to run.

    :param ops: the pixel primitives a kernel may use — see
        :class:`nova_studio.ports.imaging.ImageOps`. Passed in rather than
        imported because a kernel that imports OpenCV cannot be tested without
        it, and cannot be moved to a GPU.
    """
    active = chain.active
    if not active:
        return buffer

    pixels = to_float_rgb(buffer)
    for effect in active:
        kernel = registry.kernel(effect.type)
        if kernel is None:
            continue
        params = {param.name: _value_at(param, frame) for param in effect.params}
        result = kernel(pixels, params, frame=frame, seed=_seed_for(effect.effect_id), ops=ops)
        if effect.mix >= 1.0:
            pixels = result
        else:
            pixels = pixels + (result - pixels) * float(effect.mix)
    return from_float_rgb(pixels, buffer.colour)
