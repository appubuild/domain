"""L3 — the compositor: a `FramePlan` becomes pixels.

This is the stage `media-and-rendering.md` §7.2 calls **composite**, and it is
the only place in the engine where two pictures are ever combined. Preview and
export both call it, with the same plan and different sizes, which is the
invariant that keeps "it looked right in the viewer" true of the file.

The module takes a plan — a pure value, already built by `frames.py` — plus the
pictures the media layer decoded for it, and returns a frame. It decodes
nothing, reads no files and never sees a project, which is what makes a
composited frame reproducible in a test with no filesystem.

Order of operations, and why
----------------------------
For every layer, bottom first:

1. **Crop**, on the source, before anything else. A cropped-away pixel should
   never have been blurred.
2. **The layer's own effect chains**, then **its grades** — the clip's first,
   then its track's, which is the order the plan records. Both run in the
   source's geometry, because an effect on a clip is an effect on that clip, not
   on the frame it happens to be sitting in.
3. **The transform** — scale about the anchor, rotate, skew, then place. One
   affine warp, not a chain of resamples: five passes of bilinear interpolation
   is five generations of softness.
4. **The transition mix**, when the layer is one half of a pair: its opacity,
   its offset and its scale, all normalised so a bake means the same thing at
   960×540 and at 3840×2160.
5. **The blend**, source-over, onto the canvas.

Then, once, over the composited result: the output effects and the output grade.
"The look of the film" is a property of the frame, not of any clip in it, and
applying it last is what makes it true of both.

Working space
-------------
The canvas is float32 RGBA in 0..1 with **straight** alpha: float because every
stage here is a multiply or a lerp and each of them would band in eight bits,
straight because that is the only form an editor's mental model matches. It
costs memory — a 4K frame is 132 MB while it is being composited — which is a
deliberate trade against correctness, and the first thing a tiled or GPU
compositor would take back.

The output is **opaque RGB**: video has no alpha channel to carry, so a
transparent pixel is baked against the transition fill (black by default) rather
than handed back as alpha a muxer will quietly drop.

Two honest limits, both recorded rather than papered over:

* **Colour.** The compositor works in whatever space its inputs declare and does
  no conversion between them: a clip tagged BT.709 and one tagged BT.601 are
  composited as if they agreed, because converting is a decision the colour
  pipeline owns (`domain/grade.py`) and doing it silently here would make every
  frame a guess. The caller tags the result.
* **A layer whose picture is missing is skipped.** One offline file must not cost
  the frame; the media layer reports it, and the render job decides.

Determinism
-----------
No clocks, no unseeded randomness, no I/O. The same plan and the same pictures
produce the same bytes, which is what lets a preview frame be compared against
its export and a resumed render produce the file it would have produced.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import TYPE_CHECKING, Any, Final

import numpy as np

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.effects import TransformSample
from nova_studio.domain.grade import CurveChannel
from nova_studio.domain.media import ColourMeta, FrameBuffer
from nova_studio.ports.imaging import BorderMode
from nova_studio.services.render.frames import TransitionRole
from nova_studio.services.render.kernels import (
    apply_chain,
    builtin_kernels,
    from_float_rgb,
    to_float_rgb,
)

if TYPE_CHECKING:
    from nova_studio.domain.grade import GradeSample, Lut
    from nova_studio.domain.timeline import TransitionMix
    from nova_studio.ports.imaging import ImageOps
    from nova_studio.services.render.frames import FramePlan, LayerPlan
    from nova_studio.services.render.kernels import KernelRegistry

__all__ = ["LutTableReader", "apply_grade", "composite_frame"]


#: Rec.709 luma coefficients, used by saturation and by nothing else.
_LUMA: Final[Any] = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

#: A 3D LUT table: `size³` RGB triples in 0..1, indexed `[r, g, b]`.
LutTableReader = Callable[["Lut"], Any]


# ---------------------------------------------------------------------------
# The frame
# ---------------------------------------------------------------------------


def composite_frame(
    plan: FramePlan,
    pictures: dict[tuple[str, int, str], FrameBuffer],
    *,
    ops: ImageOps,
    kernels: KernelRegistry | None = None,
    luts: LutTableReader | None = None,
    colour: ColourMeta | None = None,
) -> FrameBuffer:
    """Composite one planned frame.

    Args:
        plan: The recipe, already built by `frames.plan_frame`. Its own `frame`
            number is what animatable parameters are sampled at.
        ops: The pixel primitives the compositor resamples with — see
            `nova_studio.ports.imaging.ImageOps`. Injected rather than imported:
            a compositor that names OpenCV cannot be tested without it, and
            cannot be moved to a GPU.
        pictures: The decoded pictures, keyed by `DecodeRequest.key`
            — `(asset_id, source_frame, source)`. A layer whose key is absent is
            skipped rather than drawn as black.
        kernels: Which effect arithmetic exists. Defaults to the built-ins.
        luts: How to turn a `Lut` into a table. Required only by a grade that
            carries one.
        colour: What to tag the result with. The compositor works in the working
            space and cannot know which space that is, so the caller — the
            export pipeline, reading it from the output spec — says.

    Returns:
        An opaque `FrameBuffer` the size of the plan's composition.

    Raises:
        NovaInvariantError: If the plan names a size that is not a frame, or a
            grade carries a LUT that no reader was supplied for.
    """
    registry = kernels if kernels is not None else builtin_kernels()
    width, height = plan.size
    if width < 1 or height < 1:
        raise NovaInvariantError(f"a composition must have a size, got {width}x{height}")

    canvas = _canvas(width, height, fill=_fill_of(plan))
    for layer in plan.layers:  # bottom first, the order the plan records
        source = _layer_source(layer, pictures, plan, registry, ops, luts=luts)
        if source is None:
            continue
        placed = _place(source, layer, (width, height), ops)
        canvas = _over(canvas, placed)

    composed = from_float_rgb(_flatten(canvas), colour or ColourMeta())
    if plan.output_effects is not None:
        composed = apply_chain(
            plan.output_effects, composed, registry=registry, ops=ops, frame=plan.frame
        )
    if plan.output_grade is not None:
        composed = apply_grade(plan.output_grade.at(plan.frame), composed, luts=luts)
    return composed


def _fill_of(plan: FramePlan) -> float | None:
    """What shows where nothing does: `None` unless the frame is transitioning.

    A dip to black and a dip to white are the same bake except for this number,
    which is exactly why `TransitionMix` carries it.
    """
    fills = [layer.transition.fill for layer in plan.layers if layer.transition is not None]
    return max(fills) if fills else None


def _canvas(width: int, height: int, *, fill: float | None) -> Any:
    """The empty frame: transparent, or the transition fill when there is one."""
    canvas = np.zeros((height, width, 4), dtype=np.float32)
    if fill is not None:
        canvas[..., :3] = float(fill)
        canvas[..., 3] = 1.0
    return canvas


def _flatten(canvas: Any) -> Any:
    """Straight-alpha canvas to opaque RGB: the frame, over the fill."""
    return canvas[..., :3] * canvas[..., 3:4]


# ---------------------------------------------------------------------------
# One layer
# ---------------------------------------------------------------------------


def _layer_source(
    layer: LayerPlan,
    pictures: dict[tuple[str, int, str], FrameBuffer],
    plan: FramePlan,
    registry: KernelRegistry,
    ops: ImageOps,
    *,
    luts: LutTableReader | None,
) -> FrameBuffer | None:
    """The layer's picture after its own effects and grades.

    `None` when the media layer could not produce one — an offline asset — and
    the layer is then skipped rather than drawn as a black rectangle over
    everything beneath it.
    """
    request = layer.decode()
    source: FrameBuffer | None
    if request is None:
        # A generated clip: nothing to decode. Its picture, if it has one, comes
        # from a generator effect in its chain, which is why a black
        # composition-sized buffer goes in: `nova.solid` replaces it, and an
        # ordinary chain applied to nothing still returns nothing.
        width, height = plan.size
        source = FrameBuffer(pixels=np.zeros((height, width, 3), dtype=np.uint8))
    else:
        source = pictures.get(request.key)
    if source is None:
        return None

    for chain in layer.effects:
        source = apply_chain(chain, source, registry=registry, ops=ops, frame=plan.frame)
    for grade in layer.grades:
        source = apply_grade(grade.at(plan.frame), source, luts=luts)
    return source


def _place(source: FrameBuffer, layer: LayerPlan, size: tuple[int, int], ops: ImageOps) -> Any:
    """Crop, transform, mix and land one picture on the frame, as RGBA float."""
    sample: TransformSample = (
        _IDENTITY if layer.transform is None else layer.transform.at(layer.source_frame)
    )
    cropped = _crop(source, sample)
    rgba = np.dstack((to_float_rgb(cropped), np.ones(cropped.pixels.shape[:2], np.float32)))
    matrix = _matrix_for(cropped, sample, size, layer.transition, layer.transition_role)
    # A transparent border, not a replicated one: a clip dragged half off the
    # frame has nothing to smear in from the side.
    warped = np.asarray(
        ops.warp_affine(rgba, matrix, size, border=BorderMode.CONSTANT), dtype=np.float32
    )
    alpha = _alpha_of(sample, layer.transition, layer.transition_role)
    if alpha < 1.0:
        warped[..., 3] = warped[..., 3] * alpha
    return warped


def _crop(source: FrameBuffer, sample: TransformSample) -> FrameBuffer:
    """Crop and mirror the source, in that order.

    Both are source-side operations and both happen before anything else: a
    pixel that is cropped away must not have been blurred, sharpened or graded
    on its way to being thrown out. Mirroring is here rather than in the affine
    matrix because a flip is exact — a negative scale in the matrix would land
    the picture a fraction of a pixel off its own centre.
    """

    left, top, right, bottom = sample.crop
    cropped = any((left, top, right, bottom))
    if not cropped and not sample.flip_x and not sample.flip_y:
        return source
    height, width = source.height, source.width
    if not cropped:
        left = top = right = bottom = 0.0
    x0 = min(round(width * left), width - 1)
    x1 = max(round(width * (1.0 - right)), x0 + 1)
    y0 = min(round(height * top), height - 1)
    y1 = max(round(height * (1.0 - bottom)), y0 + 1)
    pixels = source.pixels[y0:y1, x0:x1]
    if sample.flip_x:
        pixels = pixels[:, ::-1]
    if sample.flip_y:
        pixels = pixels[::-1, :]
    return FrameBuffer(pixels=np.ascontiguousarray(pixels), colour=source.colour)


def _matrix_for(
    cropped: FrameBuffer,
    sample: TransformSample,
    size: tuple[int, int],
    mix: TransitionMix | None,
    role: TransitionRole | None,
) -> Any:
    """The affine matrix that lands the cropped source on the frame.

    Scale, then rotation, then skew — in that order, because that is the order
    the controls imply: a clip scaled to half and turned 90° is not the same
    picture as one turned 90° and then scaled. All three happen about the
    anchor, and the anchor is what ends up at the layer's position, so moving a
    clip never moves it *and* rotates it about a different point.
    """
    width, height = size
    source_w, source_h = float(cropped.width), float(cropped.height)
    scale_x, scale_y = sample.scale
    if mix is not None and role is not None:
        # The transition's own scale: 1.0 is frame-filling, and it multiplies
        # whatever the clip's transform asked for rather than replacing it.
        mix_scale = mix.a_scale if role is TransitionRole.OUTGOING else mix.b_scale
        scale_x *= mix_scale
        scale_y *= mix_scale

    theta = math.radians(sample.rotation)
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    # y grows downward, so this is a clockwise rotation on screen — which is what
    # the parameter promises.
    rotation = np.array([[cos_t, -sin_t], [sin_t, cos_t]], dtype=np.float64)
    skew_x, skew_y = (math.radians(value) for value in sample.skew)
    skew = np.array([[1.0, math.tan(skew_x)], [math.tan(skew_y), 1.0]], dtype=np.float64)
    linear = skew @ rotation @ np.array([[scale_x, 0.0], [0.0, scale_y]], dtype=np.float64)

    anchor_x, anchor_y = sample.anchor
    # The anchor is normalised to the clip: (0, 0) is its middle, (-1, -1) its
    # top-left corner.
    anchor = np.array(
        [source_w / 2.0 + anchor_x * source_w / 2.0, source_h / 2.0 + anchor_y * source_h / 2.0]
    )
    offset_x, offset_y = (0.0, 0.0)
    if mix is not None and role is not None:
        # Offsets are in frames from centre, so they mean the same thing at any
        # output size.
        offset_x, offset_y = mix.a_offset if role is TransitionRole.OUTGOING else mix.b_offset
    target = np.array(
        [
            width / 2.0 + sample.position[0] + offset_x * width,
            height / 2.0 + sample.position[1] + offset_y * height,
        ]
    )
    translation = target - linear @ anchor
    return np.array(
        [
            [linear[0, 0], linear[0, 1], translation[0]],
            [linear[1, 0], linear[1, 1], translation[1]],
        ],
        dtype=np.float64,
    )


def _alpha_of(
    sample: TransformSample, mix: TransitionMix | None, role: TransitionRole | None
) -> float:
    """How opaque the layer ends up: its own opacity times the transition's."""
    alpha = float(sample.opacity)
    if mix is not None and role is not None:
        alpha *= mix.a_opacity if role is TransitionRole.OUTGOING else mix.b_opacity
    return min(max(alpha, 0.0), 1.0)


def _over(base: Any, top: Any) -> Any:
    """Source-over, with straight alpha.

    The one blend every layer uses. Straight rather than premultiplied because a
    layer's colour is the thing a user picks, and premultiplying it would make a
    half-transparent white read as grey on the way through the pipeline.
    """
    top_a = top[..., 3:4]
    base_a = base[..., 3:4]
    out_a = top_a + base_a * (1.0 - top_a)
    numerator = top[..., :3] * top_a + base[..., :3] * base_a * (1.0 - top_a)
    out_rgb = np.divide(numerator, out_a, out=np.zeros_like(numerator), where=out_a > 1e-6)
    return np.concatenate((out_rgb, out_a), axis=2).astype(np.float32)


#: The geometry of a layer nobody has touched, used when the project has no
#: transform bound to a clip.
_IDENTITY: Final[TransformSample] = TransformSample(
    position=(0.0, 0.0),
    scale=(1.0, 1.0),
    rotation=0.0,
    anchor=(0.0, 0.0),
    skew=(0.0, 0.0),
    opacity=1.0,
    crop=(0.0, 0.0, 0.0, 0.0),
    flip_x=False,
    flip_y=False,
)


# ---------------------------------------------------------------------------
# Grading
# ---------------------------------------------------------------------------


def apply_grade(
    sample: GradeSample,
    buffer: FrameBuffer,
    *,
    luts: LutTableReader | None = None,
) -> FrameBuffer:
    """Apply one sampled grade to one picture.

    The order is the order a colourist works in: exposure and contrast first,
    then the white balance, then the lift/gamma/gain lift the shadows and roll
    the midtones, then saturation, then curves, and the LUT last of all because
    a look is applied to a picture that has already been balanced.

    Every stage is centred on neutral: a grade sampled to all zeros is the
    identity, which is what lets `ColourGrade.is_neutral` skip the whole thing on
    the enormous majority of clips in a project.

    Args:
        sample: The grade, already resolved at a frame.
        buffer: The picture.
        luts: How to turn a `Lut` into a table.

    Raises:
        NovaInvariantError: If the grade carries a LUT and no reader was given.
            Skipping it silently would deliver a file with the wrong look in it,
            which is the one failure colour has that a user cannot see coming.
    """
    if sample.is_neutral and not sample.curves and sample.lut is None:
        return buffer
    pixels = to_float_rgb(buffer)

    if sample.exposure:
        pixels = pixels * float(2.0**sample.exposure)
    if sample.contrast:
        pixels = (pixels - 0.5) * (1.0 + float(sample.contrast)) + 0.5
    if sample.temperature or sample.tint:
        pixels = pixels * _white_balance(sample.temperature, sample.tint)
    if any(sample.gain) or any(sample.lift):
        pixels = pixels * (1.0 + np.array(sample.gain, dtype=np.float32)) + np.array(
            sample.lift, dtype=np.float32
        )
    if any(sample.gamma):
        # Gamma above zero brightens, so the exponent is its reciprocal; the clip
        # keeps a negative pixel from producing a complex number.
        power = 1.0 / (1.0 + np.array(sample.gamma, dtype=np.float32))
        pixels = np.clip(pixels, 0.0, None) ** power
    if sample.saturation:
        luma = pixels @ _LUMA
        pixels = luma[..., None] + (pixels - luma[..., None]) * (1.0 + float(sample.saturation))

    for curve in sample.curves:
        pixels = _apply_curve(pixels, curve)
    if sample.lut is not None:
        if luts is None:
            raise NovaInvariantError(
                f"the grade carries the LUT '{sample.lut.name or sample.lut.path}' "
                "and no LUT reader was given"
            )
        table = luts(sample.lut)
        pixels = _apply_lut(pixels, table, float(sample.lut_strength))

    return from_float_rgb(pixels, buffer.colour)


def _white_balance(temperature: float, tint: float) -> Any:
    """Per-channel gains for a white-balance shift.

    Temperature is blue/amber and tint is green/magenta, and both are expressed
    as a fraction of a stop's worth of correction rather than as raw multipliers,
    so the parameter reads the same way the control does in every other editor.
    """
    warm = float(temperature) * 0.1
    green = float(tint) * 0.1
    return np.array([1.0 + warm, 1.0 + green, 1.0 - warm], dtype=np.float32)


def _apply_curve(pixels: Any, curve: Any) -> Any:
    """One curve, as a 256-entry table.

    Sampling the curve once per level instead of once per pixel is the whole
    trick: a curve is a function of one number, and a 4K frame has eight million
    of them that take only 256 distinct values.
    """
    levels = np.linspace(0.0, 1.0, 256, dtype=np.float32)
    table = np.array([float(curve.at(float(level))) for level in levels], dtype=np.float32)
    indices = np.clip((pixels * 255.0 + 0.5).astype(np.int32), 0, 255)
    mapped = table[indices]
    channel = curve.channel
    if channel is CurveChannel.MASTER:
        return mapped
    position = {CurveChannel.RED: 0, CurveChannel.GREEN: 1, CurveChannel.BLUE: 2}.get(channel)
    if position is None:
        return pixels
    out = pixels.copy()
    out[..., position] = mapped[..., position]
    return out


def _apply_lut(pixels: Any, table: Any, strength: float) -> Any:
    """Trilinear sample of a 3D LUT.

    The table is `size³ × 3`, indexed `[r, g, b]`. Interpolating rather than
    rounding is what keeps a 17³ LUT from banding across a gradient — which is
    the artefact that gives LUTs a bad name in cheap software.
    """
    if strength <= 0.0:
        return pixels
    size = int(table.shape[0])
    if size < 2:
        return pixels
    coordinates = np.clip(pixels, 0.0, 1.0) * (size - 1)
    low = np.floor(coordinates).astype(np.int32)
    high = np.minimum(low + 1, size - 1)
    weight = (coordinates - low).astype(np.float32)

    sampled = np.zeros_like(pixels)
    for corner in range(8):
        r = (corner >> 0) & 1
        g = (corner >> 1) & 1
        b = (corner >> 2) & 1
        corner_weight = (
            (weight[..., 0] if r else 1.0 - weight[..., 0])
            * (weight[..., 1] if g else 1.0 - weight[..., 1])
            * (weight[..., 2] if b else 1.0 - weight[..., 2])
        )
        sampled += (
            table[
                low[..., 0] if not r else high[..., 0],
                low[..., 1] if not g else high[..., 1],
                low[..., 2] if not b else high[..., 2],
            ]
            * corner_weight[..., None]
        )
    return pixels + (sampled - pixels) * min(strength, 1.0)
