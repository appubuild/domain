"""L2 port — imaging: the handful of pixel operations a renderer needs.

A compositor is arithmetic on arrays, and almost all of it is NumPy. Six
operations are *not*: resampling, warping, convolution, blurring and padding are
where a real implementation earns its speed (SIMD, separable kernels, GPU
kernels), and they are the only reason an effect engine would ever reach for a
library. This port is that reach.

Why it exists, and not an import
--------------------------------
OpenCV is confined to ``infra`` by ``scripts/check_layering.py`` — rule 2 of
ADR-0002, the same rule that keeps PyAV out of the services. But the rule is
only half the reason; the other half is that there genuinely are two
implementations we intend to ship:

* an OpenCV/CPU adapter — the default, available everywhere;
* a GPU adapter — ADR-0012 §2 already plans ``ports/gpu.py`` as per-operation
  acceleration, and every operation below is one a shader can do.

A renderer that imports ``cv2`` directly can have neither. A renderer that is
handed an :class:`ImageOps` gets both, and its unit tests get a third: a
plain-NumPy reference that runs on a machine with no OpenCV installed at all,
which is the concrete form of "services can be tested without the I/O
libraries" (ADR-0002).

Six operations, no more
-----------------------
The list is deliberately short. Every entry is something a plugin's kernel might
need and NumPy cannot do well; the moment a seventh is proposed it should be
checked against that rule, because a port that grows an operation per effect has
become OpenCV with extra steps.

Contract rules an adapter must honour
-------------------------------------
1. **Float in, float out.** Inputs and outputs are ``float32`` arrays of shape
   ``HxW``, ``HxWx1``, ``HxWx3`` or ``HxWx4``. The dtype is preserved, values
   are **not** clipped to 0..1 — clipping is a compositing decision, made once,
   by the caller (see ``services/render/composite.py``).
2. **Channel-agnostic.** An adapter never assumes three channels: masks are
   single-channel, and the compositor warps RGBA.
3. **Deterministic.** The same inputs give the same bytes, every time, on every
   machine. Two implementations may differ in the last bit — the tests compare
   with a tolerance for that reason — but neither may differ from *itself*.
4. **No I/O.** No files, no devices, no caches, no logging. These are
   arithmetic; the moment one of them touches a device it belongs in a different
   port.
5. **Pixels are passed as ``Any``** — a NumPy array, typing-wise — because a
   port may not name a third-party type in a signature, and because an adapter
   that returns a different array library's buffer is a legal future.

Deliberately not here: colour-space conversion (that is
``domain.media.ColourMeta`` plus the decode/encode boundary), drawing, text and
file IO. An effect that needs to draw text is a caption engine, not a kernel.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Protocol, runtime_checkable

__all__ = ["BorderMode", "ImageOps", "Interpolation"]


class Interpolation(StrEnum):
    """How a resampling operation invents the pixels it does not have.

    Named for what the user sees, not for the constant underneath: an adapter
    maps these to whatever its library calls them.
    """

    #: Take the nearest source pixel: fast, and the only right choice for a
    #: mask, because it is the one mode that never invents a value that was not
    #: in the input. Where two source pixels are equally near, an adapter picks
    #: either — no resampler promises a tie-break, and a caller that depends on
    #: one is depending on something that changes between library versions.
    NEAREST = "nearest"
    #: Bilinear. The default, and the right one for moving pictures: a frame
    #: scaled with cubic filtering shimmers where it should simply be soft.
    LINEAR = "linear"
    #: Bicubic. Sharper on a still; slower, and it rings on an edge.
    CUBIC = "cubic"
    #: Pixel-area averaging. The mode to *shrink* with: a frame halved with a
    #: bilinear filter aliases — fine detail turns into shimmer, and shimmer is
    #: a lie about the picture the user is judging. Area averaging cannot
    #: enlarge, which is why it is not the default.
    AREA = "area"


class BorderMode(StrEnum):
    """What an operation finds beyond the edge of the picture."""

    #: Black — and transparent, when the array carries an alpha channel. What a
    #: warped layer must use: a clip moved half off the frame has nothing to
    #: smear in from the side.
    CONSTANT = "constant"
    #: Repeat the edge pixel. What a blur must use: a dark rim around a blurred
    #: frame is an artefact, not a picture.
    REPLICATE = "replicate"


@runtime_checkable
class ImageOps(Protocol):
    """The pixel primitives a render engine borrows from a library.

    One instance is created per render and shared: an adapter may hold a device
    context or a thread pool, and creating one per frame is how a renderer that
    benchmarks well in isolation ends up slow in production. Nothing here is
    required to be thread-safe *within* one instance.
    """

    def resize(
        self,
        pixels: Any,
        size: tuple[int, int],
        *,
        interpolation: Interpolation = Interpolation.LINEAR,
    ) -> Any:
        """Resample to an exact ``(width, height)``.

        The destination size is given, not a scale factor, because the caller
        has already decided the geometry — a layer that scales to 0.5 of a
        1921-pixel frame is 960 or 961 pixels wide, and that rounding is the
        caller's call, not the adapter's.

        :param size: ``(width, height)`` of the result, both at least 1.
        """
        ...

    def warp_affine(
        self,
        pixels: Any,
        matrix: Any,
        size: tuple[int, int],
        *,
        interpolation: Interpolation = Interpolation.LINEAR,
        border: BorderMode = BorderMode.CONSTANT,
    ) -> Any:
        """Apply a 2x3 affine matrix, forward.

        The matrix is built by the caller — it is six numbers of arithmetic, and
        the compositor needs to compose scale, rotation and skew about an anchor
        before it ever calls this. **It maps source to destination**: the point
        a corner of the picture sits at says where that corner ends up, which is
        the direction the maths is written in and the direction OpenCV's
        ``warpAffine`` takes by default (without ``WARP_INVERSE_MAP``). An
        adapter inverts it internally, because a gather can only ask where each
        output pixel comes from.

        A constant border is *not* a hard crop: an output pixel whose taps are
        partly outside the source gets that fraction of them, so a layer dragged
        half off the frame fades at its own edge instead of being cut. That is
        what makes an alpha channel fade out with the picture it belongs to.

        :param matrix: a 2x3 float array, source to destination.
        :param size: ``(width, height)`` of the result.
        """
        ...

    def gaussian(self, pixels: Any, sigma: float) -> Any:
        """Blur with a Gaussian of the given sigma, padded by replication.

        The kernel size is the adapter's business: sigma determines it, and
        letting the library derive it is what keeps a radius of 200 from
        building a 401x401 kernel by hand.

        :param sigma: standard deviation in pixels; ``0`` means no blur.
        """
        ...

    def box(self, pixels: Any, size: int) -> Any:
        """Blur with a square box average of the given side, in pixels.

        Cheaper than a Gaussian and visibly different: a box blur smears a
        highlight into a square, which is exactly why some effects want it.

        :param size: side of the box, at least 1. Even sizes are rounded up.
        """
        ...

    def convolve(self, pixels: Any, kernel: Any) -> Any:
        """Correlate with a small 2-D kernel, padded by replication.

        This is the escape hatch: motion blur is a rotated line, and no library
        ships a filter for every shape an effect designer invents.

        :param kernel: a 2-D float array, square, odd side, summing to about 1
            (an adapter normalises it, so a hand-built kernel need not be exact).
        """
        ...

    def edge_pad(self, pixels: Any, top: int, bottom: int, left: int, right: int) -> Any:
        """Grow the picture by repeating its edge pixels, in that order.

        Used when a channel has been scaled *down* and has to be fitted back to
        the frame it came from: filling the gap with black would draw a matte
        where the effect wanted a fringe.

        :param top: rows to add above, at least 0.
        :param bottom: rows to add below, at least 0.
        :param left: columns to add before, at least 0.
        :param right: columns to add after, at least 0.
        """
        ...
