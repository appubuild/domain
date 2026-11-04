"""Command pattern, undo/redo and coalescing tests (ADR-0008)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from nova_studio.core.commands import (
    Command,
    CommandContext,
    CommandError,
    CommandHistory,
    CommandOutcome,
    CommandRegistry,
    CompositeCommand,
    MemoryClass,
    UndoScope,
    UndoStack,
)
from nova_studio.core.errors import ErrorSeverity, NovaError
from nova_studio.core.result import Ok, Result, failed

pytestmark = pytest.mark.unit


@dataclass
class FakeDocument:
    """A tiny mutable document standing in for project state."""

    clips: dict[str, int] = field(default_factory=dict)
    caption_size: int | None = None
    log: list[str] = field(default_factory=list)

    def snapshot(self) -> dict[str, Any]:
        return {
            "clips": dict(self.clips),
            "caption_size": self.caption_size,
        }


@dataclass
class FakeServices:
    document: FakeDocument = field(default_factory=FakeDocument)


class AddClip(Command):
    command_id = "timeline.clip.add"
    display_name = "command.clip.add"
    scope = UndoScope.TIMELINE

    def __init__(self, services: FakeServices, clip_id: str, start: int) -> None:
        super().__init__()
        self.services = services
        self.clip_id = clip_id
        self.start = start

    def execute(self, ctx: CommandContext) -> Result[CommandOutcome]:
        self.services.document.clips[self.clip_id] = self.start
        self.services.document.log.append(f"add:{self.clip_id}")
        return Ok(
            CommandOutcome(
                affected=frozenset({self.clip_id}),
                invalidate=frozenset({"timeline", "preview"}),
                summary=f"Added {self.clip_id}",
            )
        )

    def undo(self, ctx: CommandContext) -> Result[None]:
        self.services.document.clips.pop(self.clip_id, None)
        self.services.document.log.append(f"unadd:{self.clip_id}")
        return Ok(None)


class MoveClip(Command):
    """A coalescible command: one undo step per drag gesture."""

    command_id = "timeline.clip.move"
    display_name = "command.clip.move"
    scope = UndoScope.TIMELINE
    coalescible = True

    def __init__(self, services: FakeServices, clip_id: str, start: int, gesture: str) -> None:
        super().__init__()
        self.services = services
        self.clip_id = clip_id
        self.start = start
        self.gesture = gesture
        self.original: int | None = None

    def merge_key(self) -> tuple[str, str]:
        return (self.clip_id, self.gesture)

    def merge_into(self, previous: Command) -> Command:
        assert isinstance(previous, MoveClip)
        merged = MoveClip(self.services, self.clip_id, self.start, self.gesture)
        # Keep the *original* position so undo returns to the gesture's start.
        merged.original = previous.original
        return merged

    def execute(self, ctx: CommandContext) -> Result[CommandOutcome]:
        if self.original is None:
            self.original = self.services.document.clips.get(self.clip_id)
        self.services.document.clips[self.clip_id] = self.start
        return Ok(CommandOutcome(affected=frozenset({self.clip_id})))

    def undo(self, ctx: CommandContext) -> Result[None]:
        if self.original is None:
            self.services.document.clips.pop(self.clip_id, None)
        else:
            self.services.document.clips[self.clip_id] = self.original
        return Ok(None)


class StyleCaption(Command):
    command_id = "caption.style"
    display_name = "command.caption.style"
    scope = UndoScope.CAPTION

    def __init__(self, services: FakeServices, size: int) -> None:
        super().__init__()
        self.services = services
        self.size = size
        self.previous: int | None = None

    def execute(self, ctx: CommandContext) -> Result[CommandOutcome]:
        self.previous = self.services.document.caption_size
        self.services.document.caption_size = self.size
        return Ok(CommandOutcome(rerender=True, invalidate=frozenset({"preview"})))

    def undo(self, ctx: CommandContext) -> Result[None]:
        self.services.document.caption_size = self.previous
        return Ok(None)


class RejectedCommand(Command):
    command_id = "timeline.rejected"
    display_name = "command.rejected"

    def validate(self, ctx: CommandContext) -> Result[None]:
        return failed(NovaError("NS-TIMELINE-4301", "track is locked"))

    def execute(self, ctx: CommandContext) -> Result[CommandOutcome]:
        raise AssertionError("execute must not run when validate rejects")

    def undo(self, ctx: CommandContext) -> Result[None]:
        return Ok(None)


class FailingCommand(Command):
    command_id = "timeline.failing"
    display_name = "command.failing"

    def execute(self, ctx: CommandContext) -> Result[CommandOutcome]:
        return failed(NovaError("NS-TIMELINE-5001", "decoder exploded"))

    def undo(self, ctx: CommandContext) -> Result[None]:
        return Ok(None)


class MutatingThenFailing(Command):
    """A badly behaved child: mutates and then reports failure."""

    command_id = "timeline.bad_child"
    display_name = "command.bad_child"

    def __init__(self, services: FakeServices, clip_id: str) -> None:
        super().__init__()
        self.services = services
        self.clip_id = clip_id

    def execute(self, ctx: CommandContext) -> Result[CommandOutcome]:
        self.services.document.clips[self.clip_id] = 999
        return failed(NovaError("NS-TIMELINE-5002", "failed after mutating"))

    def undo(self, ctx: CommandContext) -> Result[None]:
        self.services.document.clips.pop(self.clip_id, None)
        return Ok(None)


@pytest.fixture
def services() -> FakeServices:
    return FakeServices()


@pytest.fixture
def context(services: FakeServices) -> CommandContext:
    return CommandContext(services=services, project_id="p1")


class TestCommandExecution:
    def test_execute_applies_and_records(
        self, command_history: CommandHistory, services: FakeServices, context: CommandContext
    ) -> None:
        result = command_history.execute(AddClip(services, "c1", 10), context)
        assert result.is_ok()
        assert services.document.clips == {"c1": 10}
        outcome = result.unwrap()
        assert outcome.affected == frozenset({"c1"})
        assert outcome.invalidate == frozenset({"timeline", "preview"})
        assert command_history.state(UndoScope.TIMELINE).undo_depth == 1

    def test_rejected_command_never_executes(
        self, command_history: CommandHistory, context: CommandContext
    ) -> None:
        result = command_history.execute(RejectedCommand(), context)
        assert result.is_err()
        assert result.unwrap_err().code == "NS-TIMELINE-4301"
        assert command_history.state(UndoScope.TIMELINE).undo_depth == 0
        assert command_history.state(UndoScope.TIMELINE).can_undo is False

    def test_failed_command_does_not_consume_history(
        self,
        command_history: CommandHistory,
        services: FakeServices,
        context: CommandContext,
    ) -> None:
        command_history.execute(AddClip(services, "c1", 0), context)
        before = command_history.state(UndoScope.TIMELINE).undo_depth
        result = command_history.execute(FailingCommand(), context)
        assert result.is_err()
        assert command_history.state(UndoScope.TIMELINE).undo_depth == before
        assert command_history.stats()["failed"] == 1

    def test_events_are_published_for_execute_undo_redo(
        self,
        command_history: CommandHistory,
        captured_events: Any,
        services: FakeServices,
        context: CommandContext,
    ) -> None:
        command_history.execute(AddClip(services, "c1", 0), context)
        command_history.undo(UndoScope.TIMELINE, context)
        command_history.redo(UndoScope.TIMELINE, context)
        topics = captured_events.topics()
        assert "command.executed" in topics
        assert "command.reverted" in topics
        executed = captured_events.payloads("command.executed")[-1]
        assert executed["command_id"] == "timeline.clip.add"
        assert executed["affected"] == ["c1"]
        assert executed["duration_ms"] >= 0
        reverted = captured_events.payloads("command.reverted")
        assert [item["direction"] for item in reverted] == ["undo", "redo"]

    def test_failure_event_carries_the_structured_error(
        self,
        command_history: CommandHistory,
        captured_events: Any,
        context: CommandContext,
    ) -> None:
        command_history.execute(FailingCommand(), context)
        payload = captured_events.payloads("command.failed")[-1]
        assert payload["phase"] == "execute"
        assert payload["error"]["code"] == "NS-TIMELINE-5001"


class TestUndoRedo:
    def test_undo_restores_and_redo_reapplies(
        self,
        command_history: CommandHistory,
        services: FakeServices,
        context: CommandContext,
    ) -> None:
        command_history.execute(AddClip(services, "c1", 42), context)
        assert services.document.clips == {"c1": 42}

        undone = command_history.undo(UndoScope.TIMELINE, context)
        assert undone.is_ok()
        assert services.document.clips == {}
        state = command_history.state(UndoScope.TIMELINE)
        assert state.can_undo is False
        assert state.can_redo is True
        assert state.redo_label == "command.clip.add"

        redone = command_history.redo(UndoScope.TIMELINE, context)
        assert redone.is_ok()
        assert services.document.clips == {"c1": 42}

    def test_undo_on_empty_stack_is_ok_none(
        self, command_history: CommandHistory, context: CommandContext
    ) -> None:
        """An empty stack is not an error: stale menu clicks are benign."""
        result = command_history.undo(UndoScope.TIMELINE, context)
        assert result.is_ok()
        assert result.unwrap() is None

    def test_redo_is_cleared_by_a_new_command(
        self,
        command_history: CommandHistory,
        services: FakeServices,
        context: CommandContext,
    ) -> None:
        command_history.execute(AddClip(services, "c1", 0), context)
        command_history.execute(AddClip(services, "c2", 0), context)
        command_history.undo(UndoScope.TIMELINE, context)
        assert command_history.state(UndoScope.TIMELINE).can_redo is True
        command_history.execute(AddClip(services, "c3", 0), context)
        assert command_history.state(UndoScope.TIMELINE).can_redo is False

    def test_scopes_are_independent(
        self,
        command_history: CommandHistory,
        services: FakeServices,
        context: CommandContext,
    ) -> None:
        """The core ADR-0008 property: caption undo must not touch the timeline."""
        command_history.execute(AddClip(services, "c1", 0), context)
        command_history.execute(StyleCaption(services, 48), context)
        assert command_history.state(UndoScope.TIMELINE).undo_depth == 1
        assert command_history.state(UndoScope.CAPTION).undo_depth == 1

        command_history.undo(UndoScope.CAPTION, context)
        assert services.document.caption_size is None
        assert services.document.clips == {"c1": 0}
        assert command_history.state(UndoScope.TIMELINE).undo_depth == 1
        assert command_history.state(UndoScope.TIMELINE).can_undo is True

    def test_undo_of_unknown_scope_reports_a_precondition_error(
        self, command_history: CommandHistory, context: CommandContext
    ) -> None:
        history = CommandHistory(scopes=[UndoScope.TIMELINE])
        result = history.undo(UndoScope.CAPTION, context)
        assert result.is_err()
        assert result.unwrap_err().code == "NS-COMMAND-4104"
        assert command_history.state(UndoScope.CAPTION).can_undo is False

    def test_clear_resets_history(
        self,
        command_history: CommandHistory,
        services: FakeServices,
        context: CommandContext,
    ) -> None:
        command_history.execute(AddClip(services, "c1", 0), context)
        command_history.execute(StyleCaption(services, 12), context)
        command_history.clear(UndoScope.CAPTION)
        assert command_history.state(UndoScope.CAPTION).can_undo is False
        assert command_history.state(UndoScope.TIMELINE).can_undo is True
        command_history.clear()
        assert all(state.can_undo is False for state in command_history.all_states().values())

    def test_history_listing(
        self,
        command_history: CommandHistory,
        services: FakeServices,
        context: CommandContext,
    ) -> None:
        command_history.execute(AddClip(services, "c1", 0), context)
        command_history.execute(AddClip(services, "c2", 0), context)
        entries = command_history.stack_for(UndoScope.TIMELINE).history()
        assert len(entries) == 2
        assert all("timeline.clip.add" in entry for entry in entries)


class TestCoalescing:
    def test_a_drag_becomes_one_undo_step(
        self,
        command_history: CommandHistory,
        fake_clock: Any,
        services: FakeServices,
    ) -> None:
        context = CommandContext(services=services, project_id="p1", clock=fake_clock.monotonic)
        command_history.execute(AddClip(services, "c1", 0), context)
        for position in (10, 20, 30, 40, 50):
            fake_clock.advance(0.05)
            command_history.execute(MoveClip(services, "c1", position, "g1"), context)

        assert services.document.clips == {"c1": 50}
        state = command_history.state(UndoScope.TIMELINE)
        assert state.undo_depth == 2, "five moves must collapse into one step"
        assert state.undo_label == "command.clip.move"
        assert command_history.stats()["coalesced"] == 4

        command_history.undo(UndoScope.TIMELINE, context)
        assert services.document.clips == {"c1": 0}, (
            "undo must return to the gesture's start, not the previous mouse move"
        )

    def test_separate_gestures_do_not_merge(
        self,
        command_history: CommandHistory,
        fake_clock: Any,
        services: FakeServices,
    ) -> None:
        context = CommandContext(services=services, project_id="p1", clock=fake_clock.monotonic)
        command_history.execute(AddClip(services, "c1", 0), context)
        fake_clock.advance(0.05)
        command_history.execute(MoveClip(services, "c1", 10, "g1"), context)
        fake_clock.advance(0.05)
        command_history.execute(MoveClip(services, "c1", 20, "g1"), context)
        # A different gesture token starts a new step.
        fake_clock.advance(0.05)
        command_history.execute(MoveClip(services, "c1", 30, "g2"), context)
        assert command_history.state(UndoScope.TIMELINE).undo_depth == 3

    def test_the_coalescing_window_is_respected(
        self,
        command_history: CommandHistory,
        fake_clock: Any,
        services: FakeServices,
    ) -> None:
        context = CommandContext(services=services, project_id="p1", clock=fake_clock.monotonic)
        command_history.execute(AddClip(services, "c1", 0), context)
        fake_clock.advance(0.05)
        command_history.execute(MoveClip(services, "c1", 10, "g1"), context)
        # Beyond the 0.7 s window this is a new user action, not the same gesture.
        fake_clock.advance(5.0)
        command_history.execute(MoveClip(services, "c1", 20, "g1"), context)
        assert command_history.state(UndoScope.TIMELINE).undo_depth == 3

    def test_different_targets_do_not_merge(
        self,
        command_history: CommandHistory,
        fake_clock: Any,
        services: FakeServices,
    ) -> None:
        context = CommandContext(services=services, project_id="p1", clock=fake_clock.monotonic)
        command_history.execute(AddClip(services, "c1", 0), context)
        command_history.execute(AddClip(services, "c2", 0), context)
        fake_clock.advance(0.05)
        command_history.execute(MoveClip(services, "c1", 10, "g1"), context)
        fake_clock.advance(0.05)
        command_history.execute(MoveClip(services, "c2", 10, "g1"), context)
        assert command_history.state(UndoScope.TIMELINE).undo_depth == 4

    def test_merge_into_is_required_for_coalescible_commands(self) -> None:
        """Declaring coalescible without implementing merge is a build-time bug."""

        class Lazy(Command):
            command_id = "lazy"
            display_name = "lazy"
            coalescible = True

            def merge_key(self) -> str:
                return "same-gesture"

            def execute(self, ctx: CommandContext) -> Result[CommandOutcome]:
                return Ok(CommandOutcome.none())

            def undo(self, ctx: CommandContext) -> Result[None]:
                return Ok(None)

        first, second = Lazy(), Lazy()
        first.mark_executed(0.5, 0.0)
        second.mark_executed(1.0, 0.0)
        assert second.can_merge(first, 0.5) is True
        with pytest.raises(NotImplementedError, match="merge_into"):
            second.merge_into(first)

    def test_commands_without_a_merge_key_never_coalesce(self) -> None:
        """A coalescible flag alone is not enough; the key decides the gesture."""
        services = FakeServices()
        first = AddClip(services, "c1", 0)
        second = AddClip(services, "c2", 0)
        first.coalescible = True
        second.coalescible = True
        first.mark_executed(0.0, 0.0)
        second.mark_executed(0.1, 0.0)
        assert first.merge_key() is None
        assert second.can_merge(first, 0.1) is False

    def test_different_command_types_never_merge(self) -> None:
        services = FakeServices()
        move = MoveClip(services, "c1", 10, "g1")
        add = AddClip(services, "c1", 10)
        add.coalescible = True
        move.mark_executed(0.0, 0.0)
        assert move.can_merge(add, 0.0) is False


class TestCompositeCommand:
    def test_scope_widens_across_contexts(
        self, services: FakeServices, context: CommandContext
    ) -> None:
        composite = CompositeCommand([AddClip(services, "c1", 0), StyleCaption(services, 24)])
        assert composite.scope is UndoScope.GLOBAL
        single = CompositeCommand([AddClip(services, "c1", 0)])
        assert single.scope is UndoScope.TIMELINE

    def test_derived_command_id(self, services: FakeServices, context: CommandContext) -> None:
        composite = CompositeCommand([AddClip(services, "c1", 0), StyleCaption(services, 24)])
        assert composite.command_id == "composite[caption.style+timeline.clip.add]"

    def test_empty_composite_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="at least one child"):
            CompositeCommand([])

    def test_all_or_nothing_on_child_failure(
        self,
        command_history: CommandHistory,
        services: FakeServices,
        context: CommandContext,
    ) -> None:
        composite = CompositeCommand(
            [
                AddClip(services, "c1", 0),
                AddClip(services, "c2", 0),
                FailingCommand(),
            ]
        )
        result = command_history.execute(composite, context)
        assert result.is_err()
        assert services.document.clips == {}, "every child must be rolled back"
        assert command_history.state(UndoScope.GLOBAL).undo_depth == 0

    def test_failing_child_is_asked_to_clean_up_after_itself(
        self,
        command_history: CommandHistory,
        services: FakeServices,
        context: CommandContext,
    ) -> None:
        """Defence in depth: a child that mutates then fails is still reverted.

        Commands are contracted to be atomic, so this path should never be needed;
        it exists because a leak here would silently corrupt a project.
        """
        composite = CompositeCommand(
            [AddClip(services, "c1", 0), MutatingThenFailing(services, "c9")]
        )
        result = command_history.execute(composite, context)
        assert result.is_err()
        assert result.unwrap_err().code == "NS-TIMELINE-5002"
        assert services.document.clips == {}

    def test_composite_undo_reverts_everything(
        self,
        command_history: CommandHistory,
        services: FakeServices,
        context: CommandContext,
    ) -> None:
        composite = CompositeCommand([AddClip(services, "c1", 1), StyleCaption(services, 36)])
        command_history.execute(composite, context)
        assert services.document.clips == {"c1": 1}
        assert services.document.caption_size == 36

        command_history.undo(UndoScope.GLOBAL, context)
        assert services.document.clips == {}
        assert services.document.caption_size is None

    def test_validation_failure_prevents_execution(
        self,
        command_history: CommandHistory,
        services: FakeServices,
        context: CommandContext,
    ) -> None:
        composite = CompositeCommand([AddClip(services, "c1", 0), RejectedCommand()])
        result = command_history.execute(composite, context)
        assert result.is_err()
        assert result.unwrap_err().code == "NS-TIMELINE-4301"
        assert services.document.clips == {}


class TestUndoStackLimits:
    def test_entry_budget_is_enforced(self) -> None:
        stack = UndoStack(UndoScope.TIMELINE, max_entries=3, max_heavy_entries=3)
        services = FakeServices()
        for index in range(6):
            command = AddClip(services, f"c{index}", index)
            command.mark_executed(float(index), 0.0)
            stack.push(command)
        assert stack.undo_depth == 3
        # The oldest entries are the ones that fall off.
        assert len(stack.history()) == 3

    def test_heavy_commands_are_evicted_first(self) -> None:
        stack = UndoStack(UndoScope.TIMELINE, max_entries=4, max_heavy_entries=1)
        services = FakeServices()

        def light(index: int) -> Command:
            command = AddClip(services, f"c{index}", index)
            command.mark_executed(float(index), 0.0)
            return command

        heavy = AddClip(services, "heavy", 0)
        heavy.memory_class = MemoryClass.HEAVY
        heavy.mark_executed(0.0, 0.0)

        for command in (light(1), light(2), heavy, light(3), light(4), light(5)):
            stack.push(command)
        assert stack.undo_depth <= 4
        retained = [stack.pop_undo() for _ in range(stack.undo_depth)]
        assert retained
        heavy_retained = sum(
            1 for item in retained if item is not None and item.memory_class is MemoryClass.HEAVY
        )
        assert heavy_retained <= 1, "heavy deltas must be evicted before light ones"

    def test_rejects_invalid_budget(self) -> None:
        with pytest.raises(ValueError, match="max_entries must be >= 1"):
            UndoStack(UndoScope.TIMELINE, max_entries=0)

    def test_state_snapshot(self) -> None:
        stack = UndoStack(UndoScope.CAPTION)
        state = stack.state()
        assert state.scope is UndoScope.CAPTION
        assert state.can_undo is False
        assert state.can_redo is False
        assert state.undo_label == ""
        assert len(stack) == 0

    def test_scope_lookup_rejects_disabled_scope(self) -> None:
        history = CommandHistory(scopes=[UndoScope.TIMELINE])
        with pytest.raises(KeyError, match="not enabled"):
            history.stack_for(UndoScope.CAPTION)


class TestCommandRegistry:
    def test_register_and_lookup(self, command_registry: CommandRegistry) -> None:
        command_registry.register(AddClip)
        assert command_registry.get("timeline.clip.add") is AddClip
        assert "timeline.clip.add" in command_registry
        assert len(command_registry) == 1
        assert command_registry.ids() == ["timeline.clip.add"]

    def test_usable_as_a_decorator(self, command_registry: CommandRegistry) -> None:
        @command_registry.register
        class CustomCommand(Command):
            command_id = "custom"
            display_name = "custom"

            def execute(self, ctx: CommandContext) -> Result[CommandOutcome]:
                return Ok(CommandOutcome.none())

            def undo(self, ctx: CommandContext) -> Result[None]:
                return Ok(None)

        assert command_registry.get("custom") is CustomCommand

    def test_requires_a_command_id(self, command_registry: CommandRegistry) -> None:
        class Anonymous(Command):
            def execute(self, ctx: CommandContext) -> Result[CommandOutcome]:
                return Ok(CommandOutcome.none())

            def undo(self, ctx: CommandContext) -> Result[None]:
                return Ok(None)

        with pytest.raises(ValueError, match="non-empty command_id"):
            command_registry.register(Anonymous)

    def test_rejects_duplicate_ids(self, command_registry: CommandRegistry) -> None:
        """Two different classes claiming one id is a build-time bug."""
        command_registry.register(AddClip)

        class Impostor(Command):
            command_id = AddClip.command_id
            display_name = "impostor"

            def execute(self, ctx: CommandContext) -> Result[CommandOutcome]:
                return Ok(CommandOutcome.none())

            def undo(self, ctx: CommandContext) -> Result[None]:
                return Ok(None)

        with pytest.raises(ValueError, match="already registered"):
            command_registry.register(Impostor)
        # Re-registering the same class is idempotent, so repeated imports are safe.
        command_registry.register(AddClip)
        assert len(command_registry) == 1
        assert command_registry.get(AddClip.command_id) is AddClip

    def test_distinct_ids_coexist(self, command_registry: CommandRegistry) -> None:
        command_registry.register(AddClip)
        command_registry.register(MoveClip)
        command_registry.register(StyleCaption)
        assert len(command_registry) == 3

    def test_metadata_for_the_shortcut_editor(self, command_registry: CommandRegistry) -> None:
        command_registry.register(AddClip)
        command_registry.register(StyleCaption)
        metadata = command_registry.metadata()
        assert [item["command_id"] for item in metadata] == [
            "caption.style",
            "timeline.clip.add",
        ]
        first = metadata[0]
        assert first["scope"] == "caption"
        assert first["display_name"] == "command.caption.style"
        assert first["coalescible"] is False


class TestCommandOutcome:
    def test_none_outcome_marks_nothing_dirty(self) -> None:
        outcome = CommandOutcome.none()
        assert outcome.marks_dirty is False
        assert outcome.rerender is False
        assert outcome.affected == frozenset()

    def test_defaults(self) -> None:
        outcome = CommandOutcome()
        assert outcome.marks_dirty is True
        assert outcome.rerender is True
        assert outcome.payload == {}


class TestCommandErrors:
    def test_undo_failure_is_critical(self) -> None:
        """A failed undo risks data loss, so it must be surfaced at CRITICAL."""
        built = CommandError.undo_failed("clip.move", "state gone")
        assert built.severity is ErrorSeverity.CRITICAL
        assert built.remedy is not None
        assert built.code == "NS-COMMAND-4102"

    def test_precondition_failure_is_only_a_warning(self) -> None:
        built = CommandError.precondition("clip.move", "track locked")
        assert built.severity is ErrorSeverity.WARNING

    def test_codes_are_stable_and_distinct(self) -> None:
        codes = {
            CommandError.execution_failed("a", "b").code,
            CommandError.undo_failed("a", "b").code,
            CommandError.not_executed("a").code,
            CommandError.precondition("a", "b").code,
        }
        assert len(codes) == 4
        assert codes == {
            "NS-COMMAND-4101",
            "NS-COMMAND-4102",
            "NS-COMMAND-4103",
            "NS-COMMAND-4104",
        }


class TestCommandRoundTrip:
    """The property ADR-0016 requires of every command: execute → undo is exact."""

    @pytest.mark.parametrize(
        "scope",
        [UndoScope.TIMELINE, UndoScope.CAPTION, UndoScope.COLOUR],
    )
    def test_every_registered_command_round_trips(
        self,
        scope: UndoScope,
        command_history: CommandHistory,
        services: FakeServices,
        context: CommandContext,
    ) -> None:
        before = services.document.snapshot()
        command: Command
        if scope is UndoScope.TIMELINE:
            command = AddClip(services, "c1", 15)
        elif scope is UndoScope.CAPTION:
            command = StyleCaption(services, 42)
        else:
            command = AddClip(services, "c1", 15)
            command.scope = scope

        result = command_history.execute(command, context)
        assert result.is_ok()
        assert services.document.snapshot() != before or scope is UndoScope.COLOUR

        undone = command_history.undo(scope, context)
        assert undone.is_ok()
        assert services.document.snapshot() == before, (
            f"{command.command_id} did not restore state exactly"
        )
