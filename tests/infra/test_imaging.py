"""The imaging port, and the OpenCV adapter that implements it
(`infra/imaging.py`).

The port exists so that `services` never names OpenCV. A seam like that is only
worth its indirection if it is checked from both sides, so this module does two
different jobs:

**The adapter is measured against an independent implementation.**
`tests/media/numpy_imaging.py` is a second `ImageOps` written in plain NumPy —
no OpenCV, no fixed-point tricks, explicit loops. Wherever the two agree, the
OpenCV adapter is not quietly doing something else; where they disagree by more
than rounding, one of them is wrong. Comparing an implementation against itself
would prove nothing.

**The contract is pinned where OpenCV does not promise it.** Two adapters may
differ in the last bit, and that is allowed — the port says so, and these tests
compare with a tolerance for exactly that reason. But the *contract* is not
negotiable and is asserted without one: float32 in means float32 out, a
one-channel mask and a four-channel layer both work, a blur replicates its edge
rather than drawing a rim, a warp leaves outside transparent, and the same call
twice gives the same bytes. Those are the properties the renderer relies on and
that a future GPU adapter must reproduce.

Tolerances are in 0..1 pixel units and are deliberately loose: OpenCV computes
with fixed-point weights in places, so agreement to a few thousandths is the
realistic expectation, and a test that fails on the sixth decimal would fail
again on the next OpenCV release without anything having broken.
"""

from __future__ import annotations

import numpy as np
import pytest

from nova_studio.infra.imaging import OpenCVImageOps
from nova_studio.ports.imaging import BorderMode, ImageOps, Interpolation
from tests.media.numpy_imaging import NumPyImageOps

pytestmark = pytest.mark.unit

OPS = OpenCVImageOps()
REFERENCE = NumPyImageOps()

#: Agreement between two implementations, in pixel units (0..1).
CLOSE = 0.02


def _field(value: float, shape: tuple[int, ...] = (16, 24, 3)) -> np.ndarray:
    """A flat float32 picture."""
    return np.full(shape, value, dtype=np.float32)


def _ramp(width: int = 24, height: int = 16) -> np.ndarray:
    """A picture with something to lose: a horizontal ramp, in float32."""
    ramp = np.linspace(0.0, 1.0, width, dtype=np.float32).reshape(1, width, 1)
    return np.broadcast_to(ramp, (height, width, 3)).copy()


def _step(width: int = 24, height: int = 16) -> np.ndarray:
    """Half black, half white: the worst case for any resampling filter."""
    pixels = np.zeros((height, width, 3), dtype=np.float32)
    pixels[:, width // 2 :] = 1.0
    return pixels


def _rotation(degrees: float, size: tuple[int, int]) -> np.ndarray:
    """A rotation about the centre, as a 2x3 matrix — the caller's job."""
    width, height = size
    angle = np.radians(degrees)
    cosine, sine = np.cos(angle), np.sin(angle)
    centre_x, centre_y = width / 2 - 0.5, height / 2 - 0.5
    return np.array(
        [
            [cosine, sine, (1.0 - cosine) * centre_x - sine * centre_y],
            [-sine, cosine, sine * centre_x + (1.0 - cosine) * centre_y],
        ],
        dtype=np.float64,
    )


class TestThePortIsReal:
    """`services` may name the protocol; only `infra` may name the library."""

    def test_the_adapter_satisfies_the_protocol(self) -> None:
        assert isinstance(OpenCVImageOps(), ImageOps)

    def test_the_reference_satisfies_the_protocol(self) -> None:
        """The second implementation is the reason the port is allowed to exist."""
        assert isinstance(REFERENCE, ImageOps)

    def test_two_implementations_agree_on_a_resize(self) -> None:
        pixels = _ramp()
        assert np.allclose(
            OPS.resize(pixels, (48, 32)), REFERENCE.resize(pixels, (48, 32)), atol=CLOSE
        )

    def test_two_implementations_agree_on_a_warp(self) -> None:
        pixels = _ramp()
        matrix = _rotation(30.0, (24, 16))
        assert np.allclose(
            OPS.warp_affine(pixels, matrix, (24, 16)),
            REFERENCE.warp_affine(pixels, matrix, (24, 16)),
            atol=CLOSE,
        )

    def test_two_implementations_agree_on_a_gaussian(self) -> None:
        pixels = _step()
        assert np.allclose(OPS.gaussian(pixels, 3.0), REFERENCE.gaussian(pixels, 3.0), atol=CLOSE)

    def test_two_implementations_agree_on_a_box(self) -> None:
        pixels = _step()
        assert np.allclose(OPS.box(pixels, 5), REFERENCE.box(pixels, 5), atol=CLOSE)

    def test_two_implementations_agree_on_a_convolution(self) -> None:
        pixels = _step()
        kernel = np.outer(np.ones(5, np.float32), np.array([0.0, 0.5, 1.0, 0.5, 0.0], np.float32))
        assert np.allclose(
            OPS.convolve(pixels, kernel), REFERENCE.convolve(pixels, kernel), atol=CLOSE
        )


class TestResize:
    def test_the_size_asked_for_is_the_size_returned(self) -> None:
        assert OPS.resize(_ramp(), (13, 7)).shape == (7, 13, 3)

    def test_the_working_space_is_not_promoted(self) -> None:
        """float32 in, float32 out: the renderer's working space is a contract."""
        assert OPS.resize(_ramp(), (48, 32)).dtype == np.float32

    def test_nearest_invents_no_values(self) -> None:
        """A mask must survive a resize: blurring a mask is erasing it."""
        checker = np.zeros((2, 2, 1), dtype=np.float32)
        checker[0, 0] = checker[1, 1] = 1.0
        out = OPS.resize(checker, (4, 4), interpolation=Interpolation.NEAREST)
        assert set(np.unique(out).tolist()) <= {0.0, 1.0}

    def test_nearest_doubles_by_repeating(self) -> None:
        """Every output pixel is some input pixel, and each one is used
        proportionally — the property a proxy depends on."""
        strip = np.arange(4, dtype=np.float32).reshape(1, 4, 1)
        out = OPS.resize(strip, (8, 1), interpolation=Interpolation.NEAREST)
        assert out.reshape(-1).tolist() == [0.0, 0.0, 1.0, 1.0, 2.0, 2.0, 3.0, 3.0]

    def test_a_flat_field_stays_flat(self) -> None:
        """Resampling may not brighten or darken a picture; it only moves pixels."""
        out = OPS.resize(_field(0.5), (48, 32))
        assert np.allclose(out, 0.5, atol=1e-6)

    def test_asking_for_the_size_it_already_has_costs_nothing(self) -> None:
        pixels = _ramp()
        assert OPS.resize(pixels, (24, 16)) is pixels


class TestWarpAffine:
    def test_the_size_asked_for_is_the_size_returned(self) -> None:
        matrix = _rotation(10.0, (24, 16))
        assert OPS.warp_affine(_ramp(), matrix, (32, 20)).shape == (20, 32, 3)

    def test_what_falls_outside_the_frame_is_transparent(self) -> None:
        """A clip dragged half off the frame has nothing to smear in."""
        pixels = _field(1.0, (16, 24, 4))
        matrix = np.array([[1.0, 0.0, 8.0], [0.0, 1.0, 0.0]], dtype=np.float64)
        out = OPS.warp_affine(pixels, matrix, (24, 16), border=BorderMode.CONSTANT)
        # The layer has moved eight pixels to the right, so the left edge of the
        # frame is now empty — transparently empty, not black.
        assert out[8, 0, 3] == 0.0
        assert out[8, 23, 3] == 1.0

    def test_a_rotation_keeps_the_centre(self) -> None:
        """The fixed point of a rotation about the centre is the centre."""
        pixels = _ramp()
        out = OPS.warp_affine(pixels, _rotation(37.0, (24, 16)), (24, 16))
        assert np.allclose(out[8, 12], pixels[8, 12], atol=CLOSE)

    def test_four_channels_are_warped_as_four_channels(self) -> None:
        """The compositor warps RGBA; an adapter that assumed three would halve it."""
        pixels = _field(0.5, (16, 24, 4))
        out = OPS.warp_affine(pixels, _rotation(20.0, (24, 16)), (24, 16))
        assert out.shape == (16, 24, 4)


class TestBlur:
    def test_the_edge_is_replicated_not_filled_with_black(self) -> None:
        """A dark rim around a blurred frame is an artefact, not a picture."""
        out = OPS.gaussian(_field(1.0), 4.0)
        assert np.allclose(out, 1.0, atol=1e-6)

    def test_a_box_blur_averages(self) -> None:
        pixels = _step()
        out = OPS.box(pixels, 9)
        # The step is at column 12, so a box of nine there holds four black
        # columns and five white ones.
        assert out[8, 12, 0] == pytest.approx(5 / 9, abs=CLOSE)

    def test_a_gaussian_softens_the_step_without_moving_it(self) -> None:
        """A symmetric blur of a step is antisymmetric about the step: the edge
        softens on both sides and stays where it was."""
        pixels = _step()
        out = OPS.gaussian(pixels, 3.0)
        assert out[8, 12, 0] < 1.0 and out[8, 11, 0] > 0.0
        assert out[8, 12, 0] + out[8, 11, 0] == pytest.approx(1.0, abs=CLOSE)

    def test_a_sigma_of_zero_is_no_blur(self) -> None:
        pixels = _step()
        assert OPS.gaussian(pixels, 0.0) is pixels

    def test_a_box_of_one_is_no_blur(self) -> None:
        pixels = _step()
        assert OPS.box(pixels, 1) is pixels

    def test_blur_never_changes_the_overall_brightness(self) -> None:
        """A normalised kernel conserves energy; an unnormalised one is a fader."""
        pixels = _step()
        assert float(OPS.gaussian(pixels, 3.0).mean()) == pytest.approx(
            float(pixels.mean()), abs=CLOSE
        )


class TestConvolve:
    def test_a_kernel_that_does_not_sum_to_one_is_normalised(self) -> None:
        """A hand-built kernel must not become a brightness change."""
        out = OPS.convolve(_field(0.5), np.full((3, 3), 2.0, dtype=np.float32))
        assert np.allclose(out, 0.5, atol=1e-6)

    def test_an_empty_kernel_is_refused_not_fatal(self) -> None:
        pixels = _ramp()
        assert OPS.convolve(pixels, np.zeros((0, 0), np.float32)) is pixels

    def test_a_line_kernel_smears_along_the_line(self) -> None:
        """Motion blur is a rotated row; the smear must follow the row."""
        pixels = np.zeros((16, 24, 3), dtype=np.float32)
        pixels[8, 12] = 1.0
        kernel = np.zeros((9, 9), dtype=np.float32)
        kernel[4, :] = 1.0
        out = OPS.convolve(pixels, kernel)
        assert out[8, 10, 0] > 0.0  # smeared sideways
        assert out[6, 12, 0] == 0.0  # and not upwards


class TestEdgePad:
    def test_the_picture_grows_by_the_amount_asked_for(self) -> None:
        out = OPS.edge_pad(_ramp(), 2, 3, 4, 5)
        assert out.shape == (21, 33, 3)

    def test_the_new_pixels_are_the_ones_next_to_them(self) -> None:
        pixels = _ramp()
        out = OPS.edge_pad(pixels, 2, 0, 0, 0)
        assert np.allclose(out[0], pixels[0], atol=1e-6)

    def test_padding_by_nothing_changes_nothing(self) -> None:
        pixels = _ramp()
        assert np.array_equal(OPS.edge_pad(pixels, 0, 0, 0, 0), pixels)


class TestDeterminism:
    """ADR-0002 rule 1: a render must be reproducible frame for frame."""

    def test_the_same_call_twice_gives_the_same_bytes(self) -> None:
        pixels = _ramp()
        first = OPS.gaussian(pixels, 2.0)
        second = OPS.gaussian(pixels, 2.0)
        assert np.array_equal(first, second)

    def test_a_mask_is_treated_as_one_channel_not_three(self) -> None:
        mask = np.zeros((16, 24, 1), dtype=np.float32)
        mask[8, 12] = 1.0
        out = OPS.gaussian(mask, 2.0)
        assert out.shape == (16, 24, 1)
        assert out[8, 12, 0] < 1.0  # it blurred
        assert out[8, 12, 0] > 0.0
