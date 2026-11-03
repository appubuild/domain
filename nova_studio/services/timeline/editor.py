"""L3 — the timeline editor: the one door every edit goes through.

ADR-0008 rule 1 says services expose ``execute(command)`` rather than mutators.
This is that door for the timeline.  It is deliberately thin: it owns the store
and the history, builds the command context, and answers the questions the Edit
menu and the history panel ask.  It does not know what any command does, does
not validate edits and does not touch a project file — which is why there is
nothing here that can get out of step with the commands.

Why it exists at all, given ``core.commands.CommandHistory`` already does the
stack work: a history is meaningless without the state it edits, and pairing the
two is a real decision.  Two call sites that both need a store and a history
would each invent the pairing slightly differently — one would forget to build a
context, the other would reach into ``_stacks``.  One class, one pairing.

Scope is pinned to :attr:`UndoScope.TIMELINE` throughout: this editor edits a
timeline, and a caption or colour command belongs to its own editor with its own
stack (ADR-0008 rule 4) — which is exactly why undoing a cut does not disturb
the caption style change made afterwards.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from nova_studio.core.commands import (
    Command,
    CommandContext,
    CommandHistory,
    CommandOutcome,
    UndoScope,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from nova_studio.core.commands import CommandScopeState
    from nova_studio.core.events import EventBus
    from nova_studio.core.result import Result
    from nova_studio.services.timeline.store import TimelineStore

__all__ = ["TimelineEditor"]


@dataclass(slots=True)
class TimelineEditor:
    """Executes timeline commands against one store, with one undo stack."""

    store: TimelineStore
    #: Injectable so a test can drive a frozen clock, and so a project can share
    #: one history with the autosave journal that replays it.
    history: CommandHistory = field(default_factory=CommandHistory)
    #: Which project this editor belongs to, for events and telemetry.
    project_id: str = ""
    #: Where ``command.executed`` and friends are published.
    bus: EventBus | None = None
    #: Monotonic clock; shared with the context so coalescing windows and
    #: execution timings agree with each other.
    clock: Callable[[], float] = time.monotonic

    # -- reading -----------------------------------------------------------

    def context(self) -> CommandContext:
        """The context a command runs in.

        ``services`` is the store, which is how a command finds the timeline it
        is meant to change.
        """
        return CommandContext(
            services=self.store,
            project_id=self.project_id,
            clock=self.clock,
            bus=self.bus,
            scope_id=UndoScope.TIMELINE.value,
        )

    def state(self) -> CommandScopeState:
        """What the Edit menu needs: can undo, can redo, and their labels."""
        return self.history.state(UndoScope.TIMELINE)

    @property
    def can_undo(self) -> bool:
        """Whether there is an edit to undo."""
        return self.state().can_undo

    @property
    def can_redo(self) -> bool:
        """Whether there is an edit to redo."""
        return self.state().can_redo

    @property
    def undo_label(self) -> str:
        """What undoing would do, as a localisable key."""
        return self.state().undo_label

    @property
    def redo_label(self) -> str:
        """What redoing would do, as a localisable key."""
        return self.state().redo_label

    @property
    def depth(self) -> tuple[int, int]:
        """``(undo_depth, redo_depth)``, for the history panel."""
        snapshot = self.state()
        return (snapshot.undo_depth, snapshot.redo_depth)

    def recent(self, limit: int = 50) -> list[str]:
        """The most recent command descriptions, newest last."""
        return self.history.stack_for(UndoScope.TIMELINE).history(limit=limit)

    # -- writing -----------------------------------------------------------

    def execute(
        self,
        command: Command,
        ctx: CommandContext | None = None,
    ) -> Result[CommandOutcome]:
        """Validate, run and record one command.

        The history records a command only when it succeeds, so a rejected edit
        costs the user nothing — not even their redo future.
        """
        return self.history.execute(command, ctx or self.context())

    def undo(self, ctx: CommandContext | None = None) -> Result[Command | None]:
        """Undo the last timeline edit.

        Returns the command that was undone, or ``Ok(None)`` when the stack is
        empty — pressing Ctrl+Z on a fresh timeline is not an error.
        """
        return self.history.undo(UndoScope.TIMELINE, ctx or self.context())

    def redo(self, ctx: CommandContext | None = None) -> Result[Command | None]:
        """Redo the last undone timeline edit."""
        return self.history.redo(UndoScope.TIMELINE, ctx or self.context())
