"""A deliberately naive :class:`ImageOps`, in NumPy and nothing else.

This exists to prove that :mod:`nova_studio.ports.imaging` is a seam and not a
decoration. The layering checker confines OpenCV to ``infra`` on the argument
that a service which imports it cannot be tested without it — an argument that
is only true if something actually implements the port with a different library.
So this does, slowly: no SIMD, no separability tricks beyond the obvious, no
fixed-point arithmetic, explicit Python loops in the two-dimensional convolver.

It is not shipped and it is not a fallback. It is the reference the OpenCV
adapter is measured against in ``tests/infra/test_imaging.py``, and the second
implementation the port rule requires before a port is allowed to exist at all.

Everything here is written the way the maths is written, not the way it would
be written for speed — a reference implementation that shares an optimisation
with the thing it checks will share its bugs too.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from nova_studio.ports.imaging import BorderMode, Interpolation

__all__ = ["NumPyImageOps"]


class NumPyImageOps:
    """:class:`~nova_studio.ports.imaging.ImageOps` in plain NumPy."""

    __slots__ = ()

    def resize(
        self,
        pixels: Any,
        size: tuple[int, int],
        *,
        interpolation: Interpolation = Interpolation.LINEAR,
    ) -> Any:
        """See :meth:`nova_studio.ports.imaging.ImageOps.resize`."""
        width, height = size
        source_height, source_width = pixels.shape[:2]
        if source_height == height and source_width == width:
            return pixels
        grid_y, grid_x = np.mgrid[0:height, 0:width].astype(np.float64)
        if interpolation is Interpolation.NEAREST:
            # Nearest truncates — that is the convention OpenCV uses, and it is
            # the only one worth matching, since the alternative shifts a
            # half-size proxy by half a pixel.
            map_x = grid_x * source_width / width
            map_y = grid_y * source_height / height
        else:
            # The half-pixel convention: pixel centres, not pixel corners, are
            # what line up.
            map_x = (grid_x + 0.5) * source_width / width - 0.5
            map_y = (grid_y + 0.5) * source_height / height - 0.5
        return _sample(pixels, map_x, map_y, interpolation, clamp=True)

    def warp_affine(
        self,
        pixels: Any,
        matrix: Any,
        size: tuple[int, int],
        *,
        interpolation: Interpolation = Interpolation.LINEAR,
        border: BorderMode = BorderMode.CONSTANT,
    ) -> Any:
        """See :meth:`nova_studio.ports.imaging.ImageOps.warp_affine`."""
        width, height = size
        # The port's matrix maps source to destination, so it has to be
        # inverted before it can be used to ask where each output pixel comes
        # from — which is the only direction a gather can work in.
        forward = np.asarray(matrix, dtype=np.float64)
        inverse = np.linalg.inv(np.vstack([forward, [0.0, 0.0, 1.0]]))[:2]
        grid_y, grid_x = np.mgrid[0:height, 0:width].astype(np.float64)
        map_x = inverse[0, 0] * grid_x + inverse[0, 1] * grid_y + inverse[0, 2]
        map_y = inverse[1, 0] * grid_x + inverse[1, 1] * grid_y + inverse[1, 2]
        # A warped picture clamps at the edge when it is replicated, and fades
        # when the border is constant: an output pixel whose taps are half
        # outside the source is half that source pixel, not all of it.
        return _sample(
            pixels, map_x, map_y, interpolation, border, clamp=border is not BorderMode.CONSTANT
        )

    def gaussian(self, pixels: Any, sigma: float) -> Any:
        """See :meth:`nova_studio.ports.imaging.ImageOps.gaussian`."""
        sigma = float(sigma)
        if sigma <= 0.0:
            return pixels
        radius = max(1, math.ceil(sigma * 3.0))
        axis = np.arange(-radius, radius + 1, dtype=np.float64)
        kernel = np.exp(-(axis * axis) / (2.0 * sigma * sigma))
        kernel /= kernel.sum()
        return _separable(pixels, kernel.astype(np.float32))

    def box(self, pixels: Any, size: int) -> Any:
        """See :meth:`nova_studio.ports.imaging.ImageOps.box`."""
        side = max(1, int(size))
        if side == 1:
            return pixels
        return _separable(pixels, np.full(side, 1.0 / side, dtype=np.float32))

    def convolve(self, pixels: Any, kernel: Any) -> Any:
        """See :meth:`nova_studio.ports.imaging.ImageOps.convolve`."""
        taps = np.asarray(kernel, dtype=np.float32)
        if taps.ndim != 2 or taps.size == 0:
            return pixels
        total = float(taps.sum())
        if total != 0.0:
            taps = taps / total
        height, width = pixels.shape[:2]
        taps_height, taps_width = taps.shape
        pad_y, pad_x = taps_height // 2, taps_width // 2
        padded = np.pad(pixels, ((pad_y, pad_y), (pad_x, pad_x), (0, 0)), mode="edge")
        out = np.zeros_like(pixels)
        for row in range(taps_height):
            for column in range(taps_width):
                window = padded[row : row + height, column : column + width]
                out += float(taps[row, column]) * window
        return out

    def edge_pad(self, pixels: Any, top: int, bottom: int, left: int, right: int) -> Any:
        """See :meth:`nova_studio.ports.imaging.ImageOps.edge_pad`."""
        return np.pad(pixels, ((top, bottom), (left, right), (0, 0)), mode="edge")


def _separable(pixels: Any, kernel: Any) -> Any:
    """Convolve rows, then columns, with a one-dimensional kernel."""
    radius = len(kernel) // 2
    height, width = pixels.shape[:2]
    padded = np.pad(pixels, ((radius, radius), (radius, radius), (0, 0)), mode="edge")
    rows = np.zeros_like(pixels)
    for index, weight in enumerate(kernel):
        rows += weight * padded[index : index + height, radius : radius + width]
    vertical = np.pad(rows, ((0, 0), (radius, radius), (0, 0)), mode="edge")
    out = np.zeros_like(pixels)
    for index, weight in enumerate(kernel):
        out += weight * vertical[:, index : index + width]
    return out


def _sample(
    pixels: Any,
    map_x: Any,
    map_y: Any,
    interpolation: Interpolation,
    border: BorderMode = BorderMode.CONSTANT,
    *,
    clamp: bool,
) -> Any:
    """Bilinear (or nearest) gather at continuous coordinates.

    :param clamp: whether a coordinate beyond the edge pulls in the edge pixel
        (a resize, or a replicated border) or contributes nothing at all (a
        constant border, where a pixel straddling the edge fades out).
    """
    flat = pixels if pixels.ndim == 3 else pixels[..., None]
    height, width = flat.shape[:2]
    if interpolation is Interpolation.NEAREST:
        xs = np.clip(np.floor(map_x), 0, width - 1).astype(np.int64)
        ys = np.clip(np.floor(map_y), 0, height - 1).astype(np.int64)
        out = flat[ys, xs]
        return out if pixels.ndim == 3 else out[..., 0]

    if clamp:
        # Clamp the sample point first and take the fraction from the clamped
        # point: a coordinate half a pixel off the left edge is the edge pixel,
        # not a quarter of it plus three quarters of the one beyond.
        clamped_x = np.clip(map_x, 0.0, width - 1)
        clamped_y = np.clip(map_y, 0.0, height - 1)
        floor_x = np.floor(clamped_x)
        floor_y = np.floor(clamped_y)
        fract_x = (clamped_x - floor_x)[..., None]
        fract_y = (clamped_y - floor_y)[..., None]
        x0 = floor_x.astype(np.int64)
        y0 = floor_y.astype(np.int64)
        x1 = np.minimum(x0 + 1, width - 1)
        y1 = np.minimum(y0 + 1, height - 1)
        top = flat[y0, x0] * (1.0 - fract_x) + flat[y0, x1] * fract_x
        bottom = flat[y1, x0] * (1.0 - fract_x) + flat[y1, x1] * fract_x
        out = top * (1.0 - fract_y) + bottom * fract_y
        out = out.astype(np.float32)
        return out if pixels.ndim == 3 else out[..., 0]

    floor_x = np.floor(map_x)
    floor_y = np.floor(map_y)
    fract_x = (map_x - floor_x)[..., None]
    fract_y = (map_y - floor_y)[..., None]

    def tap(columns: Any, rows: Any) -> Any:
        inside = (columns >= 0) & (columns <= width - 1) & (rows >= 0) & (rows <= height - 1)
        gathered = flat[
            np.clip(rows, 0, height - 1).astype(np.int64),
            np.clip(columns, 0, width - 1).astype(np.int64),
        ]
        return np.where(inside[..., None], gathered, 0.0)

    column_0 = floor_x
    column_1 = floor_x + 1.0
    row_0 = floor_y
    row_1 = floor_y + 1.0
    out = (
        tap(column_0, row_0) * (1.0 - fract_x) * (1.0 - fract_y)
        + tap(column_1, row_0) * fract_x * (1.0 - fract_y)
        + tap(column_0, row_1) * (1.0 - fract_x) * fract_y
        + tap(column_1, row_1) * fract_x * fract_y
    )
    out = out.astype(np.float32)
    return out if pixels.ndim == 3 else out[..., 0]
