"""L3 — crash recovery: what to offer, and in what order.

A crash leaves three things on disk: a committed project, a bounded set of
checkpoints, and a journal of commands the user executed since the last
checkpoint.  Recovery is the conversation about which of them to trust.

The design here is deliberately **a plan, not an action**.  This module never
writes and never replays: it reads a :class:`JournalWindow` and returns what the
user may choose from, in the order they should be offered.  Two reasons:

* **Only the user knows whether the last two minutes were gold or garbage.**
  A crash during a brilliant take is not the same as a crash during an
  experiment they were about to undo.  Deciding for them is the kind of
  helpfulness that destroys work.
* **The choice is the only part that is testable without a filesystem.**  What
  to offer depends on what is in the journal and whether a checkpoint exists;
  executing a choice needs an archive, a command registry and a clock, all of
  which the caller already has.

Rules, in the order they are applied:

1. **Nothing pending, nothing torn → nothing to recover.**  No dialog.  A user
   whose editor closed cleanly must not be asked about it.
2. **A torn tail is data, not corruption.**  Dying between writing a command and
   writing its newline is the normal state of a journal, so the incomplete entry
   is dropped and the rest are offered — with the fact stated, because "we
   recovered 47 of 48 commands" is a sentence a user needs to read.
3. **Replaying starts after the checkpoint.**  Commands at or before it are
   already baked into the checkpoint's document; replaying them would apply them
   twice, which is how a clip ends up 200 px from where it was left.
4. **Discarding is always offered.**  Keeping the committed file exactly as it
   is must always be on the menu, because "do nothing" is sometimes right.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from nova_studio.domain.persistence import JournalEntry, JournalWindow

__all__ = [
    "RecoveryOffer",
    "RecoveryPlan",
    "entries_after_checkpoint",
    "plan_recovery",
]


class RecoveryOffer(StrEnum):
    """What the user may choose from after a crash."""

    #: Go back to the last checkpoint and lose everything after it.
    RESTORE_CHECKPOINT = "restore-checkpoint"
    #: Replay the journal's commands onto the checkpoint, keeping the work.
    REPLAY_JOURNAL = "replay-journal"
    #: Keep the committed file as it is and drop the pending commands.
    DISCARD = "discard"


@dataclass(frozen=True, slots=True, kw_only=True)
class RecoveryPlan:
    """What happened, and what the user may do about it."""

    #: The checkpoint recovery starts from; ``0`` when there is none.
    checkpoint_sequence: int = 0
    #: How many commands would be replayed by :attr:`RecoveryOffer.REPLAY_JOURNAL`.
    pending_commands: int = 0
    #: Whether an incomplete trailing entry was found and dropped.
    torn_tail: bool = False
    #: What to offer, best first.
    offers: tuple[RecoveryOffer, ...] = ()
    #: One sentence for the dialog, in the developer's locale.
    detail: str = ""

    @property
    def is_needed(self) -> bool:
        """Whether there is anything to ask about at all."""
        return bool(self.offers)

    @property
    def preferred(self) -> RecoveryOffer | None:
        """The offer the dialog should preselect.

        Replaying keeps the user's work, so it is offered first; restoring a
        checkpoint is the safe second; discarding is always available.
        """
        return self.offers[0] if self.offers else None


def entries_after_checkpoint(
    window: JournalWindow,
    *,
    checkpoint_sequence: int = 0,
) -> tuple[JournalEntry, ...]:
    """The journal entries that are not already baked into the checkpoint.

    Sequences are monotonic and never reused, so "after the checkpoint" is a
    comparison and not a search.
    """
    return tuple(entry for entry in window.entries if entry.sequence > checkpoint_sequence)


def plan_recovery(
    window: JournalWindow,
    *,
    checkpoint_sequence: int = 0,
) -> RecoveryPlan:
    """Work out what to offer the user after a crash.

    Args:
        window: What :meth:`~nova_studio.ports.persistence.Journal.read_since`
            returned.
        checkpoint_sequence: The newest checkpoint's sequence, or ``0`` when the
            project has never been checkpointed — in which case replaying runs
            onto the committed document instead.
    """
    pending = entries_after_checkpoint(window, checkpoint_sequence=checkpoint_sequence)
    torn = window.torn_tail
    has_checkpoint = checkpoint_sequence > 0

    if not pending and not torn:
        return RecoveryPlan(
            checkpoint_sequence=checkpoint_sequence,
            detail="this project closed cleanly; there is nothing to recover",
        )

    # Best first: keep the user's work, then fall back, then do nothing.
    offers: list[RecoveryOffer] = [RecoveryOffer.REPLAY_JOURNAL]
    if has_checkpoint:
        offers.append(RecoveryOffer.RESTORE_CHECKPOINT)
    offers.append(RecoveryOffer.DISCARD)

    detail = _detail(
        pending=len(pending),
        dropped=torn,
        has_checkpoint=has_checkpoint,
        checkpoint_sequence=checkpoint_sequence,
    )
    return RecoveryPlan(
        checkpoint_sequence=checkpoint_sequence,
        pending_commands=len(pending),
        torn_tail=torn,
        offers=tuple(offers),
        detail=detail,
    )


def _detail(
    *,
    pending: int,
    dropped: bool,
    has_checkpoint: bool,
    checkpoint_sequence: int,
) -> str:
    where = f"checkpoint {checkpoint_sequence}" if has_checkpoint else "the last save"
    if pending == 1:
        sentence = f"1 command was made after {where} and has not been saved."
    else:
        sentence = f"{pending} commands were made after {where} and have not been saved."
    if dropped:
        sentence += " An incomplete entry at the end of the journal was discarded."
    return sentence
