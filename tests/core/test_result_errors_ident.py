"""Result, error-taxonomy and identity tests."""

from __future__ import annotations

import threading
import uuid
from typing import Any

import pytest

from nova_studio.core.errors import (
    ConcurrentModificationError,
    DocumentCorruptionError,
    ErrorDomain,
    ErrorSeverity,
    LayerViolationError,
    NovaError,
    NovaInvariantError,
)
from nova_studio.core.ident import (
    EntityId,
    IdFactory,
    is_valid_entity_id,
    new_entity_id,
    new_short_id,
    process_token,
    random_suffix,
)
from nova_studio.core.result import (
    Err,
    ResultUnwrapError,
    catch_errors,
    collect,
    collect_all,
    err,
    error_result,
    failed,
    ok,
    unwrap_all,
)

pytestmark = pytest.mark.unit


class TestResult:
    def test_ok_and_err_predicates(self) -> None:
        success: Any = ok(5)
        failure: Any = err(NovaError("NS-X-1", "boom"))
        assert success.is_ok() is True
        assert success.is_err() is False
        assert failure.is_ok() is False
        assert failure.is_err() is True

    def test_truthiness_expresses_success(self) -> None:
        assert bool(ok(0)) is True, "Ok(0) must be truthy — the value is not the signal"
        assert bool(err(NovaError("NS-X-1", "boom"))) is False

    def test_map(self) -> None:
        assert ok(2).map(lambda value: value * 3).unwrap() == 6
        failure = err(NovaError("NS-X-1", "boom"))
        assert failure.map(lambda value: value * 3).unwrap_err().code == "NS-X-1"

    def test_and_then_short_circuits(self) -> None:
        calls: list[int] = []

        def step(value: int) -> Any:
            calls.append(value)
            return ok(value + 1)

        assert ok(1).and_then(step).and_then(step).unwrap() == 3
        assert calls == [1, 2]

        calls.clear()
        failure = err(NovaError("NS-X-1", "boom"))
        assert failure.and_then(step).is_err()
        assert calls == [], "and_then must not run after a failure"

    def test_or_else_recovers(self) -> None:
        failure = err(NovaError("NS-X-1", "boom"))
        recovered = failure.or_else(lambda _error: ok(99))
        assert recovered.unwrap() == 99
        assert ok(1).or_else(lambda _error: ok(99)).unwrap() == 1

    def test_map_err_adds_context(self) -> None:
        failure = err(NovaError("NS-X-1", "boom"))
        mapped = failure.map_err(lambda error: error.with_details(stage="decode"))
        assert mapped.unwrap_err().details == {"stage": "decode"}
        assert ok(1).map_err(lambda error: error).unwrap() == 1

    def test_unwrap_semantics(self) -> None:
        assert ok("v").unwrap() == "v"
        failure = err(NovaError("NS-X-1", "boom"))
        assert failure.unwrap_or("fallback") == "fallback"
        assert failure.unwrap_or_else(lambda: "computed") == "computed"
        assert ok("v").unwrap_or("fallback") == "v"
        assert failure.unwrap_err().code == "NS-X-1"
        with pytest.raises(Exception, match="NS-X-1"):
            failure.unwrap()
        with pytest.raises(NovaInvariantError):
            ok(1).unwrap_err()

    def test_iteration_yields_only_success(self) -> None:
        assert list(ok(7)) == [7]
        assert list(err(NovaError("NS-X-1", "boom"))) == []

    def test_serialisation(self) -> None:
        assert ok({"a": 1}).to_dict() == {"ok": {"a": 1}}
        failure = err(NovaError("NS-X-1", "boom"))
        assert failure.to_dict()["err"]["code"] == "NS-X-1"

    def test_collect_fails_fast_on_the_first_error(self) -> None:
        first = err(NovaError("NS-X-1", "first"))
        second = err(NovaError("NS-X-2", "second"))
        result = collect([ok(1), first, second])
        assert result.is_err()
        assert result.unwrap_err().code == "NS-X-1"
        assert collect([ok(1), ok(2)]).unwrap() == [1, 2]
        assert collect([]).unwrap() == []

    def test_collect_all_accumulates_every_error(self) -> None:
        """Validation UIs must show all problems at once, not one per submit."""
        result = collect_all([ok(1), err(NovaError("NS-X-1", "a")), err(NovaError("NS-X-2", "b"))])
        assert result.is_err()
        error = result.unwrap_err()
        assert error.details["error_count"] == 2
        assert [item["code"] for item in error.details["errors"]] == ["NS-X-1", "NS-X-2"]
        assert collect_all([ok(1), ok(2)]).unwrap() == [1, 2]

    def test_unwrap_all(self) -> None:
        assert unwrap_all([ok(1), ok(2)]) == [1, 2]
        # `unwrap_all` propagates `ResultUnwrapError`, which carries the underlying
        # `NovaError` so a caller can recover without string-parsing the message.
        # Note this differs from `Ok.unwrap_err()`, which raises
        # `NovaInvariantError` because that is a programming error, not a failure.
        with pytest.raises(ResultUnwrapError) as caught:
            unwrap_all([ok(1), err(NovaError("NS-X-1", "boom"))])
        assert caught.value.error.code == "NS-X-1"

    def test_unwrap_all_reports_the_first_error_only(self) -> None:
        """Fail-fast: later results are never unwrapped."""
        with pytest.raises(ResultUnwrapError) as caught:
            unwrap_all(
                [
                    ok(1),
                    err(NovaError("NS-X-1", "first")),
                    err(NovaError("NS-X-2", "second")),
                ]
            )
        assert caught.value.error.code == "NS-X-1"

    def test_result_unwrap_error_is_a_runtime_error(self) -> None:
        """Callers that only handle `RuntimeError` must still catch it."""
        failure = ResultUnwrapError(NovaError("NS-X-1", "boom"))
        assert isinstance(failure, RuntimeError)
        assert not isinstance(failure, NovaInvariantError)
        assert "NS-X-1" in str(failure)

    def test_error_result_shorthand(self) -> None:
        result = error_result(
            "NS-MEDIA-4001",
            "unsupported codec",
            domain=ErrorDomain.MEDIA,
            severity=ErrorSeverity.WARNING,
            remedy="Transcode to H.264",
            retryable=True,
        )
        error = result.unwrap_err()
        assert error.domain is ErrorDomain.MEDIA
        assert error.severity is ErrorSeverity.WARNING
        assert error.remedy == "Transcode to H.264"
        assert error.retryable is True

    def test_failed_retags_an_error_to_any_success_type(self) -> None:
        """``Err`` is covariant in its unused success type, so no cast is needed."""

        def returns_int() -> Any:
            return failed(NovaError("NS-X-1", "boom"))

        result = returns_int()
        assert result.is_err()
        assert isinstance(result, Err)

    def test_catch_errors_adapts_exceptions(self) -> None:
        @catch_errors(code="NS-MEDIA-4010", domain=ErrorDomain.MEDIA)
        def risky(value: int) -> int:
            if value < 0:
                raise ValueError("negative")
            return value * 2

        assert risky(3).unwrap() == 6
        failure = risky(-1)
        assert failure.is_err()
        error = failure.unwrap_err()
        assert error.code == "NS-MEDIA-4010"
        assert error.domain is ErrorDomain.MEDIA
        assert error.cause is not None
        assert error.cause.startswith("ValueError")
        assert error.details["exception"] == "ValueError"

    def test_catch_errors_preserves_metadata(self) -> None:
        @catch_errors(code="NS-X-1")
        def documented() -> int:
            """Docstring."""
            return 1

        assert documented.__name__ == "documented"
        assert documented.__doc__ == "Docstring."

    def test_catch_errors_does_not_swallow_invariants(self) -> None:
        """Bugs must stay bugs; only expected failures become values."""

        @catch_errors(code="NS-X-1", exceptions=(ValueError,))
        def buggy() -> int:
            raise NovaInvariantError("state is corrupt")

        with pytest.raises(NovaInvariantError):
            buggy()


class TestNovaError:
    def test_defaults(self) -> None:
        error = NovaError("NS-X-1", "boom")
        assert error.domain is ErrorDomain.INTERNAL
        assert error.severity is ErrorSeverity.ERROR
        assert error.details == {}
        assert error.remedy is None
        assert error.cause is None
        assert error.retryable is False

    def test_domain_coerced_from_string(self) -> None:
        assert NovaError("NS-X-1", "boom", domain="MEDIA").domain is ErrorDomain.MEDIA

    def test_unknown_domain_is_rejected(self) -> None:
        with pytest.raises(ValueError):
            NovaError("NS-X-1", "boom", domain="NOT_A_DOMAIN")

    def test_details_are_copied_not_shared(self) -> None:
        source = {"asset": "a1"}
        error = NovaError("NS-X-1", "boom", details=source)
        source["asset"] = "mutated"
        assert error.details == {"asset": "a1"}
        returned = error.details
        returned["asset"] = "mutated again"
        assert error.details == {"asset": "a1"}

    def test_with_details_merges(self) -> None:
        error = NovaError("NS-X-1", "boom", details={"a": 1})
        extended = error.with_details(b=2)
        assert extended.details == {"a": 1, "b": 2}
        assert error.details == {"a": 1}, "the original must not change"

    def test_with_remedy_and_caused_by_are_non_mutating(self) -> None:
        error = NovaError("NS-X-1", "boom")
        with_remedy = error.with_remedy("try this")
        assert with_remedy.remedy == "try this"
        assert error.remedy is None

        caused = error.caused_by(ValueError("inner"))
        assert caused.cause == "ValueError: inner"
        assert error.cause is None

        chained = error.caused_by("NS-Y-2")
        assert chained.cause == "NS-Y-2"

    def test_escalated_changes_severity_only(self) -> None:
        error = NovaError("NS-X-1", "boom", remedy="fix it")
        escalated = error.escalated(ErrorSeverity.CRITICAL)
        assert escalated.severity is ErrorSeverity.CRITICAL
        assert escalated.remedy == "fix it"
        assert error.severity is ErrorSeverity.ERROR

    def test_equality_and_hashing(self) -> None:
        first = NovaError("NS-X-1", "boom", details={"a": 1})
        second = NovaError("NS-X-1", "boom", details={"a": 1})
        assert first == second
        assert hash(first) == hash(second)
        assert first != NovaError("NS-X-1", "different")
        assert first != "not an error"

    def test_str_includes_code_and_cause(self) -> None:
        error = NovaError("NS-MEDIA-4001", "unsupported codec").caused_by("libx265")
        assert str(error) == "[NS-MEDIA-4001] unsupported codec (cause: libx265)"

    def test_repr_is_complete(self) -> None:
        rendered = repr(NovaError("NS-X-1", "boom"))
        assert "NS-X-1" in rendered
        assert "boom" in rendered

    def test_serialisation_round_trip(self) -> None:
        original = NovaError(
            "NS-MEDIA-4001",
            "unsupported codec",
            domain=ErrorDomain.MEDIA,
            severity=ErrorSeverity.WARNING,
            details={"codec": "hevc"},
            remedy="transcode",
            cause="probe failed",
            retryable=True,
        )
        assert NovaError.from_dict(original.to_dict()) == original

    def test_to_dict_omits_absent_fields(self) -> None:
        payload = NovaError("NS-X-1", "boom").to_dict()
        assert set(payload) == {"code", "domain", "message", "severity", "retryable"}


class TestProblemDetail:
    def test_rfc9457_shape(self) -> None:
        problem = NovaError(
            "NS-MEDIA-4001",
            "unsupported codec",
            domain=ErrorDomain.MEDIA,
            severity=ErrorSeverity.ERROR,
            remedy="transcode",
            details={"codec": "hevc"},
        ).to_problem(instance="/api/v1/assets/a1")
        payload = problem.to_dict()
        assert payload["type"] == "https://nova.studio/errors/NS-MEDIA-4001"
        assert payload["title"] == "Media error"
        assert payload["status"] == 422
        assert payload["detail"] == "unsupported codec"
        assert payload["instance"] == "/api/v1/assets/a1"
        assert payload["code"] == "NS-MEDIA-4001"
        assert payload["remedy"] == "transcode"
        assert payload["extensions"] == {"codec": "hevc"}

    def test_severity_maps_to_status(self) -> None:
        expected = {
            ErrorSeverity.DEBUG: 200,
            ErrorSeverity.INFO: 200,
            ErrorSeverity.WARNING: 409,
            ErrorSeverity.ERROR: 422,
            ErrorSeverity.CRITICAL: 500,
        }
        for severity, status in expected.items():
            built = NovaError("NS-X-1", "boom", severity=severity).to_problem()
            assert built.status == status

    def test_optional_fields_are_omitted(self) -> None:
        payload = NovaError("NS-X-1", "boom").to_problem().to_dict()
        assert "instance" not in payload
        assert "remedy" not in payload
        assert "cause" not in payload
        assert "extensions" not in payload


class TestInvariantHierarchy:
    def test_invariants_are_assertion_errors(self) -> None:
        """So a broad ``except Exception`` cannot swallow a bug."""
        assert issubclass(NovaInvariantError, AssertionError)
        for subclass in (
            DocumentCorruptionError,
            LayerViolationError,
            ConcurrentModificationError,
        ):
            assert issubclass(subclass, NovaInvariantError)

    def test_context_is_preserved(self) -> None:
        error = DocumentCorruptionError("bad checksum", context={"entry": "timeline"})
        assert error.context == {"entry": "timeline"}
        assert "bad checksum" in str(error)

    def test_context_defaults_to_empty(self) -> None:
        assert NovaInvariantError("x").context == {}


class _SequenceClock:
    """Clock returning a fixed sequence of readings, then repeating the last."""

    def __init__(self, readings: list[int]) -> None:
        self._readings = list(readings)

    def now_ms(self) -> int:
        return self._readings.pop(0) if self._readings else 0


class TestEntityId:
    def test_ids_are_valid_rfc9562_uuidv7(self) -> None:
        for _ in range(100):
            generated = new_entity_id()
            assert is_valid_entity_id(generated)
            parsed = uuid.UUID(generated)
            assert parsed.version == 7
            assert parsed.variant == uuid.RFC_4122

    def test_ids_are_unique(self) -> None:
        ids = {new_entity_id() for _ in range(20_000)}
        assert len(ids) == 20_000

    def test_ids_sort_in_creation_order(self) -> None:
        """UUIDv7 is time-ordered, so a document reads chronologically."""
        ids = [new_entity_id() for _ in range(500)]
        assert ids == sorted(ids)

    def test_a_held_timestamp_never_repeats_an_id(self) -> None:
        """Regression: the backwards-clock path must still advance the counter.

        Emitting a duplicate id would corrupt a project document — two distinct
        entities would collide on a primary key.
        """

        class FrozenClock:
            def now_ms(self) -> int:
                return 1_700_000_000_000

        factory = IdFactory(clock=FrozenClock())
        ids = [factory.new_entity_id() for _ in range(10_000)]
        assert len(set(ids)) == len(ids)

        backwards = IdFactory(clock=_SequenceClock([1_000, 1_000, 900, 900, 800, 800]))
        repeated = [backwards.new_entity_id() for _ in range(6)]
        assert len(set(repeated)) == 6
        assert repeated == sorted(repeated)

    def test_ids_are_monotonic_within_a_millisecond(self) -> None:
        """A fixed clock must still produce strictly increasing, ordered ids."""

        class FrozenClock:
            def now_ms(self) -> int:
                return 1_700_000_000_000

        factory = IdFactory(clock=FrozenClock())
        ids = [factory.new_entity_id() for _ in range(1_000)]
        assert len(set(ids)) == 1_000, "ids must be unique even with a frozen clock"
        assert ids == sorted(ids), "the counter must keep ids ordered"

    def test_a_backwards_clock_never_produces_an_out_of_order_id(self) -> None:
        """NTP corrections and VM resumes move the clock backwards."""
        readings = iter([1_000, 1_000, 900, 800, 1_100])

        class JumpyClock:
            def now_ms(self) -> int:
                return next(readings)

        factory = IdFactory(clock=JumpyClock())
        ids = [factory.new_entity_id() for _ in range(5)]
        assert ids == sorted(ids)
        assert len(set(ids)) == 5

    def test_counter_overflow_advances_the_timestamp(self) -> None:
        """When 4096 ids land in one millisecond, time advances rather than reorders."""

        class FrozenClock:
            def now_ms(self) -> int:
                return 1_700_000_000_000

        factory = IdFactory(clock=FrozenClock())
        ids = [factory.new_entity_id() for _ in range(5_000)]
        assert ids == sorted(ids)
        assert len(set(ids)) == 5_000

    def test_concurrent_generation_is_safe_and_unique(self) -> None:
        factory = IdFactory()
        collected: list[str] = []
        lock = threading.Lock()

        def worker() -> None:
            local = [factory.new_entity_id() for _ in range(500)]
            with lock:
                collected.extend(local)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        assert len(collected) == 4_000
        assert len(set(collected)) == 4_000

    def test_injected_clock_controls_the_timestamp(self) -> None:
        class FixedClock:
            def now_ms(self) -> int:
                return 0x0123_4567_89AB

        clock = FixedClock()
        generated = IdFactory(clock=clock).new_entity_id()
        assert generated.startswith("01234567-89ab-7")
        # The one-shot override on a factory with a different clock also wins.
        overridden = IdFactory().new_entity_id(clock)
        assert overridden.startswith("01234567-89ab-7")

    def test_validation_rejects_malformed_ids(self) -> None:
        assert is_valid_entity_id("not-a-uuid") is False
        assert is_valid_entity_id("") is False
        assert is_valid_entity_id(str(uuid.uuid4())) is False, "v4 is not v7"
        assert is_valid_entity_id("01234567-89ab-4def-8123-456789abcdef") is False
        assert is_valid_entity_id("01234567-89ab-7def-0123-456789abcdef") is False, (
            "variant must be 10"
        )
        assert is_valid_entity_id("0123456789ab7def8123456789abcdef") is False

    def test_entity_id_is_a_typed_str(self) -> None:
        generated: EntityId = new_entity_id()
        assert isinstance(generated, str)


class TestShortId:
    def test_default_length_and_alphabet(self) -> None:
        token = new_short_id()
        assert len(token) == 8
        assert all(character in "0123456789ABCDEFGHJKMNPQRSTVWXYZ" for character in token)

    def test_ambiguous_characters_are_excluded(self) -> None:
        """Crockford base32 omits I, L, O and U so a user can read it aloud."""
        for _ in range(2_000):
            token = new_short_id(12)
            assert not any(character in "ILOU" for character in token)

    def test_length_validation(self) -> None:
        for length in (4, 8, 32):
            assert len(new_short_id(length)) == length
        for length in (0, 3, 33, -1):
            with pytest.raises(ValueError, match=r"\[4, 32\]"):
                new_short_id(length)

    def test_uniqueness(self) -> None:
        tokens = {new_short_id(16) for _ in range(5_000)}
        assert len(tokens) == 5_000

    def test_distribution_is_uniform(self) -> None:
        """256 % 32 == 0, so ``byte >> 3`` maps uniformly with no rejection sampling.

        A right shift by 3 maps each of the 32 symbols from exactly 8 of the 256
        byte values; had this been ``byte >> 4`` or a modulo by a non-divisor the
        output would have been measurably biased.
        """
        counts: dict[str, int] = {}
        trials = 20_000
        for _ in range(trials):
            for character in new_short_id():
                counts[character] = counts.get(character, 0) + 1
        expected = trials * 8 / 32
        assert len(counts) == 32, "every symbol must appear"
        for character, count in counts.items():
            assert abs(count - expected) / expected < 0.10, (
                f"symbol {character} is biased: {count} vs {expected}"
            )


class TestIdFactoryShortIds:
    """The factory is the default IdGenerator: both kinds of id, one object."""

    def test_mints_short_ids_like_the_module_function(self) -> None:
        token = IdFactory().new_short_id()
        assert len(token) == 8
        assert all(character in "0123456789ABCDEFGHJKMNPQRSTVWXYZ" for character in token)

    def test_length_bounds_are_enforced(self) -> None:
        factory = IdFactory()
        assert len(factory.new_short_id(12)) == 12
        with pytest.raises(ValueError, match=r"\[4, 32\]"):
            factory.new_short_id(3)

    def test_short_ids_draw_from_the_injected_entropy(self) -> None:
        """Fixed entropy ⇒ fixed tokens, exactly as fixed clocks fix timestamps."""

        class FixedEntropy:
            def rand_bytes(self, count: int) -> bytes:
                return bytes(range(count))

        first = IdFactory(entropy=FixedEntropy()).new_short_id(8)
        second = IdFactory(entropy=FixedEntropy()).new_short_id(8)
        assert first == second
        expected = "".join(
            "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[byte >> 3] for byte in bytes(range(8))
        )
        assert first == expected

    def test_entity_ids_and_short_ids_come_from_one_factory(self) -> None:
        factory = IdFactory()
        entity = factory.new_entity_id()
        short = factory.new_short_id()
        assert is_valid_entity_id(entity)
        assert entity != short


class TestTokenHelpers:
    def test_process_token_is_url_safe_and_unique(self) -> None:
        first, second = process_token(), process_token()
        assert first != second
        assert len(first) >= 40
        assert all(character.isalnum() or character in "-_" for character in first)

    def test_random_suffix(self) -> None:
        suffix = random_suffix()
        assert len(suffix) == 6
        assert suffix.isalnum()
        assert suffix.islower() or suffix.isdigit()
        assert len({random_suffix() for _ in range(1_000)}) == 1_000

    def test_random_suffix_length(self) -> None:
        assert len(random_suffix(12)) == 12
