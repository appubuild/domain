"""L4 — the project settings DTOs: what the project renders to.

Three decisions shape this module, and each is the answer to a way this
usually goes wrong:

1. **A change is a patch, not a replacement.** Every field of
   `SettingsPatchRequest` is optional, and `null` means "leave this one alone"
   rather than "set it to nothing" — a settings object is not nullable and a
   client that omitted a field means no comment on it. A panel that had to post
   the whole object would be racing every other panel holding one, and the loser
   of that race would quietly restore a value the user had just changed
   somewhere else.
2. **The answer carries the settings *and* the history.** After a change the
   client knows what the settings are now and whether Ctrl+Z does anything,
   because the alternative — a second request to find out — is a race a fast
   typist can lose. Same rule as the timeline's, for the same reason.
3. **Two facts are derived, not stored.** `aspect_ratio` and `even_dimensions`
   are computed from the frame size in the mapper. Both are things a user needs
   to know *before* they commit to a frame: an odd dimension is a 4:2:0 export
   that will fail later, and an aspect ratio is the one number that decides
   whether every title in the project still fits.

Nothing here decides whether a setting is allowed — that is
`SetSettingsCommand`, and it refuses with `NS-COMMAND-4104`, which the transport
serves as a 409.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

# Imported for real, not for typing: pydantic resolves a field's annotation
# from this module's namespace at class-creation time, and a name that exists
# only under `TYPE_CHECKING` is an unresolvable forward reference.
from nova_studio.api.schemas.timeline import HistorySummary  # noqa: TC001

__all__ = [
    "FrameSizeSpec",
    "FrameSizeSummary",
    "SettingsCommandResponse",
    "SettingsPatchRequest",
    "SettingsRedoResponse",
    "SettingsResponse",
    "SettingsSummary",
    "SettingsUndoResponse",
]


class _Strict(BaseModel):
    """The base every settings DTO gets: strict, frozen, self-documenting."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


class FrameSizeSummary(_Strict):
    """The frame the compositor builds, in pixels."""

    width: int = Field(description="Width in pixels.")
    height: int = Field(description="Height in pixels.")


class SettingsSummary(_Strict):
    """What the whole project renders and mixes to, as the panel shows it."""

    frame_size: FrameSizeSummary = Field(
        description="The frame the compositor builds; the preview is this at a smaller scale."
    )
    aspect_ratio: float = Field(
        description="Width over height: 1.777… for 16:9, 0.5625 for a vertical 9:16."
    )
    even_dimensions: bool = Field(
        description=(
            "Whether both dimensions are even. Every 4:2:0 encoder we ship "
            "requires it, so false means export will fail until it is fixed."
        )
    )
    sample_rate: int = Field(description="Audio sample rate in Hz, e.g. 48000.")
    channels: int = Field(description="Audio channel count: 1, 2, 6 or 8.")
    use_proxies: bool = Field(
        description=(
            "Whether the preview decodes from a proxy when one exists. Export "
            "ignores this: a render is a render."
        )
    )
    working_colour_space: int = Field(
        description=(
            "The colour space the compositor works in before the output "
            "transform, as the matrix coefficient signalled in the container "
            "(1 = BT.709, 6 = SMPTE 170M, 9 = BT.2020 non-constant luminance)."
        )
    )


class SettingsResponse(_Strict):
    """The settings as they stand, with the history that got them there."""

    project_id: str = Field(description="Which project these settings belong to.")
    settings: SettingsSummary = Field(description="The settings as they stand.")
    history: HistorySummary = Field(
        description="The settings stack: what Ctrl+Z and Ctrl+Shift+Z would do."
    )
    journal_sequence: int = Field(description="Newest journalled sequence.")
    pending_commands: int = Field(description="Commands recorded since the last checkpoint.")
    dirty: bool = Field(description="Whether the project differs from what is on disk.")


class SettingsCommandResponse(SettingsResponse):
    """What one settings change did, for a client that does not want to refetch."""

    command_id: str = Field(description="The command that ran, e.g. `project.set-settings`.")
    name: str = Field(description="Its wire name, which is also the name the journal recorded.")
    summary: str = Field(description="What it did, as one sentence for a status bar.")
    affected: list[str] = Field(description="Namespaces the command touched.")
    invalidate: list[str] = Field(
        description="Caches the command invalidated: `settings`, `preview`, `export`."
    )
    rerender: bool = Field(description="Whether the preview must redraw.")
    marks_dirty: bool = Field(description="Whether this change made the project unsaved.")


class SettingsUndoResponse(SettingsResponse):
    """What Ctrl+Z did to the settings; `undone: false` when the stack was empty."""

    undone: bool = Field(description="Whether anything was undone.")
    command_id: str = Field(description="The command that was reverted, or empty.")
    name: str = Field(description="Its wire name, or empty.")


class SettingsRedoResponse(SettingsResponse):
    """What Ctrl+Shift+Z did to the settings; `redone: false` when there was none."""

    redone: bool = Field(description="Whether anything was redone.")
    command_id: str = Field(description="The command that was re-applied, or empty.")
    name: str = Field(description="Its wire name, or empty.")


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


class FrameSizeSpec(_Strict):
    """A frame size to set.

    Odd dimensions are accepted: they are legal today and only fail at export
    for 4:2:0, which is a thing to warn a user about in the panel rather than
    refuse behind their back.
    """

    width: Annotated[int, Field(ge=1, le=16384, description="Width in pixels.")]
    height: Annotated[int, Field(ge=1, le=16384, description="Height in pixels.")]


class SettingsPatchRequest(_Strict):
    """Change one or more settings. Every field is optional; omit one to leave it.

    Posted as a *patch* rather than a whole replacement: two panels can hold
    two different settings open at once, and neither of them knows the other's
    current values.
    """

    #: The wire name, which is also the name the journal records — so a
    #: crash-recovery replay rebuilds this change from the same vocabulary the
    #: frontend used to ask for it, with no second table of names to drift.
    type: Literal["set-settings"] = Field(
        default="set-settings",
        description="Discriminator: which command this is. It is also the name the journal records.",
    )
    frame_size: FrameSizeSpec | None = Field(
        default=None, description="The frame the compositor builds."
    )
    sample_rate: Annotated[
        int | None, Field(ge=1, le=384_000, description="Audio sample rate in Hz.")
    ] = None
    channels: Annotated[int | None, Field(ge=1, le=8, description="Audio channel count.")] = None
    use_proxies: bool | None = Field(
        default=None, description="Whether the preview may decode from a proxy."
    )
    working_colour_space: Annotated[
        int | None,
        Field(
            ge=0,
            le=17,
            description=(
                "Matrix coefficient for the compositor's working space: "
                "1 = BT.709, 6 = SMPTE 170M, 9 = BT.2020 non-constant luminance."
            ),
        ),
    ] = None
