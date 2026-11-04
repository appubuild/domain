"""L4 — `infra`: the outermost ring, where the machine finally gets touched.

Everything inside `core`, `domain`, `ports` and `services` is testable without a
filesystem, a clock that moves, a codec or a GPU. That is not an aesthetic
preference — it is what makes a ten-year-old codebase changeable — and it is only
possible because the things that *do* touch the machine are all here, behind
ports, in adapters that do one job.

**What belongs in this package, and what does not.**

* **Belongs:** a filesystem, a ZIP, a SQLite file, a subprocess, a device, a
  driver, a clock that reads the wall, randomness for a file name. Anything whose
  failure mode is "the disk is full" or "FFmpeg is not installed".
* **Does not belong:** a decision. Whether to autosave, what to evict from a
  cache, whether a project is too new to open, which proxy resolution to generate
  — all of those are `services` or `domain`, and all of them are testable. An
  adapter that decides policy puts a second copy of the policy where the tests
  are slow and the rule is invisible.

**The rules an adapter here keeps.**

1. **One port, one adapter, one job.** `ports/` declares the capability; this
   package implements it. An adapter does not grow a second capability because
   two call sites wanted it — the port changes instead, and the port is reviewed.
2. **Third-party I/O is imported here and nowhere else.** `av`, `cv2`, `sqlite3`,
   `faster_whisper`, `PIL`, `webview` are banned outside `infra` by
   `scripts/check_layering.py`, and `sqlite3` is further confined to
   `infra/persistence/sqlite.py` by a lint rule — because one driver import in a
   service is a service that can no longer be tested without a database.
3. **Resources are owned and released.** An adapter that opens a file closes it,
   in a `with` or in a `close()` that is safe to call twice. No module state, no
   singletons, no connection that outlives its owner.
4. **Errors cross the boundary as `Result[T]` with the port's codes.** A driver
   exception is a detail; `NS-STORAGE-4001` with a remedy is a sentence the user
   can act on. The one place that raises is a unit of work whose caller's
   bookkeeping is already wrong.
5. **The clock, the ids and the randomness are injected or documented.** An
   adapter may read a clock only because it is the adapter that *is* the clock;
   anything else that needs time takes it as an argument.
6. **Everything here is replaceable.** Every module in this package implements a
   port, so every module can be swapped for a different implementation without a
   service noticing. That is the test of whether the seam is real.

**What is here now.**

```
infra/
└── persistence/    the .nova container, the crash journal, the cache index
                    and the unit of work that commits them in order
```

Still to come, each behind its own port: `media` (PyAV), `render` (FFmpeg and
the GPU), `asr` (Faster Whisper), `clock`, `ident`, `jobs`, and the desktop
adapters ADR-0014 needs for the portable build.
"""

from __future__ import annotations

__all__: list[str] = []
