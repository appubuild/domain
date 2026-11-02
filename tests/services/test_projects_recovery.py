"""Crash recovery (`services/projects/recovery.py`).

Recovery is a conversation, not an automatic repair: this module works out *what
to offer* and never executes it. These tests pin the offers and the one
correctness rule that matters — commands already baked into a checkpoint must
never be replayed onto it, because applying an edit twice is how a clip ends up
200 px from where the user left it.
"""

from __future__ import annotations

import pytest

from nova_studio.domain.persistence import JournalEntry, JournalWindow
from nova_studio.services.projects import (
    RecoveryOffer,
    RecoveryPlan,
    entries_after_checkpoint,
    plan_recovery,
)

pytestmark = pytest.mark.unit

T0 = 1_700_000_000_000


def _window(sequences: tuple[int, ...], *, torn: bool = False) -> JournalWindow:
    entries = tuple(
        JournalEntry(sequence=sequence, recorded_at_ms=T0 + sequence, name=f"cmd-{sequence}")
        for sequence in sequences
    )
    return JournalWindow(entries=entries, next_sequence=len(sequences) + 1, torn_tail=torn)


class TestNothingToRecover:
    def test_a_clean_close_offers_nothing(self) -> None:
        assert plan_recovery(JournalWindow()).offers == ()

    def test_a_clean_close_is_not_needed(self) -> None:
        assert plan_recovery(JournalWindow()).is_needed is False

    def test_a_clean_close_has_no_preference(self) -> None:
        assert plan_recovery(JournalWindow()).preferred is None

    def test_a_clean_close_says_so(self) -> None:
        assert "closed cleanly" in plan_recovery(JournalWindow()).detail

    def test_a_window_with_only_older_commands_offers_nothing(self) -> None:
        """Everything in the journal is already in the checkpoint."""
        plan = plan_recovery(_window((1, 2, 3)), checkpoint_sequence=3)
        assert plan.is_needed is False


class TestWhatIsOffered:
    def test_a_crash_with_a_checkpoint_offers_three_choices(self) -> None:
        plan = plan_recovery(_window((3,)), checkpoint_sequence=2)
        assert set(plan.offers) == {
            RecoveryOffer.RESTORE_CHECKPOINT,
            RecoveryOffer.REPLAY_JOURNAL,
            RecoveryOffer.DISCARD,
        }

    def test_without_a_checkpoint_there_is_nothing_to_restore_to(self) -> None:
        plan = plan_recovery(_window((1,)))
        assert RecoveryOffer.RESTORE_CHECKPOINT not in plan.offers

    def test_keeping_the_file_as_it_is_is_always_offered(self) -> None:
        assert RecoveryOffer.DISCARD in plan_recovery(_window((1,))).offers

    def test_replaying_is_what_the_dialog_preselects(self) -> None:
        """Replaying keeps the work; the user can always choose to lose it."""
        assert plan_recovery(_window((3,)), checkpoint_sequence=2).preferred is (
            RecoveryOffer.REPLAY_JOURNAL
        )

    def test_the_plan_is_a_value(self) -> None:
        assert isinstance(plan_recovery(_window((3,)), checkpoint_sequence=2), RecoveryPlan)


class TestPickingUpAfterTheCheckpoint:
    def test_only_commands_after_the_checkpoint_are_pending(self) -> None:
        plan = plan_recovery(_window((1, 2, 3, 4)), checkpoint_sequence=2)
        assert plan.pending_commands == 2

    def test_the_checkpoint_sequence_is_reported(self) -> None:
        assert plan_recovery(_window((3,)), checkpoint_sequence=2).checkpoint_sequence == 2

    def test_entries_at_the_checkpoint_are_excluded(self) -> None:
        """Sequence 2 is baked in; replaying it would apply it twice."""
        entries = entries_after_checkpoint(_window((1, 2, 3)), checkpoint_sequence=2)
        assert [entry.sequence for entry in entries] == [3]

    def test_no_checkpoint_means_every_entry_is_pending(self) -> None:
        entries = entries_after_checkpoint(_window((1, 2, 3)))
        assert [entry.sequence for entry in entries] == [1, 2, 3]

    def test_the_entries_keep_their_order(self) -> None:
        """Replaying out of order is not the same edit."""
        entries = entries_after_checkpoint(_window((7, 4, 9)), checkpoint_sequence=3)
        assert [entry.sequence for entry in entries] == [7, 4, 9]


class TestTornTail:
    def test_a_torn_tail_is_reported(self) -> None:
        assert plan_recovery(_window((), torn=True), checkpoint_sequence=1).torn_tail is True

    def test_a_torn_tail_is_something_to_recover(self) -> None:
        """Dying mid-write is the normal state of a journal, not corruption."""
        plan = plan_recovery(_window((), torn=True), checkpoint_sequence=1)
        assert plan.is_needed is True

    def test_they_are_told_a_command_was_dropped(self) -> None:
        assert (
            "incomplete entry"
            in plan_recovery(_window((), torn=True), checkpoint_sequence=1).detail
        )

    def test_a_torn_tail_still_offers_to_replay_what_survived(self) -> None:
        plan = plan_recovery(_window((3,), torn=True), checkpoint_sequence=2)
        assert RecoveryOffer.DISCARD in plan.offers
        assert plan.pending_commands == 1

    def test_a_torn_tail_alongside_a_clean_close_still_counts(self) -> None:
        assert plan_recovery(_window((), torn=True)).is_needed is True


class TestTheSentence:
    def test_one_command_is_singular(self) -> None:
        assert "1 command was made" in plan_recovery(_window((3,)), checkpoint_sequence=2).detail

    def test_several_commands_are_plural(self) -> None:
        assert (
            "2 commands were made" in plan_recovery(_window((3, 4)), checkpoint_sequence=2).detail
        )

    def test_with_a_checkpoint_it_names_the_checkpoint(self) -> None:
        assert "checkpoint 2" in plan_recovery(_window((3,)), checkpoint_sequence=2).detail

    def test_without_a_checkpoint_it_names_the_last_save(self) -> None:
        assert "the last save" in plan_recovery(_window((1,))).detail

    def test_the_detail_ends_with_a_full_stop(self) -> None:
        assert plan_recovery(_window((3,)), checkpoint_sequence=2).detail.endswith(".")
