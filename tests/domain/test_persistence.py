"""The persistence vocabulary: manifests, revisions, journal entries, cache.

Three properties are worth pinning here, because each is easy to lose in a
refactor and expensive to discover in production:

1. **Canonical wire forms.**  A ``.nova`` file is read by migrations, by the
   recovery service and by support engineers, so every ``to_wire``/``from_wire``
   pair round-trips through a real JSON boundary and rejects a malformed
   document instead of half-parsing it.
2. **Time arrives as data.**  Nothing here reads a clock; the tests prove that
   two objects built a minute apart are distinguishable, and that moving a
   timestamp backwards is refused rather than silently accepted.
3. **Policy is decidable without I/O.**  ``CheckpointPolicy`` and
   ``select_for_eviction`` are the two places where "how careful are we?" and
   "how greedy is the cache?" are answered; both are pure, so both are tested
   exhaustively rather than mocked.

Also covered: the document-name rules, which are a security boundary — a
``.nova`` file is a ZIP and an entry name is untrusted input.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import pytest

from nova_studio.core.errors import NovaInvariantError
from nova_studio.domain.media import ContentHash
from nova_studio.domain.persistence import (
    CacheBudget,
    CacheEntry,
    CacheKind,
    CheckpointPolicy,
    JournalEntry,
    JournalWindow,
    ProjectManifest,
    RevisionRef,
    caption_document,
    is_valid_document_name,
    revision_document,
    revisions_to_prune,
    select_for_eviction,
)

if TYPE_CHECKING:
    from collections.abc import Mapping

pytestmark = pytest.mark.unit

DIGEST = "ab" * 32
T0 = 1_700_000_000_000


def _manifest(**overrides: Any) -> ProjectManifest:
    defaults: dict[str, Any] = {
        "project_id": "01999999-0000-7000-8000-000000000000",
        "format_version": 1,
        "app_version": "0.1.0",
        "created_ms": T0,
        "modified_ms": T0,
    }
    return ProjectManifest(**{**defaults, **overrides})


def _entry(
    key: str, *, last_used_ms: int = T0, size_bytes: int = 100, **overrides: Any
) -> CacheEntry:
    defaults: dict[str, Any] = {
        "key": key,
        "kind": CacheKind.THUMBNAIL,
        "size_bytes": size_bytes,
        "created_ms": T0,
        "last_used_ms": last_used_ms,
    }
    return CacheEntry(**{**defaults, **overrides})


def _round_trip(wire: Mapping[str, Any]) -> Mapping[str, Any]:
    """Force a real JSON boundary: no enums, no tuples, no Python-only types."""
    return json.loads(json.dumps(wire))


class TestDocumentNames:
    def test_revisions_are_zero_padded_so_lexical_order_is_chronological(self) -> None:
        assert revision_document(0) == "timeline/revisions/000000.json"
        assert revision_document(7) == "timeline/revisions/000007.json"
        assert revision_document(7) < revision_document(8)

    def test_a_negative_revision_is_rejected(self) -> None:
        with pytest.raises(NovaInvariantError, match="must not be negative"):
            revision_document(-1)

    def test_caption_documents_live_under_their_prefix(self) -> None:
        assert caption_document("interview") == "captions/interview.json"

    def test_a_caption_id_may_not_escape_its_directory(self) -> None:
        with pytest.raises(NovaInvariantError, match="bare name"):
            caption_document("../../evil")

    @pytest.mark.parametrize(
        ("name", "valid"),
        [
            ("manifest.json", True),
            ("timeline/document.json", True),
            ("media/thumb/asset.jpg", True),
            ("", False),
            ("/etc/passwd", False),
            ("../escape.json", False),
            ("timeline/../../escape.json", False),
            ("timeline\\document.json", False),
            ("C:/windows/win.ini", False),
            ("timeline/", False),
            ("timeline//document.json", False),
            ("timeline/./document.json", False),
        ],
    )
    def test_zip_slip_names_are_rejected(self, name: str, valid: bool) -> None:
        """A crafted entry name is an attack, not a project."""
        assert is_valid_document_name(name) is valid


class TestProjectManifest:
    def test_the_wire_form_survives_a_json_boundary(self) -> None:
        manifest = _manifest(modified_ms=T0 + 60_000)
        assert ProjectManifest.from_wire(_round_trip(manifest.to_wire())) == manifest

    def test_a_newer_format_is_recognised_not_guessed(self) -> None:
        """ADR-0015 rule 5: refuse, never partially parse."""
        manifest = _manifest(format_version=2)
        assert manifest.is_from_a_newer_format(1)
        assert not _manifest(format_version=1).is_from_a_newer_format(1)

    def test_touching_records_a_later_modification(self) -> None:
        assert _manifest().touched(T0 + 1_000).modified_ms == T0 + 1_000

    def test_touching_cannot_go_backwards(self) -> None:
        with pytest.raises(NovaInvariantError, match="backwards"):
            _manifest(modified_ms=T0).touched(T0 - 1)

    @pytest.mark.parametrize(
        ("overrides", "fragment"),
        [
            ({"project_id": ""}, "project id"),
            ({"format_version": 0}, "format version must be positive"),
            ({"app_version": ""}, "app version"),
            ({"created_ms": -1}, "must not be negative"),
            ({"modified_ms": T0 - 1}, "must not precede created_ms"),
        ],
    )
    def test_invariants_are_checked_at_construction(
        self, overrides: dict[str, Any], fragment: str
    ) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            _manifest(**overrides)

    @pytest.mark.parametrize(
        ("mutation", "fragment"),
        [
            ({"format_version": True}, "must be an int"),
            ({"project_id": 7}, "must be a str"),
            ({"unknown": 1}, "fields must be exactly"),
        ],
    )
    def test_a_corrupt_manifest_is_rejected(self, mutation: dict[str, Any], fragment: str) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            ProjectManifest.from_wire(dict(_manifest().to_wire()) | mutation)


class TestRevisionRef:
    def test_a_revision_knows_where_it_lives(self) -> None:
        revision = RevisionRef(sequence=3, recorded_at_ms=T0)
        assert revision.document_name == "timeline/revisions/000003.json"

    def test_the_wire_form_carries_an_optional_checksum(self) -> None:
        revision = RevisionRef(
            sequence=1, recorded_at_ms=T0, label="before relink", checksum=ContentHash(DIGEST)
        )
        assert RevisionRef.from_wire(_round_trip(revision.to_wire())) == revision

    def test_a_revision_without_a_checksum_round_trips_as_null(self) -> None:
        revision = RevisionRef(sequence=0, recorded_at_ms=T0)
        wire = revision.to_wire()
        assert wire["checksum"] is None
        assert RevisionRef.from_wire(_round_trip(wire)) == revision

    @pytest.mark.parametrize(
        ("overrides", "fragment"),
        [
            ({"sequence": -1}, "must not be negative"),
            ({"recorded_at_ms": -1}, "must not be negative"),
        ],
    )
    def test_invariants_are_checked_at_construction(
        self, overrides: dict[str, Any], fragment: str
    ) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            RevisionRef(**{"sequence": 1, "recorded_at_ms": T0, **overrides})

    def test_a_corrupt_revision_is_rejected(self) -> None:
        wire = dict(RevisionRef(sequence=1, recorded_at_ms=T0).to_wire()) | {"checksum": DIGEST}
        with pytest.raises(NovaInvariantError, match="must be a mapping or null"):
            RevisionRef.from_wire(wire)

    def test_pruning_keeps_the_newest(self) -> None:
        revisions = tuple(
            RevisionRef(sequence=index, recorded_at_ms=T0 + index) for index in range(5)
        )
        doomed = revisions_to_prune(revisions, keep=2)
        assert [revision.sequence for revision in doomed] == [0, 1, 2]

    def test_pruning_nothing_when_within_the_bound(self) -> None:
        revisions = tuple(RevisionRef(sequence=index, recorded_at_ms=T0) for index in range(3))
        assert revisions_to_prune(revisions, keep=5) == ()

    def test_pruning_is_by_sequence_not_by_list_order(self) -> None:
        """A caller reading a directory listing gets the entries out of order."""
        revisions = (
            RevisionRef(sequence=9, recorded_at_ms=T0),
            RevisionRef(sequence=2, recorded_at_ms=T0),
            RevisionRef(sequence=5, recorded_at_ms=T0),
        )
        assert [revision.sequence for revision in revisions_to_prune(revisions, keep=1)] == [2, 5]

    def test_pruning_every_revision_is_refused(self) -> None:
        with pytest.raises(NovaInvariantError, match="at least one revision"):
            revisions_to_prune((RevisionRef(sequence=0, recorded_at_ms=T0),), keep=0)


class TestJournalEntry:
    def test_the_wire_form_is_one_ndjson_line(self) -> None:
        entry = JournalEntry(sequence=1, recorded_at_ms=T0, name="MoveClip", payload={"dx": 3})
        wire = entry.to_wire()
        json.dumps(wire)  # a line must be serialisable on its own
        assert JournalEntry.from_wire(_round_trip(wire)) == entry

    def test_the_payload_is_copied_not_shared(self) -> None:
        """A frozen entry whose payload the caller can still mutate is not frozen."""
        payload = {"dx": 3}
        entry = JournalEntry(sequence=1, recorded_at_ms=T0, name="MoveClip", payload=payload)
        payload["dx"] = 99
        assert entry.payload["dx"] == 3

    @pytest.mark.parametrize(
        ("overrides", "fragment"),
        [
            ({"sequence": -1}, "must not be negative"),
            ({"name": ""}, "must name the command"),
            ({"recorded_at_ms": -1}, "must not be negative"),
        ],
    )
    def test_invariants_are_checked_at_construction(
        self, overrides: dict[str, Any], fragment: str
    ) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            JournalEntry(**{"sequence": 1, "recorded_at_ms": T0, "name": "MoveClip", **overrides})

    def test_a_corrupt_line_is_rejected(self) -> None:
        entry = JournalEntry(sequence=1, recorded_at_ms=T0, name="MoveClip")
        with pytest.raises(NovaInvariantError, match="payload must be a mapping"):
            JournalEntry.from_wire(dict(entry.to_wire()) | {"payload": "dx=3"})

    def test_a_window_reports_where_to_continue(self) -> None:
        entries = tuple(
            JournalEntry(sequence=index, recorded_at_ms=T0, name="MoveClip") for index in (1, 2)
        )
        window = JournalWindow(entries=entries, next_sequence=3)
        assert window.next_sequence == 3
        assert not window.torn_tail

    def test_a_torn_tail_is_data_not_an_error(self) -> None:
        """Being killed mid-write is the normal state of a journal."""
        window = JournalWindow(entries=(), next_sequence=0, torn_tail=True)
        assert window.torn_tail


class TestCheckpointPolicy:
    def test_a_command_count_triggers_a_checkpoint(self) -> None:
        policy = CheckpointPolicy(commands_between_checkpoints=200, seconds_between_checkpoints=120)
        assert policy.should_checkpoint(commands_since=200, elapsed_ms=0)

    def test_elapsed_time_triggers_a_checkpoint(self) -> None:
        policy = CheckpointPolicy(commands_between_checkpoints=200, seconds_between_checkpoints=120)
        assert policy.should_checkpoint(commands_since=1, elapsed_ms=120_000)

    def test_neither_limit_reached_means_no_checkpoint(self) -> None:
        policy = CheckpointPolicy(commands_between_checkpoints=200, seconds_between_checkpoints=120)
        assert not policy.should_checkpoint(commands_since=199, elapsed_ms=119_999)

    def test_whichever_limit_comes_first_wins(self) -> None:
        policy = CheckpointPolicy(commands_between_checkpoints=200, seconds_between_checkpoints=120)
        assert policy.should_checkpoint(commands_since=1, elapsed_ms=120_000)
        assert policy.should_checkpoint(commands_since=200, elapsed_ms=1)

    @pytest.mark.parametrize(
        ("overrides", "fragment"),
        [
            ({"max_revisions": 0}, "at least one revision"),
            ({"commands_between_checkpoints": 0}, "must be positive"),
            ({"seconds_between_checkpoints": 0}, "must be positive"),
        ],
    )
    def test_invariants_are_checked_at_construction(
        self, overrides: dict[str, Any], fragment: str
    ) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            CheckpointPolicy(**overrides)


class TestCacheEntry:
    def test_the_wire_form_survives_a_json_boundary(self) -> None:
        entry = _entry("thumb/asset-1.jpg", size_bytes=4096, pinned=True)
        assert CacheEntry.from_wire(_round_trip(entry.to_wire())) == entry

    def test_idle_time_is_measured_from_last_use(self) -> None:
        entry = _entry("k", last_used_ms=T0, created_ms=T0 - 5_000)
        assert entry.idle_ms(T0 + 1_000) == 1_000
        assert entry.age_ms(T0 + 1_000) == 6_000

    def test_touch_records_later_use(self) -> None:
        assert _entry("k").touch(T0 + 500).last_used_ms == T0 + 500

    def test_touch_cannot_go_backwards(self) -> None:
        with pytest.raises(NovaInvariantError, match="backwards"):
            _entry("k", last_used_ms=T0).touch(T0 - 1)

    @pytest.mark.parametrize(
        ("overrides", "fragment"),
        [
            ({"key": ""}, "must carry a key"),
            ({"size_bytes": -1}, "must not be negative"),
            ({"last_used_ms": T0 - 1}, "must not precede created_ms"),
        ],
    )
    def test_invariants_are_checked_at_construction(
        self, overrides: dict[str, Any], fragment: str
    ) -> None:
        with pytest.raises(NovaInvariantError, match=fragment):
            _entry(**{"key": "k", **overrides})

    def test_a_corrupt_entry_is_rejected(self) -> None:
        with pytest.raises(NovaInvariantError, match="unknown cache kind"):
            CacheEntry.from_wire(dict(_entry("k").to_wire()) | {"kind": "stills"})
        with pytest.raises(NovaInvariantError, match="pinned must be a bool"):
            CacheEntry.from_wire(dict(_entry("k").to_wire()) | {"pinned": "yes"})


class TestCacheBudget:
    def test_headroom_is_what_is_left(self) -> None:
        budget = CacheBudget(max_bytes=1_000)
        assert budget.headroom_bytes(400) == 600
        assert budget.headroom_bytes(1_400) == 0

    def test_eviction_is_needed_when_admitting_would_overflow(self) -> None:
        budget = CacheBudget(max_bytes=1_000)
        assert budget.needs_eviction(used_bytes=900, needed_bytes=200)
        assert not budget.needs_eviction(used_bytes=900, needed_bytes=100)

    def test_a_budget_must_have_some_bytes(self) -> None:
        with pytest.raises(NovaInvariantError, match="must be positive"):
            CacheBudget(max_bytes=0)


class TestSelectForEviction:
    BUDGET = CacheBudget(max_bytes=1_000)

    def test_nothing_is_evicted_while_there_is_room(self) -> None:
        entries = (_entry("a", size_bytes=100), _entry("b", size_bytes=100))
        assert select_for_eviction(entries, needed_bytes=100, budget=self.BUDGET) == ()

    def test_the_least_recently_used_entry_goes_first(self) -> None:
        entries = (
            _entry("old", last_used_ms=T0, size_bytes=400),
            _entry("new", last_used_ms=T0 + 10_000, size_bytes=400),
        )
        evicted = select_for_eviction(entries, needed_bytes=400, budget=self.BUDGET)
        assert [entry.key for entry in evicted] == ["old"]

    def test_only_enough_is_evicted_to_make_room(self) -> None:
        """Clearing a whole cache to admit one file is how an editor gets slow.

        1 500 bytes held, 400 about to arrive, 1 000 allowed: 900 must go,
        which is three 300-byte entries — not all five.
        """
        entries = tuple(
            _entry(f"entry-{index}", last_used_ms=T0 + index, size_bytes=300) for index in range(5)
        )
        evicted = select_for_eviction(entries, needed_bytes=400, budget=self.BUDGET)
        assert len(evicted) == 3
        assert sum(entry.size_bytes for entry in evicted) == 900
        assert [entry.key for entry in evicted] == ["entry-0", "entry-1", "entry-2"]

    def test_ties_are_broken_deterministically_by_key(self) -> None:
        entries = (
            _entry("b", size_bytes=300),
            _entry("a", size_bytes=300),
        )
        evicted = select_for_eviction(entries, needed_bytes=500, budget=self.BUDGET)
        assert [entry.key for entry in evicted] == ["a"]

    def test_pinned_entries_are_never_chosen(self) -> None:
        entries = (
            _entry("busy", last_used_ms=T0, size_bytes=900, pinned=True),
            _entry("cold", last_used_ms=T0 + 5_000, size_bytes=100),
        )
        evicted = select_for_eviction(entries, needed_bytes=200, budget=self.BUDGET)
        assert [entry.key for entry in evicted] == ["cold"]

    def test_when_everything_is_pinned_the_result_may_be_insufficient(self) -> None:
        """The caller compares freed bytes against need and reports; it does not
        silently blow the budget."""
        entries = (_entry("busy", size_bytes=900, pinned=True),)
        evicted = select_for_eviction(entries, needed_bytes=500, budget=self.BUDGET)
        assert evicted == ()

    def test_the_entry_count_budget_also_triggers_eviction(self) -> None:
        budget = CacheBudget(max_bytes=10_000, max_entries=2)
        entries = (_entry("a", size_bytes=10), _entry("b", size_bytes=10))
        evicted = select_for_eviction(entries, needed_bytes=1, budget=budget)
        assert len(evicted) == 1

    def test_an_unlimited_entry_count_never_evicts_on_count_alone(self) -> None:
        budget = CacheBudget(max_bytes=10_000)
        entries = tuple(_entry(f"e{index}", size_bytes=10) for index in range(50))
        assert select_for_eviction(entries, needed_bytes=10, budget=budget) == ()
