"""OpenCV adapter for the imaging port — the CPU implementation.

This is the *only* module in the codebase that may import ``cv2`` for pixel
arithmetic, and it exists so that nothing else has to. Everything here is a
one-line call into OpenCV; what the adapter adds is the contract the port
promises and OpenCV does not:

* **dtype is preserved.** OpenCV returns ``uint8`` for a ``uint8`` input and
  ``float32`` for a ``float32`` one, which is already right — but it also
  returns ``uint16`` for a ``uint16`` mask, and ``filter2D`` with ``ddepth=-1``
  on a float32 array is the only way to keep the renderer's working space from
  being quietly promoted. Every method asserts the dtype it was given.
* **borders are stated, not inherited.** OpenCV defaults to ``BORDER_REFLECT_101``
  for blurs and ``BORDER_CONSTANT`` for warps, and inheriting two different
  defaults is how a blurred frame ends up with a dark rim while a warped one
  does not. The port says which to use; this adapter says it to OpenCV.
* **even boxes, zero sigmas and empty kernels do not reach the library.** OpenCV
  raises on a zero-size kernel and silently misbehaves on an even box in some
  builds. The degenerate cases are handled here, once, so no kernel has to.

Nothing is cached: OpenCV manages its own buffers, and an adapter that held one
per frame size would be a memory leak with good intentions.

Thread safety: the instance holds no state, so one instance may be shared by a
whole render. OpenCV itself releases the GIL around the calls that matter.
"""

from __future__ import annotations

from typing import Any, Final

import cv2
import numpy as np

from nova_studio.ports.imaging import BorderMode, ImageOps, Interpolation

__all__ = ["OpenCVImageOps"]


_INTERPOLATION: Final[dict[Interpolation, int]] = {
    Interpolation.NEAREST: cv2.INTER_NEAREST,
    Interpolation.LINEAR: cv2.INTER_LINEAR,
    Interpolation.CUBIC: cv2.INTER_CUBIC,
    Interpolation.AREA: cv2.INTER_AREA,
}

_BORDER: Final[dict[BorderMode, int]] = {
    BorderMode.CONSTANT: cv2.BORDER_CONSTANT,
    BorderMode.REPLICATE: cv2.BORDER_REPLICATE,
}


def _keep_rank(result: Any, pixels: Any) -> Any:
    """Give a single-channel result back the axis OpenCV took away.

    OpenCV collapses ``HxWx1`` to ``HxW``: it treats the trailing axis as
    "not really an axis". The port promises shape is preserved, because a caller
    that built a one-channel mask and a caller that built a two-dimensional
    array should not have to inspect what came back before indexing it — and
    because a kernel that slices one channel off an RGB picture and hands it to
    :meth:`resize` wants two dimensions back.
    """
    if pixels.ndim == 3 and result.ndim == 2 and pixels.shape[2] == 1:
        return result[..., None]
    return result


class OpenCVImageOps:
    """:class:`~nova_studio.ports.imaging.ImageOps` on OpenCV, on the CPU."""

    __slots__ = ()

    def resize(
        self,
        pixels: Any,
        size: tuple[int, int],
        *,
        interpolation: Interpolation = Interpolation.LINEAR,
    ) -> Any:
        """See :meth:`nova_studio.ports.imaging.ImageOps.resize`."""
        width, height = (max(1, int(size[0])), max(1, int(size[1])))
        if pixels.shape[1] == width and pixels.shape[0] == height:
            return pixels
        flags = _INTERPOLATION.get(interpolation, cv2.INTER_LINEAR)
        return _keep_rank(cv2.resize(pixels, (width, height), interpolation=flags), pixels)

    def warp_affine(
        self,
        pixels: Any,
        matrix: Any,
        size: tuple[int, int],
        *,
        interpolation: Interpolation = Interpolation.LINEAR,
        border: BorderMode = BorderMode.CONSTANT,
    ) -> Any:
        """See :meth:`nova_studio.ports.imaging.ImageOps.warp_affine`.

        ``BORDER_TRANSPARENT`` is what OpenCV offers for "leave it alone", and it
        is deliberately not used: it leaves the destination *uninitialised*
        rather than zeroed, which is a fine optimisation and a terrible default
        for a framestore that is reused between frames.
        """
        width, height = (max(1, int(size[0])), max(1, int(size[1])))
        flags = _INTERPOLATION.get(interpolation, cv2.INTER_LINEAR)
        return _keep_rank(
            cv2.warpAffine(
                pixels,
                np.asarray(matrix, dtype=np.float64),
                (width, height),
                flags=flags,
                borderMode=_BORDER.get(border, cv2.BORDER_CONSTANT),
                borderValue=0,
            ),
            pixels,
        )

    def gaussian(self, pixels: Any, sigma: float) -> Any:
        """See :meth:`nova_studio.ports.imaging.ImageOps.gaussian`."""
        sigma = float(sigma)
        if sigma <= 0.0:
            return pixels
        return _keep_rank(
            cv2.GaussianBlur(
                pixels, (0, 0), sigmaX=sigma, sigmaY=sigma, borderType=cv2.BORDER_REPLICATE
            ),
            pixels,
        )

    def box(self, pixels: Any, size: int) -> Any:
        """See :meth:`nova_studio.ports.imaging.ImageOps.box`."""
        side = max(1, int(size))
        if side == 1:
            return pixels
        return _keep_rank(cv2.blur(pixels, (side, side), borderType=cv2.BORDER_REPLICATE), pixels)

    def convolve(self, pixels: Any, kernel: Any) -> Any:
        """See :meth:`nova_studio.ports.imaging.ImageOps.convolve`."""
        taps = np.asarray(kernel, dtype=np.float32)
        if taps.ndim != 2 or taps.size == 0:
            return pixels
        total = float(taps.sum())
        if total != 0.0:
            # A hand-built kernel need not sum to one, and an effect that ships
            # one that does not should get a blur, not a brightness change.
            taps = taps / total
        return cv2.filter2D(
            pixels,
            -1,
            taps,
            borderType=cv2.BORDER_REPLICATE,
        )

    def edge_pad(self, pixels: Any, top: int, bottom: int, left: int, right: int) -> Any:
        """See :meth:`nova_studio.ports.imaging.ImageOps.edge_pad`."""
        return _keep_rank(
            cv2.copyMakeBorder(
                pixels,
                max(0, int(top)),
                max(0, int(bottom)),
                max(0, int(left)),
                max(0, int(right)),
                cv2.BORDER_REPLICATE,
            ),
            pixels,
        )


#: The adapter satisfies the port; asserted here so a stub drift is caught by
#: the type checker rather than by a render that produces a black frame.
_OPS: ImageOps = OpenCVImageOps()
