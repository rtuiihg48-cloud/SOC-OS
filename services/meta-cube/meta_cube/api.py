from __future__ import annotations

import os
import base64
import hashlib
import hmac
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from .engine import ExecutionEngine, IdempotencyConflict
from .models import EventRequest, ExecutionRecord, ExecutionStatus, StepSpec
from .redis_stream import RedisStreamAdapter
from .postgres_store import PostgresStore
from .store import FileStore
from .worker import ExecutionWorker


class PublicEventRequest(BaseModel):
    name: str = Field(min_length=1)
    payload: dict[str, Any]
    steps: list[str] = Field(min_length=1)
    idempotency_key: str | None = Field(default=None, alias="idempotencyKey", min_length=1)
    max_retries: int = Field(default=3, alias="maxRetries", ge=0, le=10)

    model_config = {"populate_by_name": True}

    @field_validator("steps")
    @classmethod
    def unique_steps(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("steps must contain unique names")
        return value


class BridgeContext(BaseModel):
    tenant_id: int = Field(alias="tenantId", ge=1)
    principal_type: str = Field(alias="principalType", min_length=1, max_length=64)
    principal_id: str = Field(alias="principalId", min_length=1, max_length=256)
    capability: str = Field(min_length=1, max_length=128)
    correlation_id: str = Field(alias="correlationId", min_length=1, max_length=256)
    idempotency_key: str | None = Field(default=None, alias="idempotencyKey", max_length=128)

    model_config = {"populate_by_name": True}


def bridge_context(
    x_meta_cube_context: str | None = Header(default=None),
    x_meta_cube_signature: str | None = Header(default=None),
) -> BridgeContext:
    """Authenticate the internal Express bridge; direct requests fail closed."""
    secret = os.getenv("META_CUBE_INTERNAL_SECRET")
    if not secret:
        raise HTTPException(503, "META-CUBE internal authentication is not configured")
    if not x_meta_cube_context or not x_meta_cube_signature:
        raise HTTPException(401, "META-CUBE internal authentication is required")
    expected = hmac.new(secret.encode(), x_meta_cube_context.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, x_meta_cube_signature):
        raise HTTPException(401, "invalid META-CUBE internal authentication")
    try:
        raw = base64.urlsafe_b64decode(x_meta_cube_context + "=" * (-len(x_meta_cube_context) % 4))
        return BridgeContext.model_validate_json(raw)
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(400, "invalid META-CUBE bridge context") from None


def require_bridge(capability: str):
    def dependency(context: BridgeContext = Depends(bridge_context)) -> BridgeContext:
        if context.capability != capability:
            raise HTTPException(403, "bridge capability does not authorize this operation")
        return context
    return dependency


class ExecutionView(BaseModel):
    id: str
    name: str
    status: str
    payload: dict[str, Any]
    steps: list[str]
    completed_steps: list[str] = Field(serialization_alias="completedSteps")
    attempts: int
    max_retries: int = Field(serialization_alias="maxRetries")
    error: str | None
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")
    finished_at: str | None = Field(serialization_alias="finishedAt")


class HealthView(BaseModel):
    status: str
    service: str
    persistence: str
    worker: str
    version: str


class CheckpointView(BaseModel):
    id: str
    execution_id: str = Field(serialization_alias="executionId")
    completed_steps: list[str] = Field(serialization_alias="completedSteps")
    state: dict[str, Any]
    created_at: str = Field(serialization_alias="createdAt")


STATUS_MAP = {
    ExecutionStatus.CREATED: "queued",
    ExecutionStatus.RUNNING: "running",
    ExecutionStatus.COMPLETED: "succeeded",
    ExecutionStatus.FAILED: "failed",
    ExecutionStatus.RETRY_WAIT: "retrying",
    ExecutionStatus.DEAD_LETTER: "dead_letter",
    ExecutionStatus.RECOVERED: "recovered",
}


def execution_view(record: ExecutionRecord) -> ExecutionView:
    return ExecutionView(
        id=record.id, name=record.name, status=STATUS_MAP[record.status], payload=record.payload,
        steps=[step.id for step in record.steps], completed_steps=list(record.results),
        attempts=sum(record.attempts.values()), max_retries=record.max_attempts - 1,
        error=record.error, created_at=record.created_at, updated_at=record.updated_at,
        finished_at=record.finished_at,
    )


def create_app(state_path: str | Path | None = None, redis_adapter: RedisStreamAdapter | None = None,
               storage_mode: str | None = None) -> FastAPI:
    # A supplied path is an intentional isolated file-store injection for
    # tests/tools. The module-level production app calls this with no path.
    storage_mode = (storage_mode or ("file" if state_path is not None
                                     else os.getenv("META_CUBE_STORAGE", "file"))).lower()
    if storage_mode == "postgres":
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            raise RuntimeError("DATABASE_URL is required when META_CUBE_STORAGE=postgres")
        store = PostgresStore(database_url)
    elif storage_mode == "file":
        store = FileStore(state_path or os.getenv("META_CUBE_STATE_PATH", "meta-cube-state.json"))
    else:
        raise RuntimeError("META_CUBE_STORAGE must be file or postgres")
    engine = ExecutionEngine(store)
    redis = redis_adapter or RedisStreamAdapter(os.getenv("REDIS_URL"))
    worker = ExecutionWorker(engine, redis)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if storage_mode == "postgres":
            store.open()
        await redis.connect()
        await worker.start()
        yield
        await worker.stop()
        await redis.close()
        store.close()

    app = FastAPI(title="META-CUBE Execution Service", version="1.0.0", lifespan=lifespan)
    app.state.engine, app.state.redis, app.state.worker = engine, redis, worker

    @app.get("/healthz", response_model=HealthView)
    async def healthz(_context: BridgeContext = Depends(require_bridge("execution:health"))) -> HealthView:
        return HealthView(
            status="degraded" if redis.configured and (not redis.available or worker.transport_degraded) else "ok",
            service="meta-cube", persistence=storage_mode,
            worker=worker.state, version=app.version,
        )

    @app.post("/v1/events", response_model=ExecutionView, response_model_by_alias=True, status_code=202)
    async def events(event: PublicEventRequest, context: BridgeContext = Depends(require_bridge("execution:submit"))) -> ExecutionView:
        if not context.idempotency_key or event.idempotency_key != context.idempotency_key:
            raise HTTPException(400, "idempotency key must match authenticated bridge context")
        # Public strings are deliberately converted to a stable, linear DAG.
        steps = [StepSpec(id=name, depends_on=[event.steps[index - 1]] if index else [])
                 for index, name in enumerate(event.steps)]
        internal = EventRequest(name=event.name, event_id=event.idempotency_key,
                                idempotency_key=event.idempotency_key, payload=event.payload,
                                 steps=steps, max_attempts=event.max_retries + 1, tenant_id=context.tenant_id)
        try:
            record = engine.accept(internal)
        except IdempotencyConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        await worker.submit(record.id)
        return execution_view(record)

    @app.get("/v1/executions", response_model=list[ExecutionView], response_model_by_alias=True)
    async def executions(status: str | None = None, limit: int = Query(default=100, ge=1, le=1000),
                         context: BridgeContext = Depends(require_bridge("execution:read"))) -> list[ExecutionView]:
        rows = [execution_view(record) for record in engine.list() if record.tenant_id == context.tenant_id]
        if status is not None:
            rows = [row for row in rows if row.status == status]
        return rows[:limit]

    @app.get("/v1/executions/{execution_id}", response_model=ExecutionView, response_model_by_alias=True)
    async def execution(execution_id: str, context: BridgeContext = Depends(require_bridge("execution:read"))) -> ExecutionView:
        record = engine.get(execution_id)
        if record is None or record.tenant_id != context.tenant_id:
            raise HTTPException(404, "execution not found")
        return execution_view(record)

    @app.post("/v1/executions/{execution_id}/retry", response_model=ExecutionView,
              response_model_by_alias=True, status_code=202)
    async def retry(execution_id: str, context: BridgeContext = Depends(require_bridge("execution:retry"))) -> ExecutionView:
        current = engine.get(execution_id)
        if current is None or current.tenant_id != context.tenant_id:
            raise HTTPException(404, "execution not found")
        if not context.idempotency_key:
            raise HTTPException(400, "idempotency key is required")
        duplicate = engine.operation(execution_id, "retry", context.idempotency_key)
        if duplicate:
            return execution_view(duplicate)
        if current.status not in {ExecutionStatus.FAILED, ExecutionStatus.DEAD_LETTER}:
            raise HTTPException(409, "retry is only valid for failed or dead-letter executions")
        record = engine.retry(execution_id)
        engine.remember_operation(execution_id, "retry", context.idempotency_key)
        await worker.submit(record.id)
        return execution_view(record)

    @app.post("/v1/executions/{execution_id}/recover", response_model=ExecutionView,
              response_model_by_alias=True, status_code=202)
    async def recover(execution_id: str, context: BridgeContext = Depends(require_bridge("execution:recover"))) -> ExecutionView:
        current = engine.get(execution_id)
        if current is None or current.tenant_id != context.tenant_id:
            raise HTTPException(404, "execution not found")
        if not context.idempotency_key:
            raise HTTPException(400, "idempotency key is required")
        duplicate = engine.operation(execution_id, "recover", context.idempotency_key)
        if duplicate:
            return execution_view(duplicate)
        if not engine.checkpoints(execution_id):
            raise HTTPException(409, "recovery requires at least one checkpoint")
        record = engine.recover(execution_id)
        engine.remember_operation(execution_id, "recover", context.idempotency_key)
        return execution_view(record)

    @app.get("/v1/dlq", response_model=list[ExecutionView], response_model_by_alias=True)
    async def dlq(limit: int = Query(default=100, ge=1, le=1000),
                  context: BridgeContext = Depends(require_bridge("execution:dlq:operate"))) -> list[ExecutionView]:
        return [execution_view(record) for record in engine.list()
                if record.status == ExecutionStatus.DEAD_LETTER and record.tenant_id == context.tenant_id][:limit]

    @app.get("/v1/checkpoints", response_model=list[CheckpointView], response_model_by_alias=True)
    async def checkpoints(execution_id: str | None = Query(default=None, alias="executionId"),
                          context: BridgeContext = Depends(require_bridge("execution:read"))) -> list[CheckpointView]:
        if execution_id is not None:
            record = engine.get(execution_id)
            if record is None or record.tenant_id != context.tenant_id:
                raise HTTPException(404, "execution not found")
        views: list[CheckpointView] = []
        for entry in engine.checkpoints(execution_id):
            owner = engine.get(entry.execution_id)
            if owner is None or owner.tenant_id != context.tenant_id:
                continue
            state = {"stepId": entry.step_id, "attempt": entry.attempt, "output": entry.output}
            views.append(CheckpointView(id=entry.id, execution_id=entry.execution_id,
                                        completed_steps=[entry.step_id], state=state,
                                        created_at=entry.written_at))
        return views

    return app


app = create_app()