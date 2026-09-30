from __future__ import annotations

import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SYNC_SERVER_ROOT = REPO_ROOT / "services" / "sync-server"

for path in (REPO_ROOT, SYNC_SERVER_ROOT):
    path_str = str(path)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)
