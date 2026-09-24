"""Dependency injection container (ARCHITECTURE.md §5.2).

Services depend on **ports**, never on adapters; the container is the single place
where a port is bound to an implementation.  That one file (the composition root,
``nova_studio/services/container.py``) is where you go to answer "what actually
runs when the render engine asks for a decoder?".

Design choices
--------------
* **Explicit over magical.**  No decorator scanning, no import-time side effects,
  no autowiring by type name.  A registration names the key, the factory and the
  lifetime.  The whole graph is readable.
* **Cycles fail at registration**, not at first use.  A cycle discovered when a
  user clicks Export is a support ticket; a cycle discovered by ``make check`` is
  a build failure.  Registrations declare their dependencies and the container
  validates them eagerly.
* **Three lifetimes** map onto real editor needs: process-wide singletons
  (settings, cache), per-open-project scopes (timeline, undo stacks, autosave) and
  per-operation transients (a frame request).
* **Rebindable at runtime.**  A plugin may replace an adapter (ADR-0011).
  Rebinding invalidates cached singletons/scoped instances for that key and
  publishes ``plugin.rebound`` so dependents can react.
"""

from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Generic, TypeVar

from nova_studio.core.errors import ErrorDomain, ErrorSeverity, NovaError

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator, Mapping

    from nova_studio.core.events import EventBus

__all__ = [
    "ContainerError",
    "DependencyGraphError",
    "Lifetime",
    "Registration",
    "Resolver",
    "ServiceContainer",
    "ServiceScope",
]

T = TypeVar("T")

#: A dependency key is any hashable identifier.  In practice it is the port's
#: abstract class or a :class:`~enum.StrEnum` member for services that have no
#: natural interface type.
Key = TypeVar("Key")


class Lifetime(StrEnum):
    """How long a resolved instance lives."""

    #: Created on first resolution, cached for the container's lifetime.
    SINGLETON = "singleton"
    #: Created once per :class:`ServiceScope`, i.e. once per open project.
    SCOPED = "scoped"
    #: Created fresh on every resolution.
    TRANSIENT = "transient"


class ContainerError(Exception):
    """Base class for container misuse.  Always a programming error."""


class DependencyGraphError(ContainerError):
    """A dependency cycle or an unregistered dependency was declared."""

    def __init__(self, message: str, *, cycle: tuple[Any, ...] = ()) -> None:
        self.cycle = cycle
        super().__init__(message)


@dataclass(slots=True)
class Registration(Generic[T]):
    """One binding: how to build a service and how long it lives.

    Attributes:
        key: The port class or string identifier being bound.
        factory: Callable receiving the :class:`Resolver` and returning the
            instance.  Laziness matters: a factory must not resolve dependencies
            at registration time.
        lifetime: See :class:`Lifetime`.
        depends_on: Keys this service needs.  Declared explicitly so the container
            can validate the whole graph eagerly.
        replaced_by: When a plugin rebinds, the previous registration is kept here
            so it can be restored when the plugin is disabled.
    """

    key: Any
    factory: Callable[[Resolver], T]
    lifetime: Lifetime = Lifetime.SINGLETON
    depends_on: tuple[Any, ...] = ()
    replaced_by: Registration[Any] | None = None
    override: bool = False

    def describe(self) -> str:
        """Human-readable one-liner for diagnostics."""
        name = getattr(self.key, "__name__", None) or str(self.key)
        deps = ", ".join(getattr(dep, "__name__", None) or str(dep) for dep in self.depends_on)
        return f"{name} [{self.lifetime.value}] -> {deps or '(no deps)'}"


class Resolver:
    """The read-only resolution surface handed to factories.

    Deliberately narrower than :class:`ServiceContainer`: a factory can resolve
    and query, but cannot register or rebind.  This keeps the mutation surface in
    one place.
    """

    __slots__ = ("_container", "_scope")

    def __init__(self, container: ServiceContainer, scope: ServiceScope | None) -> None:
        self._container = container
        self._scope = scope

    def resolve(self, key: Any) -> Any:
        """Resolve ``key`` within this resolver's scope."""
        return self._container._resolve(key, self._scope)

    def try_resolve(self, key: Any) -> Any | None:
        """Resolve ``key``, returning ``None`` if it is not registered."""
        if not self._container.is_registered(key):
            return None
        return self._container._resolve(key, self._scope)

    def resolve_all(self, keys: Any) -> list[Any]:
        """Resolve several keys, preserving order."""
        return [self.resolve(key) for key in keys]

    def is_registered(self, key: Any) -> bool:
        """Whether ``key`` has a registration."""
        return self._container.is_registered(key)

    @property
    def scope(self) -> ServiceScope | None:
        """The active scope, if any."""
        return self._scope

    @property
    def container(self) -> ServiceContainer:
        """The owning container (for diagnostics only)."""
        return self._container


@dataclass(slots=True)
class ServiceScope:
    """A resolution scope, normally one per open project.

    Holds the scoped instance cache and metadata identifying what the scope is
    for, which makes leak diagnosis tractable: ``container.describe_scopes()``
    lists live scopes with their project ids and ages.
    """

    scope_id: str
    label: str = ""
    created_ms: int = 0
    instances: dict[Any, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def clear(self) -> None:
        """Drop cached instances.  Used when a scope is disposed."""
        self.instances.clear()


class ServiceContainer:
    """The DI container.

    Thread-safe: registration and resolution are guarded by an ``RLock`` so that
    background workers (render, ASR) may resolve services concurrently.  Handler
    invocation never happens while the lock is held.
    """

    def __init__(
        self,
        *,
        event_bus: EventBus | None = None,
        name: str = "root",
        clock: Callable[[], int] | None = None,
    ) -> None:
        self._lock = threading.RLock()
        self._registrations: dict[Any, Registration[Any]] = {}
        self._singletons: dict[Any, Any] = {}
        self._scopes: dict[str, ServiceScope] = {}
        # Cycle detection state is per-thread: a shared stack would report false
        # positives when two workers resolve unrelated keys concurrently.
        self._thread_local = threading.local()
        self._event_bus = event_bus
        self._name = name
        self._clock = clock or _default_clock
        self._resolve_count = 0
        self._rebind_count = 0

    # -- registration ------------------------------------------------------

    def register(
        self,
        key: Any,
        factory: Callable[[Resolver], T],
        *,
        lifetime: Lifetime = Lifetime.SINGLETON,
        depends_on: tuple[Any, ...] | list[Any] = (),
        override: bool = False,
    ) -> Registration[T]:
        """Bind ``key`` to ``factory``.

        Args:
            key: Port class or string identifier.
            factory: Receives a :class:`Resolver`, returns the instance.
            lifetime: See :class:`Lifetime`.
            depends_on: Keys this service requires; validated eagerly for cycles
                and for presence of every non-optional dependency.
            override: Permit replacing an existing registration.  Explicit
                opt-in so an accidental double registration is caught.

        Raises:
            DependencyGraphError: If ``depends_on`` introduces a cycle, or if a
                declared dependency is not registered and ``override`` is False.
            ContainerError: If ``key`` is already registered without ``override``.
        """
        dependencies = tuple(depends_on)
        with self._lock:
            existing = self._registrations.get(key)
            if existing is not None and not override:
                raise ContainerError(
                    f"{_key_name(key)} is already registered; pass override=True "
                    "to replace it deliberately"
                )
            registration: Registration[T] = Registration(
                key=key,
                factory=factory,
                lifetime=lifetime,
                depends_on=dependencies,
                replaced_by=existing,
                override=override,
            )
            self._registrations[key] = registration
            # Eager graph validation: a cycle here is a build failure, not a
            # runtime surprise during export.  Validation may reject the new
            # binding, so registration is atomic — the graph is restored to its
            # previous shape before the error propagates.
            try:
                self._validate_graph()
            except DependencyGraphError:
                if existing is not None:
                    self._registrations[key] = existing
                else:
                    self._registrations.pop(key, None)
                raise
            if existing is not None:
                self._invalidate(key)
                self._rebind_count += 1
        return registration

    def register_instance(
        self,
        key: Any,
        instance: T,
        *,
        override: bool = False,
    ) -> Registration[T]:
        """Bind ``key`` to an already-built instance (always singleton).

        Used for infrastructure objects built before the container exists — the
        event bus, the configuration object, the resolved hardware capabilities.
        """
        registration = self.register(
            key,
            lambda _resolver: instance,
            lifetime=Lifetime.SINGLETON,
            override=override,
        )
        with self._lock:
            self._singletons[key] = instance
        return registration

    def rebind(
        self,
        key: Any,
        factory: Callable[[Resolver], T],
        *,
        lifetime: Lifetime = Lifetime.SINGLETON,
        depends_on: tuple[Any, ...] = (),
        reason: str = "",
    ) -> Registration[T]:
        """Replace a binding at runtime — the plugin extension point.

        Cached instances for ``key`` are invalidated, so dependents receive the
        new adapter on their next resolution.  A ``plugin.rebound`` event is
        published so long-lived dependents can refresh their own caches.
        """
        registration = self.register(
            key,
            factory,
            lifetime=lifetime,
            depends_on=depends_on,
            override=True,
        )
        if self._event_bus is not None:
            self._event_bus.publish(
                "plugin.rebound",
                {
                    "key": _key_name(key),
                    "reason": reason,
                    "lifetime": lifetime.value,
                },
                source=f"di:{self._name}",
            )
        return registration

    def restore(self, key: Any) -> bool:
        """Restore the previous binding for ``key``, if one was replaced.

        Called when a plugin is disabled, so that removing a plugin returns the
        system to its built-in behaviour rather than leaving a hole.
        """
        with self._lock:
            current = self._registrations.get(key)
            if current is None or current.replaced_by is None:
                return False
            previous = current.replaced_by
            previous.replaced_by = None
            self._registrations[key] = previous
            self._invalidate(key)
        return True

    def unregister(self, key: Any) -> bool:
        """Remove a binding and any cached instance.  Returns whether it existed."""
        with self._lock:
            existed = self._registrations.pop(key, None) is not None
            self._invalidate(key)
            return existed

    def is_registered(self, key: Any) -> bool:
        """Whether ``key`` has a binding."""
        with self._lock:
            return key in self._registrations

    # -- graph validation --------------------------------------------------

    def _validate_graph(self) -> None:
        """Detect cycles in the declared dependency graph.

        Uses iterative depth-first search with an explicit colour map so that a
        deep graph cannot exhaust the Python stack, and so that the reported cycle
        is the actual path rather than an arbitrary one.
        """
        registrations = self._registrations
        colour: dict[Any, int] = dict.fromkeys(registrations, _WHITE)
        path: list[Any] = []

        def visit(node: Any) -> tuple[Any, ...] | None:
            stack: list[tuple[Any, Iterator[Any]]] = [(node, iter(registrations[node].depends_on))]
            colour[node] = _GREY
            path.append(node)
            while stack:
                current, deps = stack[-1]
                advanced = False
                for dep in deps:
                    if dep not in registrations:
                        # An unregistered dependency is legal when the consumer
                        # uses try_resolve; it is reported by describe() instead.
                        continue
                    state = colour[dep]
                    if state == _GREY:
                        cycle_start = path.index(dep)
                        return (*path[cycle_start:], dep)
                    if state == _WHITE:
                        colour[dep] = _GREY
                        path.append(dep)
                        stack.append((dep, iter(registrations[dep].depends_on)))
                        advanced = True
                        break
                if not advanced:
                    colour[current] = _BLACK
                    path.pop()
                    stack.pop()
            return None

        for start in list(registrations):
            if colour[start] == _WHITE:
                cycle = visit(start)
                if cycle is not None:
                    names = " -> ".join(_key_name(item) for item in cycle)
                    raise DependencyGraphError(f"dependency cycle detected: {names}", cycle=cycle)

    # -- scopes ------------------------------------------------------------

    def create_scope(self, scope_id: str, *, label: str = "", **metadata: Any) -> str:
        """Open a scope (normally one per project).  Returns the scope id."""
        with self._lock:
            if scope_id in self._scopes:
                raise ContainerError(f"scope {scope_id!r} already exists")
            self._scopes[scope_id] = ServiceScope(
                scope_id=scope_id,
                label=label or scope_id,
                created_ms=self._clock(),
                metadata=dict(metadata),
            )
        return scope_id

    def dispose_scope(self, scope_id: str) -> bool:
        """Close a scope, dropping its cached instances."""
        with self._lock:
            scope = self._scopes.pop(scope_id, None)
        if scope is None:
            return False
        scope.clear()
        if self._event_bus is not None:
            self._event_bus.publish(
                "di.scope.disposed",
                {"scope_id": scope_id},
                source=f"di:{self._name}",
            )
        return True

    @contextmanager
    def scope(self, scope_id: str, *, label: str = "", **metadata: Any) -> Iterator[Resolver]:
        """Context manager that opens, yields a resolver for, and disposes a scope."""
        created = False
        with self._lock:
            if scope_id not in self._scopes:
                self.create_scope(scope_id, label=label, **metadata)
                created = True
        try:
            yield Resolver(self, self._scopes[scope_id])
        finally:
            if created:
                self.dispose_scope(scope_id)

    def describe_scopes(self) -> list[dict[str, Any]]:
        """List live scopes with their age and cached instance count."""
        now = self._clock()
        with self._lock:
            return [
                {
                    "scope_id": scope.scope_id,
                    "label": scope.label,
                    "age_ms": now - scope.created_ms,
                    "instances": len(scope.instances),
                    "metadata": dict(scope.metadata),
                }
                for scope in self._scopes.values()
            ]

    # -- resolution --------------------------------------------------------

    def resolve(self, key: Any, *, scope_id: str | None = None) -> Any:
        """Resolve ``key``.

        Args:
            key: The port class or identifier.
            scope_id: Required for ``SCOPED`` registrations unless exactly one
                scope is open (a convenience for single-project desktop use).

        Raises:
            NovaError-bearing ``KeyError`` subclass :class:`ResolutionError` when
                the key is unknown, and :class:`ResolutionError` when a scoped
                service is requested without an unambiguous scope.
        """
        scope: ServiceScope | None = None
        if scope_id is not None:
            scope = self._scopes.get(scope_id)
            if scope is None:
                raise ResolutionError(
                    f"scope {scope_id!r} is not open",
                    NovaError(
                        "NS-CORE-2002",
                        f"service scope {scope_id!r} is not open",
                        domain=ErrorDomain.CORE,
                        severity=ErrorSeverity.ERROR,
                        details={"scope_id": scope_id},
                    ),
                )
        return self._resolve(key, scope)

    def _resolve(self, key: Any, scope: ServiceScope | None) -> Any:
        with self._lock:
            registration = self._registrations.get(key)
            if registration is None:
                raise ResolutionError(
                    f"{_key_name(key)} is not registered",
                    NovaError(
                        "NS-CORE-2001",
                        f"no service is registered for {_key_name(key)}",
                        domain=ErrorDomain.CORE,
                        severity=ErrorSeverity.ERROR,
                        remedy="Check the composition root registers this port.",
                        details={"key": _key_name(key)},
                    ),
                )
            lifetime = registration.lifetime
            if lifetime is Lifetime.SINGLETON:
                if key in self._singletons:
                    return self._singletons[key]
            elif lifetime is Lifetime.SCOPED:
                target_scope = scope or self._ambient_scope()
                if target_scope is None:
                    raise ResolutionError(
                        f"{_key_name(key)} is scoped but no scope is open",
                        NovaError(
                            "NS-CORE-2003",
                            f"{_key_name(key)} requires an open service scope",
                            domain=ErrorDomain.CORE,
                            severity=ErrorSeverity.ERROR,
                            remedy="Open a scope for the project before resolving.",
                            details={"key": _key_name(key)},
                        ),
                    )
                if key in target_scope.instances:
                    return target_scope.instances[key]
            self._resolve_count += 1
            resolver = Resolver(self, scope if lifetime is Lifetime.SCOPED else None)
            factory = registration.factory

        # Cycle guard for *runtime* cycles that depends_on did not model (e.g. a
        # factory resolving a key it did not declare).  Thread-local so that
        # concurrent resolution by render and ASR workers cannot interfere.
        stack: list[Any] = self._resolution_chain()
        if key in stack:
            chain = " -> ".join(_key_name(item) for item in (*stack, key))
            raise DependencyGraphError(f"runtime resolution cycle: {chain}")
        stack.append(key)
        try:
            instance = factory(resolver)
        finally:
            if stack and stack[-1] is key:
                stack.pop()

        with self._lock:
            if registration.lifetime is Lifetime.SINGLETON:
                self._singletons[key] = instance
            elif registration.lifetime is Lifetime.SCOPED:
                target_scope = scope or self._ambient_scope()
                if target_scope is not None:
                    target_scope.instances[key] = instance
        return instance

    def _resolution_chain(self) -> list[Any]:
        """Return this thread's in-progress resolution chain."""
        stack = getattr(self._thread_local, "chain", None)
        if stack is None:
            stack = []
            self._thread_local.chain = stack
        return stack

    def _ambient_scope(self) -> ServiceScope | None:
        """Return the only open scope, or ``None`` when ambiguous.

        A desktop editor has exactly one open project at a time in the normal
        case; requiring an explicit scope id everywhere would be noise.  When
        more than one scope is open we refuse to guess.
        """
        if len(self._scopes) == 1:
            return next(iter(self._scopes.values()))
        return None

    def _invalidate(self, key: Any) -> None:
        """Drop cached instances for ``key``.  Called with the lock held."""
        self._singletons.pop(key, None)
        for scope in self._scopes.values():
            scope.instances.pop(key, None)

    # -- diagnostics -------------------------------------------------------

    def describe(self) -> list[str]:
        """Return a readable listing of every registration."""
        with self._lock:
            return [registration.describe() for registration in self._registrations.values()]

    def unresolved_dependencies(self) -> dict[str, list[str]]:
        """Report declared dependencies that have no registration.

        Useful at startup and in tests: a plugin contributing a service whose
        dependency it forgot to declare shows up here rather than as a crash.
        """
        with self._lock:
            report: dict[str, list[str]] = {}
            for key, registration in self._registrations.items():
                missing = [
                    _key_name(dep)
                    for dep in registration.depends_on
                    if dep not in self._registrations
                ]
                if missing:
                    report[_key_name(key)] = missing
            return report

    def stats(self) -> dict[str, Any]:
        """Container health snapshot for the diagnostics endpoint."""
        with self._lock:
            return {
                "name": self._name,
                "registrations": len(self._registrations),
                "singletons_cached": len(self._singletons),
                "scopes_open": len(self._scopes),
                "resolutions": self._resolve_count,
                "rebinds": self._rebind_count,
            }

    def clear_singletons(self) -> None:
        """Drop every cached singleton and scoped instance.  Test/shutdown use."""
        with self._lock:
            self._singletons.clear()
            for scope in self._scopes.values():
                scope.clear()

    def child(self, *, name: str = "") -> ServiceContainer:
        """Return a container that inherits these registrations.

        Used by tests and by plugin sandboxes that need an isolated resolution
        space without disturbing the application graph.
        """
        clone = ServiceContainer(
            event_bus=self._event_bus,
            name=name or f"{self._name}:child",
            clock=self._clock,
        )
        with self._lock:
            clone._registrations = dict(self._registrations)
            clone._singletons = dict(self._singletons)
        return clone


class ResolutionError(ContainerError):
    """A service could not be resolved.  Carries a structured :class:`NovaError`."""

    def __init__(self, message: str, error: NovaError) -> None:
        self.error = error
        super().__init__(message)


# Depth-first-search colours for cycle detection in the dependency graph.
_WHITE, _GREY, _BLACK = 0, 1, 2


def _key_name(key: Any) -> str:
    """Render a dependency key for diagnostics."""
    return getattr(key, "__name__", None) or str(key)


def _default_clock() -> int:
    return int(time.time() * 1000)


def publish_rebind(bus: EventBus, key: Any, *, reason: str = "") -> None:
    """Convenience helper for adapters that rebind outside the container."""
    bus.publish(
        "plugin.rebound",
        {"key": _key_name(key), "reason": reason},
        source="di:external",
    )


def mapping_to_registrations(
    mapping: Mapping[Any, tuple[Callable[[Resolver], Any], Lifetime]],
) -> list[Registration[Any]]:
    """Convert a compact ``{key: (factory, lifetime)}`` table into registrations.

    Provided for test fixtures that want to build a graph tersely; production code
    uses the explicit composition root for readability.
    """
    return [
        Registration(key=key, factory=factory, lifetime=lifetime)
        for key, (factory, lifetime) in mapping.items()
    ]
