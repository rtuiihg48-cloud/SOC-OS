from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import threading
from typing import Any
from uuid import uuid4

from .models import Checkpoint, DeadLetterRecord, EventRequest, ExecutionRecord, ExecutionStatus, StepSpec
from .store import FileStore


def _now() -> str:
    return datetime.now(UTC).isoformat()


class ExecutionEngine:
    """Deterministic in-process executor with durable event and step checkpoints."""

    def __init__(self, state_path: str | Path) -> None:
        self.store = FileStore(state_path)
        self._execution_lock = threading.RLock()

    def submit(self, event: EventRequest) -> ExecutionRecord:
        """Compatibility helper for in-process callers: accept then execute."""
        return self.execute(self.accept(event).id)

    def accept(self, event: EventRequest) -> ExecutionRecord:
        with self._execution_lock:
            data = self.store.read()
            key = event.idempotency_key or event.event_id or str(uuid4())
            existing = data["idempotency"].get(key)
            if existing:
                return ExecutionRecord.model_validate(data["executions"][existing])
            execution_id = str(uuid4())
            now = _now()
            record = ExecutionRecord(
                id=execution_id, event_id=event.event_id or execution_id, idempotency_key=key,
                name=event.name, status=ExecutionStatus.CREATED, payload=event.payload, steps=event.steps,
                max_attempts=event.max_attempts, created_at=now, updated_at=now,
            )
            data["executions"][execution_id] = record.model_dump(mode="json")
            data["idempotency"][key] = execution_id
            self.store.update(data)
            return record

    def execute(self, execution_id: str, recovered: bool = False) -> ExecutionRecord:
        """Execute an already durable accepted event; safe to invoke more than once."""
        with self._execution_lock:
            if self.get(execution_id) is None:
                raise KeyError(execution_id)
            return self._run(execution_id, recovered=recovered)

    def get(self, execution_id: str) -> ExecutionRecord | None:
        raw = self.store.read()["executions"].get(execution_id)
        return ExecutionRecord.model_validate(raw) if raw else None

    def list(self) -> list[ExecutionRecord]:
        records = [ExecutionRecord.model_validate(value) for value in self.store.read()["executions"].values()]
        return sorted(records, key=lambda item: item.created_at, reverse=True)

    def checkpoints(self, execution_id: str | None = None) -> list[Checkpoint]:
        values = self.store.read()["checkpoints"]
        rows = [Checkpoint.model_validate(row) for rows in values.values() for row in rows.values()]
        return [row for row in rows if execution_id is None or row.execution_id == execution_id]

    def dlq(self) -> list[DeadLetterRecord]:
        return [DeadLetterRecord.model_validate(item) for item in self.store.read()["dlq"].values()]

    def retry(self, execution_id: str) -> ExecutionRecord:
        with self._execution_lock:
            record = self.get(execution_id)
            if record is None:
                raise KeyError(execution_id)
            incomplete = next((step.id for step in record.steps if step.id not in record.results), None)
            if incomplete is None:
                return record
            # A manual retry creates a new bounded attempt window only for the
            # failed node and intentionally retains all durable prior outputs.
            record.attempts[incomplete] = 0
            record.status = ExecutionStatus.CREATED
            record.error = None
            record.finished_at = None
            record.updated_at = _now()
            data = self.store.read()
            data["dlq"] = {key: value for key, value in data["dlq"].items()
                           if value["execution_id"] != execution_id}
            data["executions"][execution_id] = record.model_dump(mode="json")
            self.store.update(data)
            return record

    def recover(self, execution_id: str) -> ExecutionRecord:
        with self._execution_lock:
            if self.get(execution_id) is None:
                raise KeyError(execution_id)
            return self._run(execution_id, recovered=True)

    def _run(self, execution_id: str, reset_failed: bool = False, recovered: bool = False) -> ExecutionRecord:
        data = self.store.read()
        record = ExecutionRecord.model_validate(data["executions"][execution_id])
        if record.status == ExecutionStatus.COMPLETED:
            return record
        if reset_failed:
            record.error = None
            record.status = ExecutionStatus.CREATED
        record.status = ExecutionStatus.RECOVERED if recovered else ExecutionStatus.RUNNING
        record.recovered_at = _now() if recovered else record.recovered_at
        remaining = {step.id: step for step in record.steps if step.id not in record.results}
        while remaining:
            ready = [step for step in remaining.values() if set(step.depends_on).issubset(record.results)]
            if not ready:
                return self._save_failure(data, record, "DAG has a cycle or unresolved dependency")
            for step in sorted(ready, key=lambda item: item.id):
                outcome = self._execute_step(record, step)
                if isinstance(outcome, Exception):
                    record.attempts[step.id] = record.attempts.get(step.id, 0) + 1
                    if record.attempts[step.id] >= record.max_attempts:
                        return self._dead_letter(data, record, step.id, str(outcome))
                    record.status = ExecutionStatus.RETRY_WAIT
                    record.error = str(outcome)
                    record.updated_at = _now()
                    data["executions"][record.id] = record.model_dump(mode="json")
                    self.store.update(data)  # durable attempt before at-least-once retry
                    return self._run(record.id, recovered=recovered)
                record.results[step.id] = outcome
                attempt = record.attempts.get(step.id, 0) + 1
                record.attempts[step.id] = attempt
                checkpoint = Checkpoint(id=str(uuid4()), execution_id=record.id, step_id=step.id, attempt=attempt,
                                        output=outcome, written_at=_now())
                data["checkpoints"].setdefault(record.id, {})[step.id] = checkpoint.model_dump(mode="json")
                remaining.pop(step.id)
                data["executions"][record.id] = record.model_dump(mode="json")
                self.store.update(data)  # checkpoint committed before later work
        record.status = ExecutionStatus.COMPLETED
        record.error = None
        record.updated_at = _now()
        record.finished_at = record.updated_at
        data["executions"][record.id] = record.model_dump(mode="json")
        self.store.update(data)
        return record

    @staticmethod
    def _execute_step(record: ExecutionRecord, step: StepSpec) -> Any:
        prior = record.attempts.get(step.id, 0)
        if prior < step.failures_before_success or step.action == "fail":
            return RuntimeError(f"step {step.id} failed on attempt {prior + 1}")
        if step.action == "value":
            return step.value
        if step.action == "echo":
            return {"payload": record.payload, "dependencies": {name: record.results[name] for name in step.depends_on}}
        raise RuntimeError(f"unsupported deterministic action: {step.action}")

    def _save_failure(self, data: dict[str, Any], record: ExecutionRecord, message: str) -> ExecutionRecord:
        record.status, record.error, record.updated_at = ExecutionStatus.FAILED, message, _now()
        record.finished_at = record.updated_at
        data["executions"][record.id] = record.model_dump(mode="json")
        self.store.update(data)
        return record

    def _dead_letter(self, data: dict[str, Any], record: ExecutionRecord, step_id: str, message: str) -> ExecutionRecord:
        record.status, record.error, record.updated_at = ExecutionStatus.DEAD_LETTER, message, _now()
        record.finished_at = record.updated_at
        letter = DeadLetterRecord(id=str(uuid4()), execution_id=record.id, event_id=record.event_id,
                                  step_id=step_id, attempts=record.attempts[step_id], error=message, created_at=_now())
        data["dlq"][letter.id] = letter.model_dump(mode="json")
        data["executions"][record.id] = record.model_dump(mode="json")
        self.store.update(data)
        return record