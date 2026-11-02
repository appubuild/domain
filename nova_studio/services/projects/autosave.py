"""L3 — autosave: when to take a checkpoint, and what history to keep.

The guarantee a user is buying is a sentence: **you lose at most N commands or T
seconds of work.**  Everything here exists to make that sentence true, reviewable
in one place, and testable without a clock.

That is why the thresholds live in ``domain/persistence.CheckpointPolicy`` as
data and why this module is a **pure state machine**: it counts what the caller
tells it and answers when asked.  It does not sleep, does not spawn a thread and
does not touch a disk — the caller owns the clock, the journal and the archive
(ADR-0010: a service that starts its own thread cannot be cancelled, prioritised
or recovered after a crash).

The counters are part of the state rather than of the caller, because "how long
since the last checkpoint" is exactly the kind of bookkeeping that goes wrong
when three places need it: the autosave tick, the manual checkpoint and the
crash-recovery flow all ask the same question and must get the same answer.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING, Final

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.persistence import CheckpointPolicy, RevisionRef, revisions_to_prune

if TYPE_CHECKING:
    from collections.abc import Sequence

__all__ = [
    "DEFAULT_AUTOSAVE",
    "AutosaveState",
]

#: What a fresh install runs with: checkpoints every 200 commands or two
#: minutes, keeping five.
DEFAULT_AUTOSAVE: Final[CheckpointPolicy] = CheckpointPolicy()


@dataclass(frozen=True, slots=True, kw_only=True)
class AutosaveState:
    """Where autosave has got to.

    Frozen, so a snapshot can be handed to a worker or compared in a test:
    every method returns a new state rather than mutating this one.
    """

    policy: CheckpointPolicy = field(default_factory=CheckpointPolicy)
    commands_since: int = 0
    #: Milliseconds of the last checkpoint.  ``0`` means "never checkpointed",
    #: which is the state a freshly opened project is in.
    last_checkpoint_ms: int = 0

    def __post_init__(self) -> None:
        if self.commands_since < 0:
            raise NovaInvariantError(
                f"commands_since must not be negative, got {self.commands_since}"
            )
        if self.last_checkpoint_ms < 0:
            raise NovaInvariantError(
                f"last_checkpoint_ms must not be negative, got {self.last_checkpoint_ms}"
            )

    @property
    def has_checkpointed(self) -> bool:
        """Whether this project has ever been checkpointed in this session."""
        return self.last_checkpoint_ms > 0

    def recorded(self, *, at_ms: int, commands: int = 1) -> AutosaveState:
        """The state after ``commands`` more edits, first seen at ``at_ms``.

        The first recorded command starts the clock: a project that has been
        open for an hour with nothing done to it does not need a checkpoint.
        """
        if commands < 1:
            raise NovaInvariantError(f"commands must be at least 1, got {commands}")
        return replace(
            self,
            commands_since=self.commands_since + commands,
            last_checkpoint_ms=self.last_checkpoint_ms or at_ms,
        )

    def checkpointed(self, *, at_ms: int) -> AutosaveState:
        """The state just after a checkpoint was written."""
        return replace(self, commands_since=0, last_checkpoint_ms=at_ms)

    def due(self, *, now_ms: int) -> bool:
        """Whether a checkpoint is owed.

        Whichever limit is reached first wins: a burst of commands checkpoints
        early, and a slow, careful edit checkpoints on time.
        """
        if self.commands_since == 0:
            return False
        if not self.has_checkpointed:
            # Nothing has been recorded yet, so there is nothing to save.
            return False
        return self.policy.should_checkpoint(
            commands_since=self.commands_since,
            elapsed_ms=max(0, now_ms - self.last_checkpoint_ms),
        )

    def commands_until_due(self) -> int:
        """How many more commands before a checkpoint is owed.

        The status bar shows this; it is also the cheapest way for a test to say
        "after 199 commands, not yet — after 200, now".
        """
        return max(0, self.policy.commands_between_checkpoints - self.commands_since)

    def revisions_to_drop(self, revisions: Sequence[RevisionRef]) -> tuple[RevisionRef, ...]:
        """The oldest revisions beyond this policy's bound, oldest first.

        Delegated to the domain, which owns the rule; this is here so a caller
        that holds an autosave state never has to know the bound lives in the
        policy and not beside it.
        """
        return revisions_to_prune(revisions, self.policy.max_revisions)
