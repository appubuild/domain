# ADR-0011 — In-process plugins under a declared permission set

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Architecture Group

## Context

"Everything must support plugins" is a product requirement, spanning Python plugins
(effects, transitions, AI tasks, export targets, caption providers) and JavaScript plugins
(UI panels, caption templates, themes).

The naive options both fail. **Out-of-process plugins** (subprocess/gRPC per plugin) cost
serialisation on a per-frame path — unacceptable at 60 fps with a 16.7 ms budget — and make
sharing GPU contexts and NumPy buffers painful. **In-process plugins with no controls** mean
one bad plugin can corrupt project state, exfiltrate media, hang the editor, or crash it,
and we would have no way to attribute the fault.

We also want a marketplace eventually, which requires provenance: signed manifests,
declared capabilities, version compatibility, and a way to disable something that misbehaves
without uninstalling it.

## Decision

1. **Plugins run in-process**, contributing to typed registries via declared
   **contribution points** (§9). A plugin is a directory with a `manifest.json`, an optional
   Python entrypoint and an optional frontend bundle.
2. **Manifest declares everything**: `id` (reverse-DNS, globally unique), `version`
   (SemVer), `min_nova_version` / `max_nova_version`, `entrypoints[]`, `contributes{}`,
   `permissions[]`, `resources{}` (icons, presets, LUTs), `signature`.
3. **Permissions are enforced, not advisory.** `PluginSandbox` wraps each entrypoint call in
   a capability scope built from the manifest: `fs.read`, `fs.write.workspace`, `fs.write.user`,
   `net`, `gpu`, `process`, `project.read`, `project.write`, `settings.write`, `ui.notify`.
   Enforcement is layered:
   * **Static**: manifest parsing rejects unknown permissions; the loader records the set.
   * **Dynamic**: a `sys.addaudithook`-based audit observer attributes audited events
     (`open`, `socket.connect`, `subprocess.Popen`, `os.remove`, …) to the active plugin scope
     via a contextvar, and denies events outside the declared set. Denials are logged,
     counted, and surfaced to the user.
   * **API**: plugins receive a `PluginContext` exposing only permitted services (a
     capability-filtered view of the DI container) — never the container itself.
4. **Fault isolation.** Every entrypoint invocation is guarded: exceptions are caught,
   attributed, counted and reported as `Err`. A per-plugin **circuit breaker** disables the
   plugin after N faults in a window (default 5 in 60 s), preserving its state and telling
   the user exactly what failed. A plugin can never take down the editor.
5. **Deterministic lifecycle**: `discover → verify signature → validate manifest → resolve
   dependency order → load lazily on first contribution use → enable → (disable | fault) →
   unload`. Loading is lazy: an effect plugin costs nothing until its effect is applied.
6. **Python plugins may only use the public SDK surface** (`nova_studio.plugins.sdk`), which
   re-exports the ports and value objects they need. Internal modules are not part of the
   contract; importing them is detected and warned about, so we can refactor freely.
7. **Frontend plugins** contribute declarative documents first (caption templates, themes,
   presets, panels described by a schema) and, where code is required, an ESM bundle that
   runs in the app's realm but receives only a capability-scoped `nova` API object. We do
   **not** sandbox JS in an iframe/worker for v1: the cost (no shared canvas, no design
   system) exceeds the benefit, and the trust model is the same as the Python side —
   signature + permissions + marketplace review. This is recorded as a known residual risk
   with a planned mitigation (Realms/ShadowRealm evaluation when it is broadly available).
8. **Versioning & compatibility.** Contribution interfaces carry a version; the loader
   refuses a plugin whose required interface version is unsupported, with a precise message.
   A plugin registry snapshot is stored in the `plugins` table so a project can report which
   plugins it needs — opening a project that uses a missing plugin degrades gracefully:
   the effect is bypassed, clearly flagged in the UI, and never silently dropped from the
   project file.

## Consequences

**Positive**

* Per-frame plugin cost is a function call, not an IPC round-trip.
* A misbehaving plugin is attributable, disable-able and survivable.
* The marketplace has real provenance: signed manifests + declared permissions the user can
  read before installing.
* Contribution points keep the plugin API small and stable while the internals churn.
* Missing-plugin degradation preserves project files instead of corrupting them.

**Negative / accepted**

* In-process means a plugin can still cause memory pressure or an infinite loop that blocks
  its thread. Mitigated by requiring CPU-heavy contributions to declare `isolation=PROCESS`
  and by watchdog timing on preview-frame contributions (skip the effect after budget
  overrun and flag it).
* `sys.addaudithook` is global and cannot be uninstalled; our observer must be cheap and must
  not itself allocate on the hot path. Measured cost is < 1 µs per audited event, and we
  short-circuit when no plugin scope is active.
* JS plugins are not truly sandboxed in v1 (residual risk above).

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| Out-of-process plugins (gRPC/stdin pipes) | Per-frame IPC breaks the frame budget; GPU/buffer sharing is painful |
| WASM plugins | Excellent isolation, but no mature path to NumPy/OpenCV/GPU interop and a heavy authoring story for our Python-first ecosystem |
| Unrestricted in-process plugins | One bad plugin kills or compromises the editor; no attribution; no marketplace story |
| Declarative-only (no code) | Too limiting for effects/transitions/AI tasks, which are the most requested extension types |
| Separate plugin repository/runtime | Splits the contract from the code that defines it; version drift |
