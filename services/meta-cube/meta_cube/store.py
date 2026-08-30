from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any


class FileStore:
    """Small atomic JSON store; deliberately local, never presented as Redis."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.lock = threading.RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write({"executions": {}, "idempotency": {}, "checkpoints": {}, "dlq": {}})

    def read(self) -> dict[str, Any]:
        with self.lock:
            try:
                return json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise RuntimeError(f"cannot read META-CUBE state at {self.path}: {exc}") from exc

    def update(self, data: dict[str, Any]) -> None:
        with self.lock:
            self._write(data)

    def _write(self, data: dict[str, Any]) -> None:
        descriptor, temporary = tempfile.mkstemp(prefix=".meta-cube-", dir=self.path.parent, text=True)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(data, handle, sort_keys=True, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)