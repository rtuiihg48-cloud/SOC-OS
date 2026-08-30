from __future__ import annotations

import json
import os
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Protocol, runtime_checkable


@runtime_checkable
class Store(Protocol):
    """Synchronous authoritative state contract used by ExecutionEngine."""

    def read(self) -> dict[str, Any]: ...
    def update(self, data: dict[str, Any]) -> None: ...
    def lock(self, scope: str) -> Iterator[None]: ...
    def close(self) -> None: ...


class FileStore:
    """Small atomic JSON store; deliberately local, never presented as Redis."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._lock = threading.RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write({"executions": {}, "idempotency": {}, "operations": {}, "checkpoints": {}, "dlq": {}})

    def read(self) -> dict[str, Any]:
        with self._lock:
            try:
                return json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise RuntimeError(f"cannot read META-CUBE state at {self.path}: {exc}") from exc

    def update(self, data: dict[str, Any]) -> None:
        with self._lock:
            self._write(data)

    @contextmanager
    def lock(self, _scope: str) -> Iterator[None]:
        # Engine also owns an in-process lock. This preserves the Store
        # contract while intentionally making file-mode locking local only.
        with self._lock:
            yield

    def close(self) -> None:
        return None

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