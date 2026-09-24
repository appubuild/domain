# ADR-0014 — PyInstaller onedir portable layout with adjacent data dir

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Architecture Group

## Context

The product must ship as a **Windows portable EXE**: no installer, no admin rights, no
registry writes, runnable from a USB stick, and self-contained enough to work on a machine
with no Python, no FFmpeg and no Node. It must also be buildable from CI and updatable
without a store.

PyInstaller's `--onefile` mode is the usual answer for "portable", and it is wrong for this
product: it extracts the whole bundle to a temp directory on *every* launch (3–8 s for a
bundle containing FFmpeg, OpenCV, NumPy and a WebView runtime), it breaks DLL locality for
GPU drivers and FFmpeg's dependencies, it interacts badly with antivirus (a self-extracting
archive of native binaries), and it makes incremental updates impossible.

## Decision

1. **onedir layout**: `NovaStudio/NovaStudio.exe` + `NovaStudio/_internal/…`. Launch is a
   direct process start with no extraction step. The whole folder is the product; copying it
   copies the install.
2. **Data directory resolution** (`core/config.py`, in this order):
   1. `NOVA_DATA_DIR` env var (explicit override, used by tests and CI);
   2. `./NovaData` adjacent to the executable **if that directory is writable** — true
      portable behaviour;
   3. `%LOCALAPPDATA%/NovaStudio` (Windows) / `~/.local/share/NovaStudio` (Linux) /
      `~/Library/Application Support/NovaStudio` (macOS).
   Writability is *tested*, not assumed (a USB stick may be read-only; `Program Files` is not
   writable without admin). The resolved root is logged at startup and shown in
   Settings ▸ About.
3. **Nothing is written outside the data dir** — no registry, no `%APPDATA%`, no temp files
   except explicitly-scoped short-lived render temporaries inside
   `<data>/tmp`, cleaned at startup. This is what makes the app genuinely portable and
   uninstallable-by-deletion.
4. **Single-instance enforcement** via a lockfile + named pipe in the data dir. A second
   launch forwards its arguments (e.g. a double-clicked `.nova` file) to the running instance
   and exits, focusing the existing window.
5. **Bundled assets**: the frontend production build (`frontend/dist`), the static FFmpeg
   binary, `imageio_ffmpeg`'s runtime, ICU/locale data needed by OpenCV, and the plugin SDK
   stubs. Whisper model weights are **not** bundled by default (they are 75 MB–3 GB); a
   downloader with resume, checksum verification and mirror support fetches them into
   `<data>/models` on first use (ADR-0009 §4).
6. **Hidden-import discipline**: PyInstaller's static analysis misses dynamically imported
   modules (pywebview backends, OpenCV/PyAV plugin loaders, faster-whisper's optional
   deps). Every required hidden import is declared explicitly in the spec file with a comment
   explaining *why*, and a **packaging smoke test** launches the built EXE, waits for
   `/health/ready`, creates a project, imports a generated clip, renders one frame and
   exports — so a missing hidden import fails the build, not the user's machine.
7. **Updates** (ADR: `services/updater`): a signed manifest declares version, delta/full
   package URL, SHA-256 and minimum OS. Download goes to `<data>/tmp`, is verified, staged
   into `<data>/updates/<version>`, and applied by a tiny launcher on next start (swap
   `_internal` then restart). Rollback keeps the previous staged version. No silent updates.
8. **Code signing** is part of the release pipeline; an unsigned build is a release failure,
   because SmartScreen reputation is a real user-facing cost for portable apps.

## Consequences

**Positive**

* Instant launch, no extraction, works from read-only media (falls back to `%LOCALAPPDATA%`).
* Trivially uninstallable: delete the folder.
* Incremental, resumable, verifiable updates without an installer or a store.
* CI can smoke-test the actual shipped artefact, catching packaging-only bugs.

**Negative / accepted**

* The download is a zip of a folder (~250–400 MB with FFmpeg + OpenCV + WebView deps) rather
  than a single file. Accepted; compression and delta updates mitigate it.
* Users may put the folder somewhere non-writable and be surprised that data lands in
  `%LOCALAPPDATA%`. Mitigated by showing the resolved data dir in About and on first run.
* Hidden imports are brittle across dependency upgrades. Mitigated by the packaging smoke
  test being a required CI gate.
* Antivirus heuristics still flag unsigned native bundles — hence mandatory signing (§8).

## Alternatives considered

| Option | Rejected because |
| --- | --- |
| PyInstaller `--onefile` | Slow launch, extraction to temp, DLL locality and AV problems, no incremental updates |
| MSIX / AppX package | Requires signing infrastructure and store tooling; not "portable" |
| WiX/NSIS installer | Contradicts the portable requirement; needs admin for machine-wide install |
| Electron-style distribution | Contradicts ADR-0003 and multiplies the bundle with a second runtime |
| Nuitka compilation | Better raw performance, but much longer builds, weaker support for PyAV/OpenCV/faster-whisper native deps, and a smaller community for troubleshooting |
| cx_Freeze / py2exe | Less maintained; weaker hook ecosystem for our dependency set |
