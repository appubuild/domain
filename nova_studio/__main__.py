"""Enable ``python -m nova_studio``.

Kept to a single delegation so that the module-import path and the installed
console script cannot drift apart: both end up in :func:`nova_studio.cli.main`.
"""

from __future__ import annotations

from nova_studio.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
