"""Command pattern, undo/redo and gesture coalescing (ADR-0008).

Every mutation of project state in Nova Studio is a :class:`Command`.  There is no
other way to change a project: services expose ``execute(command)`` rather than
mutators.  That single decision buys us undo/redo, autosave deltas, the command
log used for crash recovery, keyboard-shortcut binding, telemetry and a scripting
API — all from one mechanism.

Memory model
------------
Commands store **captured deltas**, never snapshots.  ``MoveClipCommand`` holds
four integers, not a copy of a 40 000-keyframe timeline, so undo memory is bounded
and independent of project size.  A command whose delta is genuinely unbounded
(pasting a large subgraph) declares ``memory_class = MemoryClass.HEAVY`` and the
stack evicts heavy entries first when its budget is exceeded.

Coalescing
----------
A clip drag emits hundreds of position updates but must undo as **one** gesture.
:meth:`Command.merge_key` plus :meth:`Command.can_merge` express that per command
type — there is no global merge policy, because the right answer differs for
drags, sliders and text entry.

Scopes
------
Undo is per :class:`UndoScope`.  Undoing a caption style tweak must not destroy a
structural timeline edit made five minutes earlier in a different context.
"""

from __future__ import annotations

import threading
import time
from abc import ABC, abstractmethod
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import TYPE_CHECKING, Any

from nova_studio.core.errors import ErrorDomain, ErrorSeverity, NovaError
from nova_studio.core.result import Err, Ok, Result, failed

if TYPE_CHECKING:
    from nova_studio.core.events import EventBus

__all__ = [
    "Command",
    "CommandContext",
    "CommandError",
    "CommandOutcome",
    "CommandRegistry",
    "CommandScopeState",
    "CompositeCommand",
    "MemoryClass",
    "UndoScope",
    "UndoStack",
]

#: Clock injected into commands so that coalescing windows and telemetry are
#: deterministic in tests.
Clock = Callable[[], float]


def _monotonic_clock() -> float:
    return time.monotonic()


class UndoScope(StrEnum):
    """Independent undo contexts.

    ``GLOBAL`` is the fallback scope for commands that cross contexts (deleting an
    asset that caption clips reference must cascade atomically).
    """

    GLOBAL = "global"
    TIMELINE = "timeline"
    CAPTION = "caption"
    COLOUR = "colour"
    INSPECTOR = "inspector"


class MemoryClass(StrEnum):
    """How much memory a command's undo delta costs."""

    #: A handful of scalars or ids.
    LIGHT = "light"
    #: A bounded collection (a track's clip list, a caption document's segments).
    MEDIUM = "medium"
    #: An unbounded structural delta (paste of a large subgraph).  Evicted first
    #: when the stack's memory budget is exceeded.
    HEAVY = "heavy"


@dataclass(frozen=True, slots=True)
class CommandOutcome:
    """What a command changed, so subscribers can react precisely.

    Attributes:
        affected: Entity ids touched by the command.  Subscribers use this to
            decide whether they care, instead of reacting to every command.
        invalidate: Cache namespaces to invalidate (``timeline``, ``preview``,
            ``waveform``, ``thumbnail``).  Cache invalidation is a *subscriber*,
            never a call site inside a command.
        rerender: Whether the preview must re-render the visible range.
        marks_dirty: Whether the project is now unsaved.  Read-only commands and
            pure selection changes set this to ``False``.
        summary: Optional human-readable result, e.g. "Trimmed 12 frames".
        payload: Optional structured data for the frontend to consume directly,
            avoiding a refetch after a mutation.
    """

    affected: frozenset[str] = frozenset()
    invalidate: frozenset[str] = frozenset()
    rerender: bool = True
    marks_dirty: bool = True
    summary: str = ""
    payload: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def none(cls) -> CommandOutcome:
        """An outcome for a command that changes nothing observable."""
        return cls(rerender=False, marks_dirty=False)


@dataclass(slots=True)
class CommandContext:
    """Everything a command may touch.

    The context is deliberately narrow: a command receives the services it needs
    through ``services``, an id for the open project, the clock and the event bus.
    It cannot reach into ``infra`` directly, which is what keeps commands
    unit-testable with fakes.
    """

    services: Any
    project_id: str
    clock: Clock = _monotonic_clock
    bus: EventBus | None = None
    scope_id: str = ""
    state: dict[str, Any] = field(default_factory=dict)

    def now(self) -> float:
        """Current monotonic time in seconds."""
        return self.clock()


class CommandError(NovaError):
    """A command failed.  Constructed via the helpers below for stable codes."""

    @classmethod
    def execution_failed(cls, command_id: str, reason: str) -> CommandError:
        """The command's ``execute`` could not complete."""
        return cls(
            "NS-COMMAND-4101",
            f"command {command_id} failed: {reason}",
            domain=ErrorDomain.CORE,
            severity=ErrorSeverity.ERROR,
            details={"command_id": command_id},
            retryable=False,
        )

    @classmethod
    def undo_failed(cls, command_id: str, reason: str) -> CommandError:
        """The command's ``undo`` could not complete — state may be inconsistent."""
        return cls(
            "NS-COMMAND-4102",
            f"undo of {command_id} failed: {reason}",
            domain=ErrorDomain.CORE,
            severity=ErrorSeverity.CRITICAL,
            details={"command_id": command_id},
            remedy="The project may need to be restored from the last autosave.",
            retryable=False,
        )

    @classmethod
    def not_executed(cls, command_id: str) -> CommandError:
        """``undo`` was called on a command that never ran."""
        return cls(
            "NS-COMMAND-4103",
            f"cannot undo {command_id}: it was never executed",
            domain=ErrorDomain.CORE,
            severity=ErrorSeverity.ERROR,
            details={"command_id": command_id},
        )

    @classmethod
    def precondition(cls, command_id: str, reason: str) -> CommandError:
        """A precondition rejected the command before any state changed."""
        return cls(
            "NS-COMMAND-4104",
            f"{command_id} rejected: {reason}",
            domain=ErrorDomain.CORE,
            severity=ErrorSeverity.WARNING,
            details={"command_id": command_id},
        )


class Command(ABC):
    """A single undoable mutation of project state.

    Subclasses must declare :attr:`command_id` and :attr:`display_name` and
    implement :meth:`execute` and :meth:`undo`.  ``execute`` must be **atomic**:
    either every change it makes is applied, or none is.  When a command touches
    several aggregates, wrap it in a :class:`CompositeCommand` or perform the work
    inside one repository transaction.
    """

    # These are *annotated class attributes*, not ``ClassVar``: a composite
    # command derives its id, name, scope and memory class from its children and
    # stores them on the instance, which shadows the class default.  Concrete
    # commands set them at class level, which is the common case.

    #: Stable identifier, also used for shortcut binding and telemetry grouping.
    command_id: str = ""
    #: Localisable key for the Edit menu.  Resolved through i18n.
    display_name: str = ""
    #: Which undo stack this command belongs to.
    scope: UndoScope = UndoScope.TIMELINE
    #: Undo delta size class, used for eviction under memory pressure.
    memory_class: MemoryClass = MemoryClass.LIGHT
    #: Whether the command may coalesce with a predecessor.
    coalescible: bool = False
    #: Coalescing window in seconds for a gesture.
    coalesce_window_seconds: float = 0.7

    def __init__(self) -> None:
        self._executed = False
        self._execution_time: float | None = None
        self._last_execute_ts: float = 0.0

    # -- required implementation ------------------------------------------

    @abstractmethod
    def execute(self, ctx: CommandContext) -> Result[CommandOutcome]:
        """Apply the mutation and return what changed."""

    @abstractmethod
    def undo(self, ctx: CommandContext) -> Result[None]:
        """Revert the mutation exactly.

        Must be the inverse of :meth:`execute`, implemented from a captured delta.
        Every command is round-trip tested: ``execute`` then ``undo`` must leave
        the serialised project byte-identical (ADR-0016).
        """

    # -- optional overrides ------------------------------------------------

    def redo(self, ctx: CommandContext) -> Result[CommandOutcome]:
        """Re-apply the mutation.  Defaults to :meth:`execute`.

        Override only when re-applying is genuinely cheaper or different from the
        first application (e.g. a command that captured a random id on first run
        must reuse it).
        """
        return self.execute(ctx)

    def merge_key(self) -> Any:
        """Identity of the gesture this command belongs to.

        Return a hashable key (typically ``(target_id, interaction_id)``) when two
        commands should be considered the same gesture.  ``None`` disables merging.
        """
        return None

    def can_merge(self, previous: Command, elapsed_seconds: float) -> bool:
        """Whether ``previous`` and ``self`` are one gesture.

        The default implementation requires: same command id, same merge key, both
        coalescible, and ``elapsed_seconds`` within :attr:`coalesce_window_seconds`.
        Override to add command-specific rules (e.g. text editing merges only
        within a word).
        """
        if not self.coalescible or not previous.coalescible:
            return False
        if type(previous) is not type(self):
            return False
        if elapsed_seconds < 0 or elapsed_seconds > self.coalesce_window_seconds:
            return False
        key = self.merge_key()
        return key is not None and key == previous.merge_key()

    def merge_into(self, previous: Command) -> Command:
        """Return the command representing ``previous`` followed by ``self``.

        The default keeps ``previous``'s undo delta (the *original* state) while
        adopting ``self``'s forward state, which is exactly what a drag needs:
        undo returns to where the gesture began, not to the previous mouse move.
        Subclasses must override this to update the forward state; the base
        implementation raises so that a command declaring itself coalescible
        without implementing merging fails loudly in tests.
        """
        raise NotImplementedError(
            f"{type(self).__name__} declares coalescible=True but does not "
            "implement merge_into(); see ADR-0008 §3"
        )

    def validate(self, ctx: CommandContext) -> Result[None]:
        """Check preconditions before any state changes.

        Called by :class:`CommandHistory` prior to :meth:`execute`.  The default
        accepts everything; override to reject invalid edits with a precise,
        user-actionable :class:`CommandError`.
        """
        return Ok(None)

    # -- state -------------------------------------------------------------

    @property
    def executed(self) -> bool:
        """Whether :meth:`execute` completed successfully."""
        return self._executed

    @property
    def execution_time(self) -> float | None:
        """Wall time of the last successful execution, in seconds."""
        return self._execution_time

    @property
    def last_execute_timestamp(self) -> float:
        """Monotonic timestamp of the last execution, used for coalescing."""
        return self._last_execute_ts

    def mark_executed(self, when: float, duration: float) -> None:
        """Record successful execution.  Called by :class:`CommandHistory`."""
        self._executed = True
        self._execution_time = duration
        self._last_execute_ts = when

    def mark_reverted(self) -> None:
        """Record that the command was undone."""
        self._executed = False

    def describe(self) -> str:
        """Human-readable one-liner for the history panel and logs."""
        return f"{self.command_id or type(self).__name__} [{self.scope.value}]"

    def __repr__(self) -> str:
        return (
            f"<{type(self).__name__} id={self.command_id!r} scope={self.scope.value!r} "
            f"executed={self._executed}>"
        )


class CompositeCommand(Command):
    """A batch of commands executed and undone as one atomic step.

    Used for multi-object edits ("move these five clips"), for paste operations
    that create entities and then link them, and for any action whose parts must
    not be separately undoable.

    Execution is **fail-fast**: if any child fails, the already-executed children
    are undone in reverse order and the composite reports the child's error.  This
    gives all-or-nothing semantics without requiring a database transaction to span
    engines that may not share one.
    """

    command_id = "composite"
    display_name = "command.composite"
    scope = UndoScope.GLOBAL

    def __init__(
        self,
        commands: Sequence[Command],
        *,
        display_name: str = "",
        scope: UndoScope | None = None,
    ) -> None:
        super().__init__()
        if not commands:
            raise ValueError("CompositeCommand requires at least one child command")
        self.commands: tuple[Command, ...] = tuple(commands)
        # Instance attributes shadow the ClassVar defaults, so a composite can
        # report a derived id, name and scope without breaking the base contract.
        self.command_id = _composite_id(self.commands)
        if display_name:
            self.display_name = display_name
        # A composite belongs to the widest scope among its children so that a
        # cross-context batch is undone from the global stack.
        scopes = {child.scope for child in self.commands}
        self.scope = scope or (UndoScope.GLOBAL if len(scopes) > 1 else next(iter(scopes)))
        self.memory_class = (
            MemoryClass.HEAVY
            if any(child.memory_class is MemoryClass.HEAVY for child in self.commands)
            else MemoryClass.MEDIUM
        )

    def execute(self, ctx: CommandContext) -> Result[CommandOutcome]:
        """Run every child in order, rolling back on the first failure."""
        executed: list[Command] = []
        outcomes: list[CommandOutcome] = []
        for child in self.commands:
            validated = child.validate(ctx)
            if validated.is_err():
                self._rollback(executed, ctx, failed=None)
                return Err(validated.unwrap_err())
            result = child.execute(ctx)
            if result.is_err():
                # `failed=child` asks the failing child to undo itself.  A command
                # is contracted to be atomic, so normally this is a no-op; it is a
                # best-effort safety net for a child that mutated and then failed.
                self._rollback(executed, ctx, failed=child)
                return Err(
                    result.unwrap_err().with_details(
                        composite_index=len(executed),
                        composite_size=len(self.commands),
                    )
                )
            child.mark_executed(ctx.now(), child.execution_time or 0.0)
            executed.append(child)
            outcomes.append(result.unwrap())
        return Ok(_merge_outcomes(outcomes))

    def undo(self, ctx: CommandContext) -> Result[None]:
        """Undo every child in reverse order.

        All children are attempted even if one fails, so a partial failure does not
        leave the remaining children un-reverted; the first error is reported.
        """
        first_error: NovaError | None = None
        for child in reversed(self.commands):
            if not child.executed:
                continue
            result = child.undo(ctx)
            if result.is_err() and first_error is None:
                first_error = result.unwrap_err()
            else:
                child.mark_reverted()
        if first_error is not None:
            return Err(first_error)
        return Ok(None)

    def _rollback(
        self,
        executed: Iterable[Command],
        ctx: CommandContext,
        *,
        failed: Command | None,
    ) -> None:
        """Revert already-executed children, newest first.

        When ``failed`` is given, that child is asked to undo itself *first*.  Its
        undo result is intentionally discarded: the composite is already reporting
        the execution failure, which is the more actionable error, and a secondary
        failure must not mask it.
        """
        if failed is not None:
            try:
                failed.undo(ctx)
                failed.mark_reverted()
            except Exception:
                pass
        for child in reversed(list(executed)):
            try:
                child.undo(ctx)
                child.mark_reverted()
            except Exception:
                # A child that cannot undo is recorded on the bus so the failure is
                # visible; the rollback still proceeds for the remaining children.
                if ctx.bus is not None:
                    ctx.bus.publish(
                        "command.rollback_failed",
                        {
                            "command_id": child.command_id,
                            "exception": "undo raised during composite rollback",
                        },
                        source="composite_command",
                    )

    def describe(self) -> str:
        return (
            f"composite({len(self.commands)} commands: "
            f"{', '.join(sorted({c.command_id for c in self.commands}))})"
        )


def _composite_id(commands: Sequence[Command]) -> str:
    """Derive a telemetry-meaningful id from the children's ids."""
    ids = sorted({child.command_id for child in commands if child.command_id})
    return f"composite[{'+'.join(ids) or 'empty'}]"


def _merge_outcomes(outcomes: Sequence[CommandOutcome]) -> CommandOutcome:
    """Combine child outcomes into one for a composite command."""
    affected: set[str] = set()
    invalidate: set[str] = set()
    rerender = False
    marks_dirty = False
    summaries: list[str] = []
    for outcome in outcomes:
        affected.update(outcome.affected)
        invalidate.update(outcome.invalidate)
        rerender = rerender or outcome.rerender
        marks_dirty = marks_dirty or outcome.marks_dirty
        if outcome.summary:
            summaries.append(outcome.summary)
    return CommandOutcome(
        affected=frozenset(affected),
        invalidate=frozenset(invalidate),
        rerender=rerender,
        marks_dirty=marks_dirty,
        summary="; ".join(summaries),
    )


@dataclass(slots=True)
class CommandScopeState:
    """Observable state of one undo scope, for the UI's Edit menu."""

    scope: UndoScope
    can_undo: bool
    can_redo: bool
    undo_label: str
    redo_label: str
    undo_depth: int
    redo_depth: int


class UndoStack:
    """A bounded undo/redo stack for one :class:`UndoScope`.

    Thread-safe.  The stack bounds both entry count and heavy-entry count so that
    a long session on a large project cannot grow memory without limit; heavy
    commands are evicted before light ones.
    """

    def __init__(
        self,
        scope: UndoScope,
        *,
        max_entries: int = 200,
        max_heavy_entries: int = 25,
    ) -> None:
        if max_entries < 1:
            raise ValueError("max_entries must be >= 1")
        self._scope = scope
        self._max_entries = max_entries
        self._max_heavy = max(1, max_heavy_entries)
        self._undo: list[Command] = []
        self._redo: list[Command] = []
        self._lock = threading.RLock()

    @property
    def scope(self) -> UndoScope:
        """The scope this stack serves."""
        return self._scope

    def push(self, command: Command) -> Command | None:
        """Record an executed command.  Returns the command it merged into, if any.

        Any push clears the redo stack: once the user does something new, the
        abandoned future is no longer reachable.
        """
        with self._lock:
            merged_into: Command | None = None
            if self._undo:
                top = self._undo[-1]
                elapsed = command.last_execute_timestamp - top.last_execute_timestamp
                if command.can_merge(top, elapsed):
                    replacement = command.merge_into(top)
                    replacement.mark_executed(
                        command.last_execute_timestamp,
                        (top.execution_time or 0.0) + (command.execution_time or 0.0),
                    )
                    self._undo[-1] = replacement
                    merged_into = replacement
            if merged_into is None:
                self._undo.append(command)
            self._redo.clear()
            self._enforce_limits()
            return merged_into

    def pop_undo(self) -> Command | None:
        """Take the most recent command off the undo stack."""
        with self._lock:
            return self._undo.pop() if self._undo else None

    def pop_redo(self) -> Command | None:
        """Take the most recently undone command off the redo stack."""
        with self._lock:
            return self._redo.pop() if self._redo else None

    def push_redo(self, command: Command) -> None:
        """Record a command that has just been undone, making it redoable."""
        with self._lock:
            self._redo.append(command)

    def push_undo(self, command: Command) -> None:
        """Return a command to the undo stack after a successful redo."""
        with self._lock:
            self._undo.append(command)
            self._enforce_limits()

    def peek_undo(self) -> Command | None:
        """The command an ``undo`` would revert, without removing it."""
        with self._lock:
            return self._undo[-1] if self._undo else None

    def peek_redo(self) -> Command | None:
        """The command a ``redo`` would re-apply, without removing it."""
        with self._lock:
            return self._redo[-1] if self._redo else None

    def clear(self, *, keep_redo: bool = False) -> None:
        """Drop history.  Called when a project is closed or a checkpoint resets it."""
        with self._lock:
            self._undo.clear()
            if not keep_redo:
                self._redo.clear()

    def _enforce_limits(self) -> None:
        """Trim the stack to its budgets, evicting heavy commands first."""
        while len(self._undo) > self._max_entries:
            index = self._eviction_candidate()
            if index is None:  # pragma: no cover - guarded by max_heavy >= 1
                del self._undo[0]
            else:
                del self._undo[index]
        heavy = sum(1 for command in self._undo if command.memory_class is MemoryClass.HEAVY)
        while heavy > self._max_heavy:
            index = self._eviction_candidate(heavy_only=True)
            if index is None:
                break
            del self._undo[index]
            heavy -= 1

    def _eviction_candidate(self, *, heavy_only: bool = False) -> int | None:
        """Index of the oldest evictable entry, preferring heavy commands."""
        for index, command in enumerate(self._undo):
            if command.memory_class is MemoryClass.HEAVY:
                return index
        if heavy_only:
            return None
        return 0 if self._undo else None

    # -- observation -------------------------------------------------------

    def __len__(self) -> int:
        with self._lock:
            return len(self._undo)

    @property
    def undo_depth(self) -> int:
        """Number of undoable steps."""
        with self._lock:
            return len(self._undo)

    @property
    def redo_depth(self) -> int:
        """Number of redoable steps."""
        with self._lock:
            return len(self._redo)

    def state(self) -> CommandScopeState:
        """Snapshot for the Edit menu and the status bar."""
        with self._lock:
            undo_top = self._undo[-1] if self._undo else None
            redo_top = self._redo[-1] if self._redo else None
            return CommandScopeState(
                scope=self._scope,
                can_undo=undo_top is not None,
                can_redo=redo_top is not None,
                undo_label=(undo_top.display_name if undo_top else ""),
                redo_label=(redo_top.display_name if redo_top else ""),
                undo_depth=len(self._undo),
                redo_depth=len(self._redo),
            )

    def history(self, limit: int = 50) -> list[str]:
        """Recent command descriptions, newest last.  Used by the history panel."""
        with self._lock:
            return [command.describe() for command in self._undo[-limit:]]


class CommandRegistry:
    """Maps command ids to classes, for shortcuts, telemetry and scripting.

    The keyboard-shortcut manager and the scripting host both need to construct a
    command from an id; this registry is the single place that knows how.  It also
    provides the metadata the shortcut editor displays.
    """

    def __init__(self) -> None:
        self._by_id: dict[str, type[Command]] = {}
        self._lock = threading.RLock()

    def register(self, command_type: type[Command]) -> type[Command]:
        """Register a command class under its ``command_id``.

        Usable as a class decorator::

            @registry.register
            class MoveClipCommand(Command): ...
        """
        command_id = command_type.command_id
        if not command_id:
            raise ValueError(f"{command_type.__name__} must declare a non-empty command_id")
        with self._lock:
            existing = self._by_id.get(command_id)
            if existing is not None and existing is not command_type:
                raise ValueError(
                    f"command_id {command_id!r} is already registered by {existing.__name__}"
                )
            self._by_id[command_id] = command_type
        return command_type

    def get(self, command_id: str) -> type[Command] | None:
        """Look up a command class by id."""
        with self._lock:
            return self._by_id.get(command_id)

    def ids(self) -> list[str]:
        """All registered command ids, sorted."""
        with self._lock:
            return sorted(self._by_id)

    def metadata(self) -> list[dict[str, Any]]:
        """Descriptor list for the shortcut editor and the docs generator."""
        with self._lock:
            return [
                {
                    "command_id": command_type.command_id,
                    "display_name": command_type.display_name,
                    "scope": command_type.scope.value,
                    "memory_class": command_type.memory_class.value,
                    "coalescible": command_type.coalescible,
                    "class": command_type.__name__,
                    "doc": (command_type.__doc__ or "").strip().splitlines()[0]
                    if command_type.__doc__
                    else "",
                }
                for command_type in sorted(self._by_id.values(), key=lambda item: item.command_id)
            ]

    def __len__(self) -> int:
        with self._lock:
            return len(self._by_id)

    def __contains__(self, command_id: object) -> bool:
        with self._lock:
            return command_id in self._by_id


class CommandHistory:
    """Executes commands, maintains per-scope undo stacks and publishes events.

    This is the object the rest of the application talks to.  It is responsible
    for: validation, execution timing, coalescing, stack bookkeeping, publishing
    ``command.executed`` / ``command.reverted`` / ``command.failed``, and
    exposing the per-scope state the Edit menu renders.

    Side effects (cache invalidation, autosave dirty-marking, preview re-render,
    WebSocket broadcast) are **subscribers** to those events, never call sites
    here.  Adding a new reaction to edits therefore requires no change to this
    class or to any command.
    """

    def __init__(
        self,
        *,
        bus: EventBus | None = None,
        clock: Clock = _monotonic_clock,
        scopes: Iterable[UndoScope] | None = None,
        max_entries: int = 200,
        max_heavy_entries: int = 25,
        registry: CommandRegistry | None = None,
    ) -> None:
        self._bus = bus
        self._clock = clock
        self._registry = registry if registry is not None else CommandRegistry()
        active_scopes = tuple(scopes) if scopes is not None else tuple(UndoScope)
        self._stacks: dict[UndoScope, UndoStack] = {
            scope: UndoStack(scope, max_entries=max_entries, max_heavy_entries=max_heavy_entries)
            for scope in active_scopes
        }
        self._lock = threading.RLock()
        self._executed_count = 0
        self._failed_count = 0
        self._coalesced_count = 0
        self._undo_count = 0
        self._redo_count = 0

    @property
    def registry(self) -> CommandRegistry:
        """The command registry owned by this history."""
        return self._registry

    def stack_for(self, scope: UndoScope) -> UndoStack:
        """Return the stack serving ``scope``.

        Raises:
            KeyError: If the scope was not enabled at construction.
        """
        try:
            return self._stacks[scope]
        except KeyError:
            raise KeyError(
                f"undo scope {scope.value!r} is not enabled; enabled scopes: "
                f"{[item.value for item in self._stacks]}"
            ) from None

    # -- execution ---------------------------------------------------------

    def execute(self, command: Command, ctx: CommandContext) -> Result[CommandOutcome]:
        """Validate, execute and record ``command``.

        The command is recorded on its own scope's stack only when execution
        succeeds; a rejected or failed command leaves history untouched, so a
        failed action never consumes the user's redo future.
        """
        validated = command.validate(ctx)
        if validated.is_err():
            error = validated.unwrap_err()
            self._publish_failure(command, error)
            return failed(error)

        started = self._clock()
        result = command.execute(ctx)
        duration = self._clock() - started
        if result.is_err():
            error = result.unwrap_err()
            self._publish_failure(command, error)
            return failed(error)

        command.mark_executed(started, duration)
        outcome = result.unwrap()
        merged_into: Command | None = None
        with self._lock:
            stack = self._stacks.get(command.scope)
            if stack is not None:
                merged_into = stack.push(command)
                if merged_into is not None:
                    self._coalesced_count += 1
            self._executed_count += 1

        self._publish_executed(command, outcome, merged=merged_into)
        return Ok(outcome)

    def undo(self, scope: UndoScope, ctx: CommandContext) -> Result[Command | None]:
        """Undo the most recent command in ``scope``.

        Returns the reverted command, or ``Ok(None)`` when there is nothing to
        undo — an empty stack is not an error, because menu items are enabled from
        :meth:`state` and a stale click is benign.
        """
        with self._lock:
            stack = self._stacks.get(scope)
            if stack is None:
                return Err(
                    CommandError.precondition("undo", f"scope {scope.value!r} is not enabled")
                )
            command = stack.pop_undo()
        if command is None:
            return Ok(None)

        undo_result = command.undo(ctx)
        if undo_result.is_err():
            error = undo_result.unwrap_err()
            # Put the command back: the state is unchanged or partially changed,
            # and losing it would make the situation strictly worse.
            with self._lock:
                self._stacks[scope].push_undo(command)
            self._publish_failure(command, error, phase="undo")
            return failed(error)

        command.mark_reverted()
        with self._lock:
            self._stacks[scope].push_redo(command)
            self._undo_count += 1
        self._publish_reverted(command, direction="undo")
        return Ok(command)

    def redo(self, scope: UndoScope, ctx: CommandContext) -> Result[Command | None]:
        """Re-apply the most recently undone command in ``scope``."""
        with self._lock:
            stack = self._stacks.get(scope)
            if stack is None:
                return Err(
                    CommandError.precondition("redo", f"scope {scope.value!r} is not enabled")
                )
            command = stack.pop_redo()
        if command is None:
            return Ok(None)

        started = self._clock()
        redo_result = command.redo(ctx)
        duration = self._clock() - started
        if redo_result.is_err():
            error = redo_result.unwrap_err()
            with self._lock:
                self._stacks[scope].push_redo(command)
            self._publish_failure(command, error, phase="redo")
            return failed(error)

        command.mark_executed(started, duration)
        with self._lock:
            self._stacks[scope].push_undo(command)
            self._redo_count += 1
        self._publish_reverted(command, direction="redo")
        return Ok(command)

    def clear(self, scope: UndoScope | None = None) -> None:
        """Clear one scope's history, or every scope when ``scope`` is ``None``."""
        with self._lock:
            targets = list(self._stacks.values()) if scope is None else [self._stacks[scope]]
            for stack in targets:
                stack.clear()

    # -- observation -------------------------------------------------------

    def state(self, scope: UndoScope) -> CommandScopeState:
        """Observable undo/redo state for one scope."""
        return self.stack_for(scope).state()

    def all_states(self) -> dict[str, CommandScopeState]:
        """Observable state for every enabled scope, for the status bar."""
        with self._lock:
            return {scope.value: stack.state() for scope, stack in self._stacks.items()}

    def stats(self) -> dict[str, int]:
        """Telemetry snapshot."""
        with self._lock:
            return {
                "executed": self._executed_count,
                "failed": self._failed_count,
                "coalesced": self._coalesced_count,
                "undo": self._undo_count,
                "redo": self._redo_count,
                "undo_depth": sum(stack.undo_depth for stack in self._stacks.values()),
                "redo_depth": sum(stack.redo_depth for stack in self._stacks.values()),
            }

    # -- events ------------------------------------------------------------

    def _publish_executed(
        self,
        command: Command,
        outcome: CommandOutcome,
        *,
        merged: Command | None,
    ) -> None:
        if self._bus is None:
            return
        self._bus.publish(
            "command.executed",
            {
                "command_id": command.command_id,
                "scope": command.scope.value,
                "display_name": command.display_name,
                "affected": sorted(outcome.affected),
                "invalidate": sorted(outcome.invalidate),
                "rerender": outcome.rerender,
                "marks_dirty": outcome.marks_dirty,
                "summary": outcome.summary,
                "coalesced": merged is not None,
                "duration_ms": round((command.execution_time or 0.0) * 1000, 3),
                "payload": outcome.payload,
            },
            source="command_history",
            command_id=command.command_id,
        )

    def _publish_reverted(self, command: Command, *, direction: str) -> None:
        if self._bus is None:
            return
        self._bus.publish(
            "command.reverted",
            {
                "command_id": command.command_id,
                "scope": command.scope.value,
                "display_name": command.display_name,
                "direction": direction,
            },
            source="command_history",
            command_id=command.command_id,
        )

    def _publish_failure(
        self, command: Command, error: NovaError, *, phase: str = "execute"
    ) -> None:
        with self._lock:
            self._failed_count += 1
        if self._bus is None:
            return
        self._bus.publish(
            "command.failed",
            {
                "command_id": command.command_id,
                "scope": command.scope.value,
                "phase": phase,
                "error": error.to_dict(),
            },
            source="command_history",
            command_id=command.command_id,
        )
