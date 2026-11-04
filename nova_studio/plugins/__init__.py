"""The plugin runtime: discovery, permissions, contribution points and the SDK.

Plugins are how Nova Studio stays extensible for a decade without the core
accumulating every niche requirement (ADR-0011).  A plugin is a directory holding a
``manifest.json``, an optional Python entrypoint and an optional frontend bundle.
It runs **in-process** and contributes to typed registries through declared
contribution points.

Because in-process means "shares our memory and our file handles", permission is
enforced rather than advisory.  Three layers, all of which must agree:

* **Static** — manifest parsing rejects unknown permissions outright, so a plugin
  cannot claim a capability the runtime has never heard of.
* **Dynamic** — a ``sys.addaudithook`` observer attributes audited events (``open``,
  ``socket.connect``, ``subprocess.Popen``, ``os.remove``, …) to the active plugin
  scope via a contextvar and denies anything outside the declared set.  Denials are
  logged, counted and shown to the user.
* **API** — a plugin receives a ``PluginContext`` exposing only permitted services,
  a capability-filtered *view* of the DI container.  It never receives the
  container, because a container can resolve anything.

The recognised permissions are ``fs.read``, ``fs.write.workspace``,
``fs.write.user``, ``net``, ``gpu``, ``process``, ``project.read``,
``project.write``, ``settings.write`` and ``ui.notify``.

Fault isolation is non-negotiable: every entrypoint invocation is guarded, its
exceptions caught, attributed and reported as ``Err``, and a per-plugin circuit
breaker disables a plugin after repeated faults in a window (default 5 in 60 s)
while preserving its state.  **A plugin can never take down the editor.**  Loading
is lazy, so an effect plugin costs nothing until its effect is actually applied.

Layout (populated in Stage 10)::

    sdk/           the only surface a Python plugin may import — re-exported ports
                   and value objects.  Internal modules are not part of the
                   contract, and importing them is detected and warned about so the
                   core can keep refactoring freely.
    manifest.py    schema, parsing, signature verification, version compatibility
    discovery.py   locate plugin directories, resolve dependency order
    sandbox.py     the audit hook, capability scopes, denial accounting
    lifecycle.py   discover → verify → validate → resolve → load → enable →
                   disable | fault → unload
    registry.py    typed contribution-point registries
    breaker.py     per-plugin circuit breaker

Contribution points: ``effects``, ``transitions``, ``captions``, ``export``,
``ai`` and ``themes``.  Each is a typed registry, so a contribution that does not
match its point's protocol is rejected at load time rather than failing later
during a render.

Known residual risk, recorded deliberately rather than hidden: JavaScript plugins
are **not** truly sandboxed in v1.  They run with signature verification, declared
permissions and marketplace review instead of an iframe/worker jail, because a jail
would cost the shared canvas that makes UI contributions useful.  See ADR-0011.
"""

from __future__ import annotations
