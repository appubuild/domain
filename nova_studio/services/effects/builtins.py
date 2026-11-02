"""L3 — the effect catalogue Nova Studio ships.

These are the effects an install has before a single plugin is added, so the
app is useful offline on a fresh machine (ADR-0014) and a project that uses
only built-ins opens anywhere.  Each one is an ordinary
:class:`~nova_studio.domain.effects.EffectSpec` — the same object a plugin
publishes — so nothing downstream can tell them apart, which is the whole test
of ADR-0011.

What is *not* here is the code that applies them.  A spec is metadata: the
parameters, their ranges, their units and what a fresh instance gets.  The
arithmetic lives in the render engine (§7.2), which is also why adding an
effect here is cheap and safe — it cannot break a frame until a kernel exists
for it.

The set is deliberately small and boring.  Every effect in it is one a
colourist or a cutter reaches for daily, with ranges taken from what the
controls actually do in Resolve and Premiere rather than from what looked tidy
in a table.
"""

from __future__ import annotations

from typing import Final

from nova_studio.domain.effects import (
    EffectCategory,
    EffectCost,
    EffectSpec,
    EffectTarget,
    ParameterSpec,
    ParamKind,
)
from nova_studio.services.effects.registry import EffectRegistry

__all__ = [
    "BUILTIN_TYPES",
    "builtin_registry",
    "builtin_specs",
]

_CLIP_AND_TRACK: Final[frozenset[EffectTarget]] = frozenset({EffectTarget.CLIP, EffectTarget.TRACK})
_ANY_LAYER: Final[frozenset[EffectTarget]] = frozenset(
    {EffectTarget.CLIP, EffectTarget.TRACK, EffectTarget.OUTPUT}
)

_BLUR: Final[EffectSpec] = EffectSpec(
    type="nova.blur",
    label="Blur",
    category=EffectCategory.BLUR,
    parameters=(
        ParameterSpec(
            name="radius",
            label="Radius",
            kind=ParamKind.SCALAR,
            default=(4.0,),
            minimum=(0.0,),
            maximum=(100.0,),
            step=0.1,
            unit="px",
            hint="How far the blur reaches.",
        ),
        ParameterSpec(
            name="mode",
            label="Mode",
            kind=ParamKind.CHOICE,
            default="gaussian",
            choices=("gaussian", "box", "motion"),
            animatable=False,
            hint="Motion blur needs an angle; the others ignore it.",
        ),
        ParameterSpec(
            name="angle",
            label="Angle",
            kind=ParamKind.ANGLE,
            default=(0.0,),
            minimum=(-360.0,),
            maximum=(360.0,),
            unit="deg",
            hint="Direction of a motion blur.",
        ),
    ),
    targets=_CLIP_AND_TRACK,
    cost=EffectCost.MODERATE,
    supports_gpu=True,
)

_SHARPEN: Final[EffectSpec] = EffectSpec(
    type="nova.sharpen",
    label="Sharpen",
    category=EffectCategory.SHARPEN,
    parameters=(
        ParameterSpec(
            name="amount",
            label="Amount",
            kind=ParamKind.SCALAR,
            default=(40.0,),
            minimum=(0.0,),
            maximum=(200.0,),
            unit="%",
        ),
        ParameterSpec(
            name="radius",
            label="Radius",
            kind=ParamKind.SCALAR,
            default=(1.0,),
            minimum=(0.1,),
            maximum=(5.0,),
            step=0.1,
            unit="px",
            hint="Wide radii halate; narrow ones recover detail.",
        ),
    ),
    targets=_CLIP_AND_TRACK,
    cost=EffectCost.MODERATE,
    supports_gpu=True,
)

_SATURATION: Final[EffectSpec] = EffectSpec(
    type="nova.saturation",
    label="Saturation",
    category=EffectCategory.COLOUR,
    parameters=(
        ParameterSpec(
            name="saturation",
            label="Saturation",
            kind=ParamKind.SCALAR,
            default=(100.0,),
            minimum=(0.0,),
            maximum=(200.0,),
            unit="%",
            hint="Zero is black and white.",
        ),
    ),
    targets=_ANY_LAYER,
    cost=EffectCost.CHEAP,
    supports_gpu=True,
)

_VIGNETTE: Final[EffectSpec] = EffectSpec(
    type="nova.vignette",
    label="Vignette",
    category=EffectCategory.STYLIZE,
    parameters=(
        ParameterSpec(
            name="amount",
            label="Amount",
            kind=ParamKind.SCALAR,
            default=(30.0,),
            minimum=(0.0,),
            maximum=(100.0,),
            unit="%",
        ),
        ParameterSpec(
            name="size",
            label="Size",
            kind=ParamKind.SCALAR,
            default=(50.0,),
            minimum=(0.0,),
            maximum=(100.0,),
            unit="%",
            hint="Smaller reaches further into the frame.",
        ),
        ParameterSpec(
            name="feather",
            label="Feather",
            kind=ParamKind.SCALAR,
            default=(50.0,),
            minimum=(0.0,),
            maximum=(100.0,),
            unit="%",
        ),
    ),
    targets=_ANY_LAYER,
    cost=EffectCost.CHEAP,
    supports_gpu=True,
)

_INVERT: Final[EffectSpec] = EffectSpec(
    type="nova.invert",
    label="Invert",
    category=EffectCategory.STYLIZE,
    parameters=(
        ParameterSpec(
            name="channels",
            label="Channels",
            kind=ParamKind.CHOICE,
            default="rgb",
            choices=("rgb", "red", "green", "blue"),
            animatable=False,
        ),
    ),
    targets=_ANY_LAYER,
    cost=EffectCost.CHEAP,
    supports_gpu=True,
)

_GLOW: Final[EffectSpec] = EffectSpec(
    type="nova.glow",
    label="Glow",
    category=EffectCategory.STYLIZE,
    parameters=(
        ParameterSpec(
            name="threshold",
            label="Threshold",
            kind=ParamKind.SCALAR,
            default=(60.0,),
            minimum=(0.0,),
            maximum=(100.0,),
            unit="%",
            hint="Only pixels brighter than this bloom.",
        ),
        ParameterSpec(
            name="radius",
            label="Radius",
            kind=ParamKind.SCALAR,
            default=(20.0,),
            minimum=(0.0,),
            maximum=(100.0,),
            step=0.5,
            unit="px",
        ),
        ParameterSpec(
            name="intensity",
            label="Intensity",
            kind=ParamKind.SCALAR,
            default=(100.0,),
            minimum=(0.0,),
            maximum=(200.0,),
            unit="%",
        ),
    ),
    targets=_ANY_LAYER,
    # Multi-pass and threshold-dependent: the first version does it on the CPU,
    # and saying so is what lets preview drop it when it needs to (ADR-0012).
    cost=EffectCost.EXPENSIVE,
    supports_gpu=False,
)

_FILM_GRAIN: Final[EffectSpec] = EffectSpec(
    type="nova.film-grain",
    label="Film Grain",
    category=EffectCategory.STYLIZE,
    parameters=(
        ParameterSpec(
            name="amount",
            label="Amount",
            kind=ParamKind.SCALAR,
            default=(20.0,),
            minimum=(0.0,),
            maximum=(100.0,),
            unit="%",
        ),
        ParameterSpec(
            name="size",
            label="Grain size",
            kind=ParamKind.SCALAR,
            default=(1.0,),
            minimum=(0.5,),
            maximum=(4.0,),
            step=0.1,
            unit="px",
        ),
        ParameterSpec(
            name="monochrome",
            label="Monochrome",
            kind=ParamKind.BOOL,
            default=True,
            animatable=False,
            hint="Colour grain reads as sensor noise, not as film.",
        ),
    ),
    targets=_ANY_LAYER,
    cost=EffectCost.MODERATE,
    supports_gpu=False,
)

_CHROMATIC_ABERRATION: Final[EffectSpec] = EffectSpec(
    type="nova.chromatic-aberration",
    label="Chromatic Aberration",
    category=EffectCategory.STYLIZE,
    parameters=(
        ParameterSpec(
            name="amount",
            label="Amount",
            kind=ParamKind.SCALAR,
            default=(2.0,),
            minimum=(0.0,),
            maximum=(20.0,),
            step=0.1,
            unit="px",
            hint="How far the red and blue channels separate.",
        ),
    ),
    targets=_ANY_LAYER,
    cost=EffectCost.MODERATE,
    supports_gpu=True,
)

_SOLID: Final[EffectSpec] = EffectSpec(
    type="nova.solid",
    label="Solid Colour",
    category=EffectCategory.GENERATOR,
    parameters=(
        ParameterSpec(
            name="colour",
            label="Colour",
            kind=ParamKind.COLOUR,
            default=(0.0, 0.0, 0.0),
            minimum=(0.0, 0.0, 0.0),
            maximum=(1.0, 1.0, 1.0),
        ),
    ),
    targets=frozenset({EffectTarget.CLIP}),
    cost=EffectCost.CHEAP,
    supports_gpu=True,
    # Makes a picture from nothing, so the renderer may skip reading a frame.
    is_generator=True,
)

_SPECS: Final[tuple[EffectSpec, ...]] = (
    _BLUR,
    _SHARPEN,
    _SATURATION,
    _VIGNETTE,
    _INVERT,
    _GLOW,
    _FILM_GRAIN,
    _CHROMATIC_ABERRATION,
    _SOLID,
)

#: The types a fresh install can always resolve.
BUILTIN_TYPES: Final[frozenset[str]] = frozenset(spec.type for spec in _SPECS)


def builtin_specs() -> tuple[EffectSpec, ...]:
    """The specs every install ships.

    Shared rather than copied, because a spec is a frozen value: no caller can
    alter one, and a registry built from this never mutates the tuple it was
    handed.
    """
    return _SPECS


def builtin_registry() -> EffectRegistry:
    """A registry holding nothing but the built-ins.

    The starting point at startup: plugins register themselves onto this, and
    the result is what the rest of the app is given.
    """
    return EffectRegistry(specs=builtin_specs())
