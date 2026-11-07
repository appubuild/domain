"""L4 — the install's settings, as rows.

:class:`~nova_studio.ports.persistence.SettingsStore` on SQLite. Small by
construction: a settings table is read at boot and written when a user changes a
preference, which is the least demanding workload in the editor. What it needs
is not speed but three properties:

**One row per ``(scope, key)``, written in one statement.** A preference is
written while the user is looking at it, and a half-written value is a
preference that reverts on the next launch — which reads as the editor ignoring
the user.

**A read never raises.** A setting that cannot be parsed answers ``None``, so
the caller falls back to its default. A corrupt row is one bad preference, and a
window that will not draw because one setting is unreadable is a failure out of
all proportion to its cause.

**Scoped reads.** ``entries`` takes a scope and returns that scope's keys only.
A panel reading its own settings must not be handed a plugin's, and a store
whose read method returned everything would make that mistake easy.

Values are JSON. A typed accessor belongs to the settings service that knows
what each setting *is*; a store that knew would have to be edited every time a
setting was added.
"""

from __future__ import annotations

import json
import threading
from typing import TYPE_CHECKING, Any, Final

from nova_studio.core.errors import NovaError
from nova_studio.core.result import Result, err, ok
from nova_studio.domain.persistence import Setting
from nova_studio.infra.persistence.migrations import ensure_schema
from nova_studio.infra.persistence.paths import install_database_path
from nova_studio.infra.persistence.sqlite import SqliteError, SqliteGateway
from nova_studio.ports.persistence import PersistenceErrorCode

if TYPE_CHECKING:
    from collections.abc import Mapping
    from pathlib import Path

__all__ = ["SqliteSettingsStore", "open_settings_store"]

_COLUMNS: Final[tuple[str, ...]] = ("scope", "key", "value", "updated_ms")

_UPSERT: Final[str] = f"""
INSERT INTO settings ({", ".join(_COLUMNS)})
VALUES ({", ".join("?" for _ in _COLUMNS)})
ON CONFLICT(scope, key) DO UPDATE SET
    value = excluded.value,
    updated_ms = excluded.updated_ms
"""


def open_settings_store(data_root: Path) -> SqliteSettingsStore:
    """Open this install's settings, creating the database if it is not there."""
    data_root.mkdir(parents=True, exist_ok=True)
    gateway = SqliteGateway(install_database_path(data_root), shared=True)
    gateway.open()
    ensure_schema(gateway)
    return SqliteSettingsStore(gateway)


class SqliteSettingsStore:
    """The `SettingsStore` port, on rows in ``nova.db``.

    Args:
        gateway: An **open** gateway on the install database. Shared, because a
            preference is written from the request pool and read from wherever
            the window asks.
    """

    __slots__ = ("_gateway", "_lock")

    def __init__(self, gateway: SqliteGateway) -> None:
        self._gateway = gateway
        self._lock = threading.RLock()

    # -- the port ---------------------------------------------------------

    def get(self, scope: str, key: str) -> Setting | None:
        """The setting, or ``None`` when it is absent **or unreadable**."""
        with self._lock:
            try:
                rows = self._gateway.rows(
                    f"SELECT {', '.join(_COLUMNS)} FROM settings WHERE scope = ? AND key = ?",
                    (scope, key),
                )
            except SqliteError:
                return None
            for row in rows:
                try:
                    return _setting(row)
                except Exception:
                    # One bad row, and the caller falls back to its default.
                    return None
            return None

    def put(self, setting: Setting) -> Result[None]:
        """Write or overwrite one setting."""
        with self._lock:
            try:
                self._gateway.run(
                    _UPSERT,
                    (
                        setting.scope,
                        setting.key,
                        json.dumps(setting.value, ensure_ascii=False, allow_nan=False),
                        setting.updated_ms,
                    ),
                )
            except SqliteError as error:
                return err(_unavailable(str(error), scope=setting.scope, key=setting.key))
            return ok(None)

    def delete(self, scope: str, key: str) -> Result[None]:
        """Forget one key. Deleting what is not there is not an error."""
        with self._lock:
            try:
                self._gateway.run("DELETE FROM settings WHERE scope = ? AND key = ?", (scope, key))
            except SqliteError as error:
                return err(_unavailable(str(error), scope=scope, key=key))
            return ok(None)

    def entries(self, scope: str) -> Mapping[str, Setting]:
        """Every setting in one scope, keyed by name. Unreadable rows are
        skipped rather than raising: one bad preference hides itself."""
        with self._lock:
            try:
                rows = self._gateway.rows(
                    f"SELECT {', '.join(_COLUMNS)} FROM settings WHERE scope = ?", (scope,)
                )
            except SqliteError:
                return {}
            found: dict[str, Setting] = {}
            for row in rows:
                try:
                    setting = _setting(row)
                except Exception:
                    continue
                found[setting.key] = setting
            return found

    def close(self) -> None:
        """Release the store. The gateway's owner closes it; this is the seam a
        caller uses when it owns the connection outright."""
        with self._lock:
            self._gateway.close()


def _setting(row: Any) -> Setting:
    """Rebuild one row. Raises on anything it cannot trust — the caller decides
    what that is worth."""
    return Setting(
        scope=str(row["scope"]),
        key=str(row["key"]),
        value=json.loads(str(row["value"])),
        updated_ms=int(str(row["updated_ms"])),
    )


def _unavailable(cause: str, *, scope: str, key: str) -> NovaError:
    return NovaError(
        PersistenceErrorCode.UNWRITABLE,
        "the setting could not be written",
        remedy="Check that the application data directory is writable.",
        cause=cause,
        details={"scope": scope, "key": key},
    )
