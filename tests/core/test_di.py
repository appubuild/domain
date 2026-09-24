"""DI container tests: lifetimes, scopes, cycles, rebinding, concurrency."""

from __future__ import annotations

import threading
from typing import Any

import pytest

from nova_studio.core.di import (
    ContainerError,
    DependencyGraphError,
    Lifetime,
    ResolutionError,
    Resolver,
    ServiceContainer,
)
from nova_studio.core.events import DeliveryMode, EventBus

pytestmark = pytest.mark.unit


class Decoder:
    """Stand-in for a media port implementation."""

    def __init__(self, label: str = "builtin") -> None:
        self.label = label


class RenderEngine:
    def __init__(self, decoder: Decoder) -> None:
        self.decoder = decoder


class ProjectSession:
    def __init__(self, project_id: str) -> None:
        self.project_id = project_id


class TestRegistration:
    def test_register_and_resolve(self, container: ServiceContainer) -> None:
        container.register(Decoder, lambda _resolver: Decoder())
        instance = container.resolve(Decoder)
        assert isinstance(instance, Decoder)

    def test_singletons_are_cached(self, container: ServiceContainer) -> None:
        container.register(Decoder, lambda _resolver: Decoder())
        assert container.resolve(Decoder) is container.resolve(Decoder)

    def test_transient_creates_a_new_instance(self, container: ServiceContainer) -> None:
        container.register(Decoder, lambda _resolver: Decoder(), lifetime=Lifetime.TRANSIENT)
        assert container.resolve(Decoder) is not container.resolve(Decoder)

    def test_dependencies_are_injected(self, container: ServiceContainer) -> None:
        container.register(Decoder, lambda _resolver: Decoder())
        container.register(
            RenderEngine,
            lambda resolver: RenderEngine(resolver.resolve(Decoder)),
            depends_on=(Decoder,),
        )
        engine = container.resolve(RenderEngine)
        assert isinstance(engine.decoder, Decoder)
        assert engine.decoder is container.resolve(Decoder)

    def test_register_instance(self, container: ServiceContainer) -> None:
        decoder = Decoder("preset")
        container.register_instance(Decoder, decoder)
        assert container.resolve(Decoder) is decoder

    def test_duplicate_registration_requires_override(self, container: ServiceContainer) -> None:
        container.register(Decoder, lambda _resolver: Decoder())
        with pytest.raises(ContainerError, match="already registered"):
            container.register(Decoder, lambda _resolver: Decoder())
        container.register(Decoder, lambda _resolver: Decoder("v2"), override=True)
        assert container.resolve(Decoder).label == "v2"

    def test_unregister(self, container: ServiceContainer) -> None:
        container.register(Decoder, lambda _resolver: Decoder())
        assert container.unregister(Decoder) is True
        assert container.unregister(Decoder) is False
        assert container.is_registered(Decoder) is False

    def test_string_keys_are_supported(self, container: ServiceContainer) -> None:
        container.register("settings", lambda _resolver: {"theme": "dark"})
        assert container.resolve("settings") == {"theme": "dark"}

    def test_resolving_an_unregistered_key_is_a_structured_error(
        self, container: ServiceContainer
    ) -> None:
        with pytest.raises(ResolutionError) as info:
            container.resolve(Decoder)
        assert info.value.error.code == "NS-CORE-2001"
        assert info.value.error.remedy is not None


class TestCycleDetection:
    def test_direct_cycle_is_rejected_at_registration(self) -> None:
        container = ServiceContainer()

        class A:
            pass

        class B:
            pass

        class AInstance:
            def __init__(self, b: Any) -> None:
                self.b = b

        class BInstance:
            def __init__(self, a: Any) -> None:
                self.a = a

        container.register(A, lambda resolver: AInstance(resolver.resolve(B)), depends_on=(B,))
        with pytest.raises(DependencyGraphError, match="dependency cycle") as info:
            container.register(B, lambda resolver: BInstance(resolver.resolve(A)), depends_on=(A,))
        assert info.value.cycle == (A, B, A)

    def test_the_graph_is_left_intact_after_a_rejected_cycle(self) -> None:
        """Registration is atomic: a rejected binding must not half-apply."""
        container = ServiceContainer()

        class A:
            pass

        class B:
            pass

        class AInstance:
            pass

        class BInstance:
            def __init__(self, a: Any) -> None:
                self.a = a

        container.register(A, lambda _resolver: AInstance())
        container.register(B, lambda resolver: BInstance(resolver.resolve(A)), depends_on=(A,))
        before = container.describe()

        with pytest.raises(DependencyGraphError):
            container.register(
                A, lambda resolver: resolver.resolve(B), depends_on=(B,), override=True
            )

        assert container.describe() == before
        assert isinstance(container.resolve(A), AInstance)
        resolved_b = container.resolve(B)
        assert isinstance(resolved_b, BInstance)
        assert isinstance(resolved_b.a, AInstance)

    def test_indirect_cycle_is_detected(self) -> None:
        container = ServiceContainer()

        class A:
            pass

        class B:
            pass

        class C:
            pass

        container.register(A, lambda resolver: resolver.resolve(B), depends_on=(B,))
        container.register(B, lambda resolver: resolver.resolve(C), depends_on=(C,))
        with pytest.raises(DependencyGraphError, match="A -> B -> C -> A") as info:
            container.register(C, lambda resolver: resolver.resolve(A), depends_on=(A,))
        assert info.value.cycle[0] is info.value.cycle[-1]
        assert len(info.value.cycle) == 4

    def test_runtime_cycle_is_detected_when_depends_on_lies(self) -> None:
        """A factory resolving an undeclared dependency still cannot loop forever."""
        container = ServiceContainer()

        class A:
            pass

        class B:
            pass

        container.register(A, lambda resolver: resolver.resolve(B))
        container.register(B, lambda resolver: resolver.resolve(A))
        with pytest.raises(DependencyGraphError, match="runtime resolution cycle") as info:
            container.resolve(A)
        assert "A -> B -> A" in str(info.value)

    def test_a_diamond_is_not_a_cycle(self) -> None:
        container = ServiceContainer()

        class Shared:
            pass

        class Left:
            pass

        class Right:
            pass

        class Top:
            pass

        class SharedInstance:
            pass

        class LeftInstance:
            def __init__(self, shared: Any) -> None:
                self.shared = shared

        class RightInstance:
            def __init__(self, shared: Any) -> None:
                self.shared = shared

        class TopInstance:
            def __init__(self, left: Any, right: Any) -> None:
                self.left = left
                self.right = right

        container.register(Shared, lambda _resolver: SharedInstance())
        container.register(
            Left,
            lambda r: LeftInstance(r.resolve(Shared)),
            depends_on=(Shared,),
        )
        container.register(
            Right,
            lambda r: RightInstance(r.resolve(Shared)),
            depends_on=(Shared,),
        )
        container.register(
            Top,
            lambda r: TopInstance(r.resolve(Left), r.resolve(Right)),
            depends_on=(Left, Right),
        )
        top = container.resolve(Top)
        assert isinstance(top, TopInstance)
        # Both branches share the one Shared singleton.
        assert top.left.shared is top.right.shared

    def test_unresolved_dependencies_are_reported(self) -> None:
        container = ServiceContainer()

        class A:
            pass

        class Missing:
            pass

        container.register(A, lambda _resolver: A(), depends_on=(Missing,))
        report = container.unresolved_dependencies()
        assert report == {"A": ["Missing"]}


class TestScopes:
    def test_scoped_instances_differ_per_scope(self, container: ServiceContainer) -> None:
        container.register(
            "session",
            lambda resolver: ProjectSession(resolver.scope.scope_id if resolver.scope else "?"),
            lifetime=Lifetime.SCOPED,
        )
        container.create_scope("p1")
        container.create_scope("p2")
        first = container.resolve("session", scope_id="p1")
        second = container.resolve("session", scope_id="p2")
        assert first is not second
        assert first.project_id == "p1"
        assert second.project_id == "p2"

    def test_scoped_instance_is_cached_within_a_scope(self, container: ServiceContainer) -> None:
        container.register(
            "session", lambda _resolver: ProjectSession("x"), lifetime=Lifetime.SCOPED
        )
        container.create_scope("p1")
        assert container.resolve("session", scope_id="p1") is container.resolve(
            "session", scope_id="p1"
        )

    def test_ambiguous_scope_is_refused(self, container: ServiceContainer) -> None:
        """With several projects open the container must not guess."""
        container.register(
            "session", lambda _resolver: ProjectSession("x"), lifetime=Lifetime.SCOPED
        )
        container.create_scope("p1")
        container.create_scope("p2")
        with pytest.raises(ResolutionError) as info:
            container.resolve("session")
        assert info.value.error.code == "NS-CORE-2003"

    def test_single_scope_is_used_implicitly(self, container: ServiceContainer) -> None:
        container.register(
            "session", lambda _resolver: ProjectSession("x"), lifetime=Lifetime.SCOPED
        )
        container.create_scope("p1")
        assert isinstance(container.resolve("session"), ProjectSession)

    def test_scoped_resolution_without_any_scope_fails(self, container: ServiceContainer) -> None:
        container.register(
            "session", lambda _resolver: ProjectSession("x"), lifetime=Lifetime.SCOPED
        )
        with pytest.raises(ResolutionError) as info:
            container.resolve("session")
        assert info.value.error.code == "NS-CORE-2003"

    def test_unknown_scope_id_is_a_structured_error(self, container: ServiceContainer) -> None:
        container.register(
            "session", lambda _resolver: ProjectSession("x"), lifetime=Lifetime.SCOPED
        )
        with pytest.raises(ResolutionError) as info:
            container.resolve("session", scope_id="nope")
        assert info.value.error.code == "NS-CORE-2002"

    def test_dispose_clears_instances(self, container: ServiceContainer) -> None:
        container.register(
            "session", lambda _resolver: ProjectSession("x"), lifetime=Lifetime.SCOPED
        )
        container.create_scope("p1")
        first = container.resolve("session", scope_id="p1")
        assert container.dispose_scope("p1") is True
        assert container.dispose_scope("p1") is False
        container.create_scope("p1")
        assert container.resolve("session", scope_id="p1") is not first

    def test_duplicate_scope_is_rejected(self, container: ServiceContainer) -> None:
        container.create_scope("p1")
        with pytest.raises(ContainerError, match="already exists"):
            container.create_scope("p1")

    def test_scope_context_manager_disposes(self, container: ServiceContainer) -> None:
        container.register(
            "session", lambda _resolver: ProjectSession("x"), lifetime=Lifetime.SCOPED
        )
        with container.scope("temp") as resolver:
            assert isinstance(resolver.resolve("session"), ProjectSession)
        assert container.describe_scopes() == []

    def test_describe_scopes_reports_age_and_size(
        self, container: ServiceContainer, fake_clock: Any
    ) -> None:
        container.register(
            "session", lambda _resolver: ProjectSession("x"), lifetime=Lifetime.SCOPED
        )
        container.create_scope("p1", label="My Edit", kind="feature")
        container.resolve("session", scope_id="p1")
        fake_clock.advance(1.5)
        described = container.describe_scopes()
        assert len(described) == 1
        assert described[0]["scope_id"] == "p1"
        assert described[0]["label"] == "My Edit"
        assert described[0]["instances"] == 1
        assert described[0]["age_ms"] == 1_500
        assert described[0]["metadata"] == {"kind": "feature"}


class TestRebinding:
    def test_rebind_replaces_and_invalidates(self, container: ServiceContainer) -> None:
        container.register(Decoder, lambda _resolver: Decoder("builtin"))
        first = container.resolve(Decoder)
        container.rebind(Decoder, lambda _resolver: Decoder("plugin"), reason="test")
        second = container.resolve(Decoder)
        assert second is not first
        assert second.label == "plugin"

    def test_rebind_publishes_an_event(
        self, container: ServiceContainer, captured_events: Any
    ) -> None:
        container.register(Decoder, lambda _resolver: Decoder())
        container.rebind(Decoder, lambda _resolver: Decoder("plugin"), reason="gpu")
        payloads = captured_events.payloads("plugin.rebound")
        assert payloads[0]["key"] == "Decoder"
        assert payloads[0]["reason"] == "gpu"

    def test_restore_returns_the_previous_binding(self, container: ServiceContainer) -> None:
        container.register(Decoder, lambda _resolver: Decoder("builtin"))
        container.rebind(Decoder, lambda _resolver: Decoder("plugin"))
        assert container.resolve(Decoder).label == "plugin"
        assert container.restore(Decoder) is True
        assert container.resolve(Decoder).label == "builtin"
        assert container.restore(Decoder) is False

    def test_rebind_invalidates_scoped_instances(self, container: ServiceContainer) -> None:
        container.register(
            "session", lambda _resolver: ProjectSession("v1"), lifetime=Lifetime.SCOPED
        )
        container.create_scope("p1")
        assert container.resolve("session", scope_id="p1").project_id == "v1"
        container.rebind(
            "session", lambda _resolver: ProjectSession("v2"), lifetime=Lifetime.SCOPED
        )
        assert container.resolve("session", scope_id="p1").project_id == "v2"


class TestResolverSurface:
    def test_resolver_cannot_register(self, container: ServiceContainer) -> None:
        """Factories get a Resolver, which has no registration methods."""
        captured: list[Resolver] = []

        def factory(resolver: Resolver) -> Decoder:
            captured.append(resolver)
            return Decoder()

        container.register(Decoder, factory)
        container.resolve(Decoder)
        resolver = captured[0]
        assert not hasattr(resolver, "register")
        assert not hasattr(resolver, "rebind")
        assert resolver.container is container

    def test_try_resolve_returns_none_when_absent(self, container: ServiceContainer) -> None:
        captured: list[Any] = []

        def factory(resolver: Resolver) -> Decoder:
            captured.append(resolver.try_resolve("optional"))
            return Decoder()

        container.register(Decoder, factory)
        container.resolve(Decoder)
        assert captured == [None]

    def test_resolve_all_preserves_order(self, container: ServiceContainer) -> None:
        container.register("a", lambda _resolver: 1)
        container.register("b", lambda _resolver: 2)
        captured: list[Any] = []

        def factory(resolver: Resolver) -> Decoder:
            captured.extend(resolver.resolve_all(["b", "a"]))
            return Decoder()

        container.register(Decoder, factory, depends_on=("a", "b"))
        container.resolve(Decoder)
        assert captured == [2, 1]


class TestConcurrency:
    def test_concurrent_resolution_is_safe(self, container: ServiceContainer) -> None:
        container.register(Decoder, lambda _resolver: Decoder())
        container.register(
            RenderEngine,
            lambda resolver: RenderEngine(resolver.resolve(Decoder)),
            depends_on=(Decoder,),
        )
        errors: list[BaseException] = []
        results: list[Any] = []
        lock = threading.Lock()

        def worker() -> None:
            try:
                for _ in range(200):
                    engine = container.resolve(RenderEngine)
                    with lock:
                        results.append(engine)
            except BaseException as exc:  # collect for the assertion below
                with lock:
                    errors.append(exc)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        assert errors == []
        assert len(results) == 1_600
        assert len({id(item) for item in results}) == 1, "singleton must be shared"

    def test_concurrent_scoped_resolution(self, container: ServiceContainer) -> None:
        container.register(
            "session",
            lambda resolver: ProjectSession(resolver.scope.scope_id if resolver.scope else "?"),
            lifetime=Lifetime.SCOPED,
        )
        for index in range(4):
            container.create_scope(f"p{index}")
        errors: list[BaseException] = []
        seen: dict[str, set[int]] = {}
        lock = threading.Lock()

        def worker(scope_id: str) -> None:
            try:
                for _ in range(100):
                    session = container.resolve("session", scope_id=scope_id)
                    assert session.project_id == scope_id
                    with lock:
                        seen.setdefault(scope_id, set()).add(id(session))
            except BaseException as exc:  # collect for the assertion below
                with lock:
                    errors.append(exc)

        threads = [threading.Thread(target=worker, args=(f"p{index}",)) for index in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        assert errors == []
        assert {key: len(value) for key, value in seen.items()} == {
            "p0": 1,
            "p1": 1,
            "p2": 1,
            "p3": 1,
        }


class TestDiagnostics:
    def test_describe_lists_the_graph(self, container: ServiceContainer) -> None:
        container.register(Decoder, lambda _resolver: Decoder())
        container.register(
            RenderEngine,
            lambda resolver: RenderEngine(resolver.resolve(Decoder)),
            depends_on=(Decoder,),
        )
        described = container.describe()
        assert any("Decoder [singleton]" in line for line in described)
        assert any("RenderEngine [singleton] -> Decoder" in line for line in described)

    def test_stats(self) -> None:
        """A fresh container so the fixture's pre-seeded instances do not count."""
        container = ServiceContainer(name="stats")
        container.register(Decoder, lambda _resolver: Decoder())
        container.resolve(Decoder)
        container.resolve(Decoder)
        stats = container.stats()
        assert stats == {
            "name": "stats",
            "registrations": 1,
            "singletons_cached": 1,
            "scopes_open": 0,
            "resolutions": 1,  # the cached second resolve does not build again
            "rebinds": 0,
        }

    def test_clear_singletons(self, container: ServiceContainer) -> None:
        container.register(Decoder, lambda _resolver: Decoder())
        first = container.resolve(Decoder)
        container.clear_singletons()
        assert container.resolve(Decoder) is not first

    def test_child_container_is_isolated(self, container: ServiceContainer) -> None:
        container.register(Decoder, lambda _resolver: Decoder("parent"))
        child = container.child(name="plugin")
        child.rebind(Decoder, lambda _resolver: Decoder("child"))
        assert child.resolve(Decoder).label == "child"
        assert container.resolve(Decoder).label == "parent"


class TestEventBusIntegration:
    def test_scope_disposal_is_published(self) -> None:
        bus = EventBus(autostart=False)
        seen: list[Any] = []
        bus.subscribe("di.scope.disposed", lambda e: seen.append(e.payload), mode=DeliveryMode.SYNC)
        container = ServiceContainer(event_bus=bus)
        container.create_scope("p1")
        container.dispose_scope("p1")
        assert seen == [{"scope_id": "p1"}]
        bus.shutdown()
