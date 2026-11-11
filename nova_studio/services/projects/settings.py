"""L3 — what the project renders to, as an editable thing.

`ProjectSettings` is one frozen value on the project: the frame the compositor
builds, the rate audio is mixed at, whether the preview may decode a proxy, and
the colour space the grades are applied in. Everything about it says "set once
and live with it" — which is exactly why changing it has to be an **edit** and
not a PATCH that reaches into the project:

* **It is undoable.** A user who drops a 4K project to 1080p to see whether the
  titles still read has to be able to come back. Undo is the command stack's
  business and nothing else's.
* **It is journalled.** A crash between the change and the next save must not
  lose it, which is the same guarantee every other edit has (ADR-0015 rule 6).
* **It is a command, so it is validated in one place.** `ProjectSettings`
  refuses a sample rate of zero and a frame of 0 × 0 by raising; a router that
  built one from a request body would be turning an invariant into a 500.

**Why its own editor.** ADR-0008 rule 4: a caption or colour command belongs to
its own editor with its own undo stack, which is why undoing a cut does not
disturb the caption style made afterwards. Settings are the same shape — a
change to them is not a change to the edit, and putting them on the timeline's
stack would mean Ctrl+Z after a settings change undoes a cut the user made ten
minutes ago. So: one store, one history, and `UndoScope.PROJECT`, added to
`core/commands.py` for exactly this. `GLOBAL` stays what it always was — the
fallback for a command that genuinely has no home — rather than becoming a
drawer everything is tidied into.

**The command is a patch, not a replacement.** Only the fields the caller names
change. A panel that posted the whole settings object would be racing every
other panel that has one open, and the loser of that race would silently
restore a value the user had just changed somewhere else.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from nova_studio.core.commands import (
    Command,
    CommandContext,
    CommandError,
    CommandHistory,
    CommandOutcome,
    UndoScope,
)
from nova_studio.core.result import Result, failed, ok
from nova_studio.domain.media import ColourSpace
from nova_studio.domain.project import (
    SUPPORTED_CHANNEL_COUNTS,
    FrameSize,
    ProjectSettings,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from nova_studio.core.commands import CommandScopeState
    from nova_studio.core.events import EventBus

__all__ = [
    "SetSettingsCommand",
    "SettingsEditor",
    "SettingsStore",
    "settings_store",
]

#: What a settings change invalidates. Every decoded picture was composited at
#: the old frame size, and every proxy decision was made against the old one —
#: so the preview is dropped and the export presets are re-derived.
_SETTINGS_INVALIDATED: frozenset[str] = frozenset({"settings", "preview", "export"})


@dataclass(slots=True)
class SettingsStore:
    """The settings being edited: one mutable holder for one frozen value.

    The same shape as `services.timeline.store.TimelineStore`, for the same
    reason: a command has to change *something*, and a holder for one frozen
    value is the smallest thing that is not a god object.
    """

    settings: ProjectSettings

    def current(self) -> ProjectSettings:
        """The settings as they stand."""
        return self.settings

    def replace(self, settings: ProjectSettings) -> ProjectSettings:
        """Swap in new settings and return the ones they displaced.

        Returning the previous value is what lets a caller hold the state it
        needs for a rollback without fetching it twice.
        """
        previous = self.settings
        self.settings = settings
        return previous

    def reset(self, settings: ProjectSettings) -> None:
        """Start editing different settings (a project open, or a revert)."""
        self.settings = settings


def settings_store(ctx: CommandContext) -> SettingsStore | None:
    """The store on ``ctx``, or ``None`` when the context is not a settings one.

    ``None`` rather than a raised error: "this context cannot change settings"
    is an answer a command reports as `NS-COMMAND-4101`, not an
    ``AttributeError`` three layers down.
    """
    store: Any = ctx.services
    return store if isinstance(store, SettingsStore) else None


@dataclass
class SetSettingsCommand(Command):
    """Change the project's render target, reversibly.

    A **patch**: ``None`` means "leave this one alone", so two panels can change
    two settings without either of them knowing the other's values. The undo
    delta is the settings as they were before the first execution — one frozen
    value, which is all a settings change can possibly need.
    """

    frame_size: FrameSize | None = None
    sample_rate: int | None = None
    channels: int | None = None
    use_proxies: bool | None = None
    working_colour_space: ColourSpace | None = None
    #: Captured on first execution. ``None`` until the command has run.
    before: ProjectSettings | None = None

    command_id = "project.set-settings"
    display_name = "command.project.set_settings"
    # The project itself, not the edit: undoing "render to 1080p" must not be
    # the same Ctrl+Z as undoing the cut the user made ten minutes ago.
    scope = UndoScope.PROJECT
    # Not coalescible: a settings change is a decision, and two of them made
    # inside a second are two decisions, not one gesture.
    coalescible = False

    def __post_init__(self) -> None:
        super().__init__()

    # -- what it would do ---------------------------------------------------

    def changed_fields(self) -> tuple[str, ...]:
        """Which fields this command names, in the order the summary prints them."""
        named: list[str] = []
        if self.frame_size is not None:
            named.append("frame_size")
        if self.sample_rate is not None:
            named.append("sample_rate")
        if self.channels is not None:
            named.append("channels")
        if self.use_proxies is not None:
            named.append("use_proxies")
        if self.working_colour_space is not None:
            named.append("working_colour_space")
        return tuple(named)

    def _check(self) -> Result[None]:
        """Refuse a value `ProjectSettings` would refuse, with a sentence.

        **Checked here rather than caught from the constructor.** `ProjectSettings`
        raises a `NovaInvariantError` for a sample rate of zero and a channel
        count we do not mix, and an invariant error means "this is a bug or a
        corrupt document" — which a person typing `0` into an audio box is
        neither. A value the user can type is a precondition, and a refusal the
        panel can print is worth more than a stack trace in a log.

        **The frame size is not checked here**, because `FrameSize` refuses its
        own impossible dimensions and a command that re-checked them would be a
        second place the same rule lives. What is left is what a `FrameSize`
        cannot know: what we mix, and which colour spaces this build has.
        """
        if self.sample_rate is not None and self.sample_rate <= 0:
            return failed(
                CommandError.precondition(
                    self.command_id,
                    f"a sample rate must be positive, got {self.sample_rate}",
                )
            )
        if self.channels is not None and self.channels not in SUPPORTED_CHANNEL_COUNTS:
            supported = ", ".join(str(count) for count in sorted(SUPPORTED_CHANNEL_COUNTS))
            return failed(
                CommandError.precondition(
                    self.command_id,
                    f"we mix {supported} channels, not {self.channels}",
                )
            )
        if self.working_colour_space is not None:
            try:
                ColourSpace(int(self.working_colour_space))
            except ValueError:
                return failed(
                    CommandError.precondition(
                        self.command_id,
                        f"colour space {int(self.working_colour_space)} is not one this "
                        "build knows",
                    )
                )
        return ok(None)

    def _candidate(self, current: ProjectSettings) -> Result[ProjectSettings]:
        """The settings this command asks for, or a refusal.

        Built here rather than in `validate` alone because `execute` needs the
        same value, and two constructions is two places for an invariant to be
        checked differently.
        """
        checked = self._check()
        if checked.is_err():
            return failed(checked.unwrap_err())
        return ok(
            ProjectSettings(
                frame_size=self.frame_size if self.frame_size is not None else current.frame_size,
                sample_rate=(
                    self.sample_rate if self.sample_rate is not None else current.sample_rate
                ),
                channels=self.channels if self.channels is not None else current.channels,
                use_proxies=(
                    self.use_proxies if self.use_proxies is not None else current.use_proxies
                ),
                working_colour_space=(
                    self.working_colour_space
                    if self.working_colour_space is not None
                    else current.working_colour_space
                ),
            )
        )

    # -- the edit -----------------------------------------------------------

    def validate(self, ctx: CommandContext) -> Result[None]:
        store = settings_store(ctx)
        if store is None:
            return failed(
                CommandError.precondition(self.command_id, "there are no settings to change")
            )
        if not self.changed_fields():
            return failed(
                CommandError.precondition(
                    self.command_id, "a settings change must name at least one setting"
                )
            )
        candidate = self._candidate(store.current())
        if candidate.is_err():
            return failed(candidate.unwrap_err())
        return ok(None)

    def execute(self, ctx: CommandContext) -> Result[CommandOutcome]:
        store = settings_store(ctx)
        if store is None:
            return failed(
                CommandError.execution_failed(
                    self.command_id, "the command context carries no settings store"
                )
            )
        candidate = self._candidate(store.current())
        if candidate.is_err():
            return failed(candidate.unwrap_err())
        wanted = candidate.unwrap()
        current = store.current()
        if self.before is None:
            self.before = current
        store.replace(wanted)

        if wanted == current:
            # Asked for what is already there. Recorded, because the user did
            # ask — but it cannot dirty a project or throw away every decoded
            # picture, and saying "already so" is more honest than pretending
            # something happened.
            return ok(
                CommandOutcome(
                    affected=frozenset({"settings"}),
                    invalidate=frozenset(),
                    rerender=False,
                    marks_dirty=False,
                    summary="the settings were already so",
                )
            )

        return ok(
            CommandOutcome(
                affected=frozenset({"settings"}),
                invalidate=_SETTINGS_INVALIDATED,
                rerender=True,
                marks_dirty=True,
                summary=self._summary(current, wanted),
                # Carried so a client can paint the panel from the answer rather
                # than refetching the settings it has just changed.
                payload={"settings": wanted.to_wire()},
            )
        )

    def undo(self, ctx: CommandContext) -> Result[None]:
        store = settings_store(ctx)
        if store is None or self.before is None:
            return failed(CommandError.not_executed(self.command_id))
        store.replace(self.before)
        return ok(None)

    # -- the journal --------------------------------------------------------

    def payload(self) -> dict[str, Any]:
        """What a replay needs to rebuild this change, and nothing else.

        The patch, not the result: a journal that recorded the outcome would
        replay a settings object rather than a decision, and a replay that ran
        after the project had moved on would overwrite whatever is there now.
        """
        wire: dict[str, Any] = {}
        if self.frame_size is not None:
            wire["frame_size"] = self.frame_size.to_wire()
        if self.sample_rate is not None:
            wire["sample_rate"] = self.sample_rate
        if self.channels is not None:
            wire["channels"] = self.channels
        if self.use_proxies is not None:
            wire["use_proxies"] = self.use_proxies
        if self.working_colour_space is not None:
            wire["working_colour_space"] = int(self.working_colour_space)
        return wire

    def _summary(self, before: ProjectSettings, after: ProjectSettings) -> str:
        """What this change did, as one sentence for a status bar."""
        parts: list[str] = []
        if before.frame_size != after.frame_size:
            parts.append(
                f"frame size {after.frame_size.width}×{after.frame_size.height}"
                f" (was {before.frame_size.width}×{before.frame_size.height})"
            )
        if before.sample_rate != after.sample_rate:
            parts.append(f"sample rate {after.sample_rate} Hz (was {before.sample_rate} Hz)")
        if before.channels != after.channels:
            parts.append(f"{after.channels} channels (was {before.channels})")
        if before.use_proxies != after.use_proxies:
            parts.append("proxies " + ("on" if after.use_proxies else "off"))
        if before.working_colour_space != after.working_colour_space:
            parts.append(
                f"working colour space {after.working_colour_space.name}"
                f" (was {before.working_colour_space.name})"
            )
        return "changed " + ", ".join(parts) if parts else "changed no setting"


@dataclass(slots=True)
class SettingsEditor:
    """Executes settings commands against one store, with one undo stack.

    The pair of `SettingsStore` and `CommandHistory`, in the one place that owns
    both — the same reasoning as `services.timeline.editor.TimelineEditor`: a
    history is meaningless without the state it edits, and two call sites that
    each needed both would invent the pairing differently.
    """

    store: SettingsStore
    project_id: str = ""
    bus: EventBus | None = None
    clock: Callable[[], float] = time.monotonic
    #: Built in `__post_init__` rather than defaulted, for the reason the
    #: workspace gives when it builds the timeline editor's: a default
    #: `CommandHistory` carries no bus, so `command.executed` would never be
    #: published and every listener would have to poll for it.
    history: CommandHistory = field(init=False)

    def __post_init__(self) -> None:
        self.history = CommandHistory(bus=self.bus, clock=self.clock)

    # -- reading -----------------------------------------------------------

    def context(self) -> CommandContext:
        """The context a settings command runs in."""
        return CommandContext(
            services=self.store,
            project_id=self.project_id,
            clock=self.clock,
            bus=self.bus,
            scope_id=UndoScope.PROJECT.value,
        )

    def state(self) -> CommandScopeState:
        """What an Undo control needs: can undo, can redo, and their labels."""
        return self.history.state(UndoScope.PROJECT)

    @property
    def can_undo(self) -> bool:
        """Whether there is a settings change to undo."""
        return self.state().can_undo

    @property
    def can_redo(self) -> bool:
        """Whether there is a settings change to redo."""
        return self.state().can_redo

    def recent(self, limit: int = 50) -> list[str]:
        """The most recent settings changes, newest last."""
        return self.history.stack_for(UndoScope.PROJECT).history(limit=limit)

    # -- writing -----------------------------------------------------------

    def execute(
        self, command: Command, ctx: CommandContext | None = None
    ) -> Result[CommandOutcome]:
        """Validate, run and record one command.

        The history records a command only when it succeeds, so a refused change
        costs the user nothing — not even their redo future.
        """
        return self.history.execute(command, ctx or self.context())

    def undo(self, ctx: CommandContext | None = None) -> Result[Command | None]:
        """Undo the last settings change. `None` when the stack is empty."""
        return self.history.undo(UndoScope.PROJECT, ctx if ctx is not None else self.context())

    def redo(self, ctx: CommandContext | None = None) -> Result[Command | None]:
        """Redo the last undone settings change. `None` when there is none."""
        return self.history.redo(UndoScope.PROJECT, ctx if ctx is not None else self.context())
