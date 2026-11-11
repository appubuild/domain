"""The settings editor (`services/projects/settings.py`).

These tests are about the *door*, not the five settings behind it. Three
promises are pinned, and each is one a user notices when it breaks:

1. **A change is undoable, and undoing it does not touch the edit.** Two
   stacks, because "render to 1080p" and "move this clip" are two intentions.
2. **A refused value costs nothing** — not even the redo future. A sample rate
   of zero is a refusal the panel prints, not a 500 in a log.
3. **A patch touches only what it names.** Two panels holding two settings open
   is the normal case, not an edge case.

A fourth promise — that the change survives a crash — belongs to the workspace,
and `tests/api/test_settings_router.py` pins it there against a real journal.
"""

from __future__ import annotations

import pytest

from nova_studio.core.commands import CommandContext, UndoScope
from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.media import ColourSpace
from nova_studio.domain.project import (
    DEFAULT_CHANNELS,
    DEFAULT_SAMPLE_RATE,
    FrameSize,
    ProjectSettings,
)
from nova_studio.services.projects import (
    SetSettingsCommand,
    SettingsEditor,
    SettingsStore,
    settings_store,
)

pytestmark = pytest.mark.unit


def _editor(settings: ProjectSettings | None = None) -> tuple[SettingsEditor, SettingsStore]:
    store = SettingsStore(settings or ProjectSettings())
    return SettingsEditor(store=store, project_id="p1"), store


def _empty() -> CommandContext:
    """A context with no store in it, which every command must survive."""
    return CommandContext(services=None, project_id="p1")


class TestTheDoor:
    def test_a_change_goes_through(self) -> None:
        editor, store = _editor()
        result = editor.execute(SetSettingsCommand(channels=6))

        assert result.is_ok() is True
        assert store.current().channels == 6

    def test_a_change_leaves_everything_else_alone(self) -> None:
        editor, store = _editor()
        editor.execute(SetSettingsCommand(sample_rate=44_100))

        assert store.current().channels == DEFAULT_CHANNELS
        assert store.current().use_proxies is True
        assert store.current().working_colour_space is ColourSpace.BT709

    def test_the_context_carries_the_store(self) -> None:
        editor, store = _editor()
        assert settings_store(editor.context()) is store

    def test_the_project_id_travels_with_the_context(self) -> None:
        editor, _ = _editor()
        assert editor.context().project_id == "p1"

    def test_the_change_belongs_to_the_project_stack(self) -> None:
        editor, _ = _editor()
        result = editor.execute(SetSettingsCommand(channels=6))

        assert result.is_ok() is True
        # Not `GLOBAL`: a settings change has a home, and leaving it on the
        # fallback scope is how two contexts end up sharing one Ctrl+Z.
        assert SetSettingsCommand(channels=6).scope is UndoScope.PROJECT
        assert editor.state().scope is UndoScope.PROJECT

    def test_the_context_names_the_scope_it_belongs_to(self) -> None:
        editor, _ = _editor()
        assert editor.context().scope_id == UndoScope.PROJECT.value

    def test_a_context_with_no_store_is_refused_not_crashed(self) -> None:
        editor, store = _editor()
        before = store.current()
        result = editor.execute(SetSettingsCommand(channels=6), _empty())

        assert result.is_err() is True
        assert result.unwrap_err().code == "NS-COMMAND-4104"
        assert store.current() == before

    def test_a_command_run_outside_an_editor_still_refuses(self) -> None:
        command = SetSettingsCommand(channels=6)
        result = command.execute(_empty())

        assert result.is_err() is True
        assert result.unwrap_err().code == "NS-COMMAND-4101"  # execution_failed


class TestUndo:
    def test_a_change_comes_back(self) -> None:
        editor, store = _editor()
        editor.execute(SetSettingsCommand(channels=6))
        editor.undo()

        assert store.current().channels == DEFAULT_CHANNELS

    def test_an_undone_change_comes_back_again(self) -> None:
        editor, store = _editor()
        editor.execute(SetSettingsCommand(channels=6))
        editor.undo()
        editor.redo()

        assert store.current().channels == 6

    def test_undo_restores_the_whole_value_not_one_field(self) -> None:
        editor, store = _editor()
        editor.execute(SetSettingsCommand(frame_size=FrameSize(width=3840, height=2160)))
        editor.execute(SetSettingsCommand(sample_rate=44_100))
        editor.undo()

        # The second undo put the sample rate back; the frame from the first is
        # untouched, because each command captured the settings as it found them.
        assert store.current().sample_rate == DEFAULT_SAMPLE_RATE
        assert store.current().frame_size == FrameSize(width=3840, height=2160)

    def test_two_changes_undo_in_order(self) -> None:
        editor, store = _editor()
        editor.execute(SetSettingsCommand(channels=6))
        editor.execute(SetSettingsCommand(sample_rate=44_100))
        editor.undo()
        editor.undo()

        assert store.current() == ProjectSettings()

    def test_an_empty_stack_is_not_a_failure(self) -> None:
        editor, _ = _editor()
        result = editor.undo()

        assert result.is_ok() is True
        assert result.unwrap() is None

    def test_undone_work_is_redoable_and_shown_as_such(self) -> None:
        editor, _ = _editor()
        editor.execute(SetSettingsCommand(channels=6))
        editor.undo()

        assert editor.can_redo is True
        assert editor.can_undo is False

    def test_a_second_change_drops_the_redo_future(self) -> None:
        editor, store = _editor()
        editor.execute(SetSettingsCommand(channels=6))
        editor.undo()
        editor.execute(SetSettingsCommand(sample_rate=44_100))

        assert editor.can_redo is False
        assert store.current().sample_rate == 44_100

    def test_undoing_work_that_was_never_done_is_refused(self) -> None:
        editor, _ = _editor()
        command = SetSettingsCommand(channels=6)
        result = command.undo(editor.context())

        assert result.is_err() is True
        assert result.unwrap_err().code == "NS-COMMAND-4103"  # not_executed


class TestRefusals:
    @pytest.mark.parametrize(
        ("command", "needle"),
        [
            (SetSettingsCommand(sample_rate=0), "positive"),
            (SetSettingsCommand(sample_rate=-1), "positive"),
            (SetSettingsCommand(channels=3), "channels"),
            (SetSettingsCommand(channels=0), "channels"),
            (SetSettingsCommand(working_colour_space=99), "colour space"),
        ],
        ids=["zero-rate", "negative-rate", "three-channels", "no-channels", "unknown-colour"],
    )
    def test_an_impossible_value_is_a_refusal(
        self, command: SetSettingsCommand, needle: str
    ) -> None:
        editor, store = _editor()
        result = editor.execute(command)

        assert result.is_err() is True
        assert result.unwrap_err().code == "NS-COMMAND-4104"
        assert needle in result.unwrap_err().message
        assert store.current() == ProjectSettings()

    def test_a_refusal_is_a_precondition_not_a_crash(self) -> None:
        # The whole reason the command checks before the constructor: an
        # invariant error means "bug or corrupt document", and a person typing
        # zero into a box is neither.
        editor, _ = _editor()
        result = editor.execute(SetSettingsCommand(sample_rate=0))

        assert result.unwrap_err().severity.value == "warning"

    def test_a_change_naming_nothing_is_refused(self) -> None:
        editor, store = _editor()
        result = editor.execute(SetSettingsCommand())

        assert result.is_err() is True
        assert "at least one setting" in result.unwrap_err().message
        assert store.current() == ProjectSettings()

    def test_a_refused_change_is_not_undoable(self) -> None:
        editor, _ = _editor()
        editor.execute(SetSettingsCommand(channels=3))

        assert editor.can_undo is False

    def test_a_refused_change_does_not_drop_the_redo_future(self) -> None:
        editor, _ = _editor()
        editor.execute(SetSettingsCommand(channels=6))
        editor.undo()
        editor.execute(SetSettingsCommand(channels=3))

        assert editor.can_redo is True


class TestNoOp:
    def test_asking_for_what_is_already_there_changes_nothing(self) -> None:
        editor, store = _editor()
        result = editor.execute(SetSettingsCommand(sample_rate=DEFAULT_SAMPLE_RATE))

        assert result.is_ok() is True
        assert result.unwrap().marks_dirty is False
        assert result.unwrap().rerender is False
        assert store.current() == ProjectSettings()

    def test_a_no_op_says_so(self) -> None:
        editor, _ = _editor()
        result = editor.execute(SetSettingsCommand(use_proxies=True))

        assert result.unwrap().summary == "the settings were already so"

    def test_a_no_op_does_not_ask_for_a_redraw(self) -> None:
        editor, _ = _editor()
        result = editor.execute(SetSettingsCommand(channels=DEFAULT_CHANNELS))

        assert "preview" not in result.unwrap().invalidate


class TestTheOutcome:
    def test_a_real_change_invalidates_the_picture(self) -> None:
        editor, _ = _editor()
        # 4K, because 1920×1080 is what the defaults already are and a test
        # that changed nothing would pass for the wrong reason.
        result = editor.execute(SetSettingsCommand(frame_size=FrameSize(width=3840, height=2160)))

        outcome = result.unwrap()
        assert "preview" in outcome.invalidate
        assert "settings" in outcome.invalidate
        assert outcome.rerender is True
        assert outcome.marks_dirty is True

    def test_the_summary_says_what_moved(self) -> None:
        editor, _ = _editor()
        result = editor.execute(SetSettingsCommand(channels=6, sample_rate=44_100))

        summary = result.unwrap().summary
        assert "44_100" in summary.replace("44100", "44_100") or "44100" in summary
        assert "6 channels" in summary
        assert "was 2" in summary

    def test_the_outcome_carries_the_new_settings(self) -> None:
        editor, _ = _editor()
        result = editor.execute(SetSettingsCommand(channels=6))

        payload = result.unwrap().payload["settings"]
        assert payload == editor.store.current().to_wire()

    def test_the_summary_names_the_colour_space(self) -> None:
        editor, _ = _editor()
        result = editor.execute(SetSettingsCommand(working_colour_space=ColourSpace.BT2020_NCL))

        assert "BT2020_NCL" in result.unwrap().summary
        assert "BT709" in result.unwrap().summary

    def test_the_summary_says_when_proxies_were_turned_off(self) -> None:
        editor, _ = _editor()
        result = editor.execute(SetSettingsCommand(use_proxies=False))

        assert "proxies off" in result.unwrap().summary


class TestTheJournalPayload:
    def test_a_patch_records_only_what_it_named(self) -> None:
        payload = SetSettingsCommand(channels=6).payload()

        assert payload == {"channels": 6}

    def test_a_patch_records_the_settings_not_the_result(self) -> None:
        # A replay re-applies a decision. Recording the outcome instead would
        # overwrite whatever the settings are when the replay runs.
        payload = SetSettingsCommand(
            frame_size=FrameSize(width=3840, height=2160),
            use_proxies=False,
            working_colour_space=ColourSpace.BT2020_NCL,
        ).payload()

        assert payload == {
            "frame_size": {"width": 3840, "height": 2160},
            "use_proxies": False,
            "working_colour_space": 9,
        }

    def test_an_empty_patch_records_nothing(self) -> None:
        assert SetSettingsCommand().payload() == {}

    def test_the_payload_is_json_round_trippable(self) -> None:
        import json

        payload = SetSettingsCommand(frame_size=FrameSize(width=1920, height=1080)).payload()
        assert json.loads(json.dumps(payload)) == payload


class TestTheValueObjects:
    """Where the refusals the command does *not* make actually live."""

    def test_an_impossible_frame_is_refused_by_its_own_type(self) -> None:
        with pytest.raises(NovaInvariantError):
            FrameSize(width=0, height=1080)

    def test_an_impossible_sample_rate_is_refused_by_the_settings(self) -> None:
        with pytest.raises(NovaInvariantError):
            ProjectSettings(sample_rate=0)

    def test_so_the_command_never_sees_either(self) -> None:
        # The point of the split: a value object refuses what it can prove,
        # and the command refuses what only it knows. Neither repeats the other.
        editor, _ = _editor()
        assert editor.execute(SetSettingsCommand(channels=3)).is_err() is True
        assert editor.execute(SetSettingsCommand(channels=2)).is_ok() is True


class TestTheStore:
    def test_replace_hands_back_what_it_displaced(self) -> None:
        store = SettingsStore(ProjectSettings())
        displaced = store.replace(ProjectSettings(channels=6))

        assert displaced.channels == DEFAULT_CHANNELS
        assert store.current().channels == 6

    def test_reset_starts_a_different_project(self) -> None:
        store = SettingsStore(ProjectSettings(channels=6))
        store.reset(ProjectSettings())

        assert store.current().channels == DEFAULT_CHANNELS

    def test_a_store_is_not_a_timeline_store(self) -> None:
        from nova_studio.services.timeline import TimelineStore, timeline_store

        # The two stores look alike and a context carries one of them; a
        # settings command handed a timeline must refuse rather than guess.
        store = TimelineStore(timeline=None)  # type: ignore[arg-type]
        ctx = CommandContext(services=store, project_id="p1")

        assert timeline_store(ctx) is store
        assert settings_store(ctx) is None
