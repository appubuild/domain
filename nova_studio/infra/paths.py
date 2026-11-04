"""L4 — where the application lives on this machine.

One question, one answer, one module: **where do we write?** A desktop editor
writes in several places — projects the user names, a data directory we choose,
logs, caches — and every one of them has a platform convention. Getting them
right is the difference between an application a user can uninstall and one that
scatters state across their home directory for a decade.

Three rules:

* **The environment always wins.** A portable build sets `NOVA_DATA_DIR` and
  expects everything to follow; that is how ADR-0014's "one folder the user can
  copy" promise is kept, and it is why the override is checked first and
  reported separately (the UI tells the user when their data is portable).
* **The platform default is the platform's own convention** — `%LOCALAPPDATA%`
  on Windows, `~/Library/Application Support` on macOS, `$XDG_DATA_HOME` on
  Linux. Not a dotfile in `$HOME`: Linux has a standard, and the standard is
  what lets a package manager clean up after us.
* **Nothing here imports anything heavy.** It is path arithmetic and one
  environment lookup, so it can be used by the CLI, the API and the desktop
  shell without any of them dragging in the media stack.

The *shape* of what goes inside the data directory (journals, the cache
database) is `infra/persistence/paths.py`. This module answers only where the
root is.
"""

from __future__ import annotations

import os
import platform
from pathlib import Path
from typing import Final

__all__ = [
    "APP_NAME",
    "DATA_DIR_ENV",
    "data_dir",
    "default_data_dir",
]

#: The environment variable that relocates all writable state (ADR-0014). A
#: portable build sets it so the application carries its data next to the
#: executable instead of writing into the user's profile.
DATA_DIR_ENV: Final[str] = "NOVA_DATA_DIR"

#: The directory name used on every platform, modulo case conventions.
APP_NAME: Final[str] = "NovaStudio"


def default_data_dir() -> Path:
    """The platform's own convention for this application's writable state.

    Windows: ``%LOCALAPPDATA%/NovaStudio`` · macOS:
    ``~/Library/Application Support/NovaStudio`` · Linux and others:
    ``$XDG_DATA_HOME/nova-studio``, falling back to ``~/.local/share``.
    """
    system = platform.system()
    home = Path.home()
    if system == "Windows":
        base = os.environ.get("LOCALAPPDATA") or str(home / "AppData" / "Local")
        return Path(base) / APP_NAME
    if system == "Darwin":
        return home / "Library" / "Application Support" / APP_NAME
    base = os.environ.get("XDG_DATA_HOME") or str(home / ".local" / "share")
    return Path(base) / "nova-studio"


def data_dir() -> tuple[Path, bool]:
    """Where this process writes its state, and whether the environment chose it.

    Returns:
        A tuple of the directory and a flag: ``True`` when `NOVA_DATA_DIR` set
        it, which is the signal that the whole application is portable and can
        be moved by copying that one folder. The UI shows this, because a user
        who knows their data is portable backs it up differently from one who
        does not.
    """
    override = os.environ.get(DATA_DIR_ENV)
    if override:
        return Path(override).expanduser(), True
    return default_data_dir(), False
