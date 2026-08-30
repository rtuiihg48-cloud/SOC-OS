from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
import threading
from typing import Any
from uuid import uuid4

from .models import Checkpoint, DeadLetterRecord, EventRequest, ExecutionRecord, ExecutionStatus, StepSpec
from .store import FileStore, Store


def _now() -> str:
    return datetime.now(UTC).isoformat()


class IdempotencyConflict(ValueError):
    """A key has already been accepted with a different operation payload."""


def _fingerprint(event: EventRequest) -> str:
    return hashlib.sha256(json.dumps({
        "name": event.name, "payload": event.payload,
        "steps": [step.model_dump(mode="json") for step in event.steps],
        "max_attempts": event.max_attempts, "tenant_id": event.tenant_id,
    }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class ExecutionEngine:
    """Deterministic in-process executor with durable event and step checkpoints."""

    def __init__(self, state_path: str | Path | Store) -> None:
        self.store: Store = state_path if isinstance(state_path, Store) else FileStore(state_path)
        self._execution_lock = threading.RLock()

    def submit(self, event: EventRequest) -> ExecutionRecord:
        """Compatibility helper for in-process callers: accept then execute."""
        return self.execute(self.accept(event).id)

    def accept(self, event: EventRequest) -> ExecutionRecord:
        with self._execution_lock:
            with self.store.lock(f"accept:{event.tenant_id}:{event.idempotency_key or event.event_id or ''}"):
                return self._accept_locked(event)

    def _accept_locked(self, event: EventRequest) -> ExecutionRecord:
            data = self.store.read()
            key = event.idempotency_key or event.event_id or str(uuid4())
            scoped_key = f"{event.tenant_id}:{key}"
            existing = data["idempotency"].get(scoped_key)
            if existing:
                winner = ExecutionRecord.model_validate(data["executions"][existing])
                if winner.request_fingerprint and winner.request_fingerprint != _fingerprint(event):
                    raise IdempotencyConflict("idempotency key was already used with a different request")
                return winner
            execution_id = str(uuid4())
            now = _now()
            record = ExecutionRecord(
                id=execution_id, event_id=event.event_id or execution_id, tenant_id=event.tenant_id, idempotency_key=key,
                name=event.name, status=ExecutionStatus.CREATED, payload=event.payload, steps=event.steps,
                max_attempts=event.max_attempts, created_at=now, updated_at=now, request_fingerprint=_fingerprint(event),
            )
            serialized = record.model_dump(mode="json")
            if hasattr(self.store, "create_execution"):
                winner = ExecutionRecord.model_validate(self.store.create_execution(serialized))  # type: ignore[attr-defined]
                if winner.id != record.id and winner.request_fingerprint and winner.request_fingerprint != record.request_fingerprint:
                    raise IdempotencyConflict("idempotency key was already used with a different request")
                return winner
            data["executions"][execution_id] = serialized
            data["idempotency"][scoped_key] = execution_id
            self.store.update(data)
            return record

    def execute(self, execution_id: str, recovered: bool = False) -> ExecutionRecord:
        """Execute an already durable accepted event; safe to invoke more than once."""
        with self._execution_lock:
            with self.store.lock(f"execution:{execution_id}"):
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
            with self.store.lock(f"execution:{execution_id}"):
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
                serialized = record.model_dump(mode="json")
                if hasattr(self.store, "persist_retry"):
                    self.store.persist_retry(serialized)  # type: ignore[attr-defined]
                else:
                    data["executions"][execution_id] = serialized
                    self.store.update(data)
                return record

    def recover(self, execution_id: str) -> ExecutionRecord:
        with self._execution_lock:
            with self.store.lock(f"execution:{execution_id}"):
                if self.get(execution_id) is None:
                    raise KeyError(execution_id)
                return self._run(execution_id, recovered=True)

    def operation(self, execution_id: str, action: str, idempotency_key: str) -> ExecutionRecord | None:
        """Return the record for an already accepted mutating operation."""
        record = self.get(execution_id)
        if record and record.operation_idempotency.get(f"{action}:{idempotency_key}") == execution_id:
            return record
        return None

    def remember_operation(self, execution_id: str, action: str, idempotency_key: str) -> None:
        with self._execution_lock:
            with self.store.lock(f"execution:{execution_id}"):
                record = self.get(execution_id)
                if record is None:
                    raise KeyError(execution_id)
                record.operation_idempotency[f"{action}:{idempotency_key}"] = execution_id
                data = self.store.read()
                data["executions"][execution_id] = record.model_dump(mode="json")
                self.store.update(data)

    def transition_operation(self, tenant_id: int, execution_id: str, action: str,
                             idempotency_key: str) -> ExecutionRecord:
        """Durably apply a manual API operation or replay its winning response."""
        if hasattr(self.store, "transition_operation"):
            try:
                raw = self.store.transition_operation(tenant_id, execution_id, action, idempotency_key)  # type: ignore[attr-defined]
            except ValueError as exc:
                raise IdempotencyConflict(str(exc)) from exc
            return ExecutionRecord.model_validate(raw)
        # File mode remains process-local by design, but keeps the same
        # replay/conflict contract and persists the winner for restarts.
        with self._execution_lock:
            with self.store.lock(f"operation:{tenant_id}:{idempotency_key}"):
                data = self.store.read()
                operations = data.setdefault("operations", {})
                scoped = f"{tenant_id}:{idempotency_key}"
                winner = operations.get(scoped)
                if winner:
                    if winner["execution_id"] != execution_id or winner["operation"] != action:
                        raise IdempotencyConflict("idempotency key was already used for a different operation or execution")
                    return ExecutionRecord.model_validate(winner["response"])
                current = self.get(execution_id)
                if current is None or current.tenant_id != tenant_id:
                    raise KeyError(execution_id)
                if action == "retry":
                    if current.status not in {ExecutionStatus.FAILED, ExecutionStatus.DEAD_LETTER}:
                        raise RuntimeError("retry is only valid for failed or dead-letter executions")
                    record = self.retry(execution_id)
                elif action == "recover":
                    if not self.checkpoints(execution_id):
                        raise RuntimeError("recovery requires at least one checkpoint")
                    current.status = ExecutionStatus.RECOVERED
                    current.recovered_at = current.updated_at = _now()
                    data = self.store.read()
                    data["executions"][execution_id] = current.model_dump(mode="json")
                    self.store.update(data)
                    record = current
                else:
                    raise ValueError(f"unsupported operation: {action}")
                data = self.store.read()
                data.setdefault("operations", {})[scoped] = {
                    "execution_id": execution_id, "operation": action, "response": record.model_dump(mode="json"),
                }
                self.store.update(data)
                return record

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