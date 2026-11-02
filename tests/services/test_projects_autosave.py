"""The autosave state machine (`services/projects/autosave.py`).

The guarantee under test is a sentence a user can hold Nova Studio to: **you
lose at most N commands or T seconds of work.** Every test here is a way of
saying that sentence, or a way of breaking it.
"""

from __future__ import annotations

import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.persistence import CheckpointPolicy, RevisionRef, revisions_to_prune
from nova_studio.services.projects import DEFAULT_AUTOSAVE, AutosaveState

pytestmark = pytest.mark.unit

T0 = 1_700_000_000_000


def _policy(**over: object) -> CheckpointPolicy:
    return CheckpointPolicy(**over)  # type: ignore[arg-type]


def _revisions(count: int) -> tuple[RevisionRef, ...]:
    return tuple(
        RevisionRef(sequence=index + 1, recorded_at_ms=T0 + index, label=f"r{index}")
        for index in range(count)
    )


class TestDefaults:
    def test_the_defaults_are_a_reviewable_sentence(self) -> None:
        """200 commands or two minutes, keeping five — ADR-0015 §6."""
        assert DEFAULT_AUTOSAVE.commands_between_checkpoints == 200
        assert DEFAULT_AUTOSAVE.seconds_between_checkpoints == 120
        assert DEFAULT_AUTOSAVE.max_revisions == 5

    def test_a_fresh_state_has_nothing_due(self) -> None:
        assert AutosaveState().due(now_ms=T0) is False

    def test_a_fresh_state_has_never_checkpointed(self) -> None:
        assert AutosaveState().has_checkpointed is False


class TestWiring:
    def test_a_state_can_be_built_with_any_policy(self) -> None:
        assert AutosaveState(policy=_policy(commands_between_checkpoints=3)).commands_since == 0

    def test_a_negative_command_count_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError):
            AutosaveState(commands_since=-1)

    def test_a_negative_timestamp_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError):
            AutosaveState(last_checkpoint_ms=-1)


class TestRecording:
    def test_recording_counts_a_command(self) -> None:
        assert AutosaveState().recorded(at_ms=T0).commands_since == 1

    def test_recording_can_count_a_batch(self) -> None:
        assert AutosaveState().recorded(at_ms=T0, commands=7).commands_since == 7

    def test_recording_nothing_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError):
            AutosaveState().recorded(at_ms=T0, commands=0)

    def test_the_first_record_starts_the_clock(self) -> None:
        state = AutosaveState().recorded(at_ms=T0)
        assert state.last_checkpoint_ms == T0

    def test_a_later_record_does_not_move_the_clock(self) -> None:
        """Otherwise a long session would checkpoint after every command."""
        state = AutosaveState().recorded(at_ms=T0).recorded(at_ms=T0 + 500_000)
        assert state.last_checkpoint_ms == T0

    def test_recording_returns_a_new_state(self) -> None:
        state = AutosaveState()
        assert state.recorded(at_ms=T0) is not state
        assert state.commands_since == 0


class TestCommandLimit:
    def test_nothing_is_due_before_the_limit(self) -> None:
        state = AutosaveState(policy=_policy(commands_between_checkpoints=3))
        assert state.recorded(at_ms=T0, commands=2).due(now_ms=T0) is False

    def test_the_limit_is_reached_on_the_nth_command(self) -> None:
        state = AutosaveState(policy=_policy(commands_between_checkpoints=3))
        assert state.recorded(at_ms=T0, commands=3).due(now_ms=T0) is True

    def test_the_limit_wins_over_a_stood_still_clock(self) -> None:
        """A burst of commands is worth saving even if no time has passed."""
        state = AutosaveState(policy=_policy(commands_between_checkpoints=2))
        assert state.recorded(at_ms=T0, commands=5).due(now_ms=T0) is True

    def test_the_countdown_is_what_the_status_bar_shows(self) -> None:
        state = AutosaveState(policy=_policy(commands_between_checkpoints=3))
        assert state.recorded(at_ms=T0, commands=1).commands_until_due() == 2

    def test_the_countdown_never_goes_negative(self) -> None:
        state = AutosaveState(policy=_policy(commands_between_checkpoints=3))
        assert state.recorded(at_ms=T0, commands=9).commands_until_due() == 0


class TestTimeLimit:
    def test_nothing_is_due_before_the_interval(self) -> None:
        state = AutosaveState(policy=_policy(seconds_between_checkpoints=60))
        assert state.recorded(at_ms=T0).due(now_ms=T0 + 59_000) is False

    def test_the_interval_alone_is_enough(self) -> None:
        """One careful edit and two minutes is worth saving too."""
        state = AutosaveState(policy=_policy(seconds_between_checkpoints=60))
        assert state.recorded(at_ms=T0).due(now_ms=T0 + 60_000) is True

    def test_a_clock_that_moved_backwards_does_not_force_a_checkpoint(self) -> None:
        state = AutosaveState(policy=_policy(seconds_between_checkpoints=60))
        assert state.recorded(at_ms=T0).due(now_ms=T0 - 60_000) is False


class TestCheckpointing:
    def test_checkpointing_resets_the_counter(self) -> None:
        state = AutosaveState().recorded(at_ms=T0, commands=9).checkpointed(at_ms=T0 + 1_000)
        assert state.commands_since == 0
        assert state.due(now_ms=T0 + 1_000) is False

    def test_checkpointing_moves_the_clock(self) -> None:
        state = AutosaveState().recorded(at_ms=T0).checkpointed(at_ms=T0 + 10_000)
        assert state.last_checkpoint_ms == T0 + 10_000

    def test_a_state_that_has_checkpointed_says_so(self) -> None:
        assert AutosaveState().checkpointed(at_ms=T0).has_checkpointed is True

    def test_the_guarantee_holds_across_a_whole_session(self) -> None:
        """Two hundred commands, checkpoint, two hundred more — never lost."""
        state = AutosaveState()
        for _ in range(199):
            state = state.recorded(at_ms=T0)
            assert state.due(now_ms=T0) is False
        state = state.recorded(at_ms=T0)
        assert state.due(now_ms=T0) is True
        state = state.checkpointed(at_ms=T0 + 1_000)
        assert state.due(now_ms=T0 + 1_000) is False


class TestPruning:
    def test_nothing_is_pruned_within_the_bound(self) -> None:
        assert AutosaveState().revisions_to_drop(_revisions(3)) == ()

    def test_the_oldest_goes_first(self) -> None:
        dropped = AutosaveState().revisions_to_drop(_revisions(6))
        assert [revision.sequence for revision in dropped] == [1]

    def test_pruning_keeps_the_newest_n(self) -> None:
        revisions = _revisions(8)
        dropped = AutosaveState().revisions_to_drop(revisions)
        assert len(revisions) - len(dropped) == DEFAULT_AUTOSAVE.max_revisions

    def test_a_tighter_policy_prunes_sooner(self) -> None:
        state = AutosaveState(policy=_policy(max_revisions=2))
        assert len(state.revisions_to_drop(_revisions(4))) == 2

    def test_pruning_agrees_with_the_domain_rule(self) -> None:
        """The state is a convenience, not a second opinion."""
        revisions = _revisions(7)
        state = AutosaveState()
        assert state.revisions_to_drop(revisions) == revisions_to_prune(
            revisions, DEFAULT_AUTOSAVE.max_revisions
        )
