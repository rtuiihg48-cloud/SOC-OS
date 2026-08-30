from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from .engine import ExecutionEngine
from .models import EventRequest, ExecutionRecord, ExecutionStatus, StepSpec
from .redis_stream import RedisStreamAdapter
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


def create_app(state_path: str | Path | None = None, redis_adapter: RedisStreamAdapter | None = None) -> FastAPI:
    engine = ExecutionEngine(state_path or os.getenv("META_CUBE_STATE_PATH", "meta-cube-state.json"))
    redis = redis_adapter or RedisStreamAdapter(os.getenv("REDIS_URL"))
    worker = ExecutionWorker(engine, redis)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await redis.connect()
        await worker.start()
        yield
        await worker.stop()
        await redis.close()

    app = FastAPI(title="META-CUBE Execution Service", version="1.0.0", lifespan=lifespan)
    app.state.engine, app.state.redis, app.state.worker = engine, redis, worker

    @app.get("/healthz", response_model=HealthView)
    async def healthz() -> HealthView:
        return HealthView(
            status="degraded" if redis.configured and (not redis.available or worker.transport_degraded) else "ok",
            service="meta-cube", persistence="local",
            worker=worker.state, version=app.version,
        )

    @app.post("/v1/events", response_model=ExecutionView, response_model_by_alias=True, status_code=202)
    async def events(event: PublicEventRequest) -> ExecutionView:
        # Public strings are deliberately converted to a stable, linear DAG.
        steps = [StepSpec(id=name, depends_on=[event.steps[index - 1]] if index else [])
                 for index, name in enumerate(event.steps)]
        internal = EventRequest(name=event.name, event_id=event.idempotency_key,
                                idempotency_key=event.idempotency_key, payload=event.payload,
                                steps=steps, max_attempts=event.max_retries + 1)
        record = engine.accept(internal)
        await worker.submit(record.id)
        return execution_view(record)

    @app.get("/v1/executions", response_model=list[ExecutionView], response_model_by_alias=True)
    async def executions(status: str | None = None, limit: int = Query(default=100, ge=1, le=1000)) -> list[ExecutionView]:
        rows = [execution_view(record) for record in engine.list()]
        if status is not None:
            rows = [row for row in rows if row.status == status]
        return rows[:limit]

    @app.get("/v1/executions/{execution_id}", response_model=ExecutionView, response_model_by_alias=True)
    async def execution(execution_id: str) -> ExecutionView:
        record = engine.get(execution_id)
        if record is None:
            raise HTTPException(404, "execution not found")
        return execution_view(record)

    @app.post("/v1/executions/{execution_id}/retry", response_model=ExecutionView,
              response_model_by_alias=True, status_code=202)
    async def retry(execution_id: str) -> ExecutionView:
        current = engine.get(execution_id)
        if current is None:
            raise HTTPException(404, "execution not found")
        if current.status not in {ExecutionStatus.FAILED, ExecutionStatus.DEAD_LETTER}:
            raise HTTPException(409, "retry is only valid for failed or dead-letter executions")
        record = engine.retry(execution_id)
        await worker.submit(record.id)
        return execution_view(record)

    @app.post("/v1/executions/{execution_id}/recover", response_model=ExecutionView,
              response_model_by_alias=True, status_code=202)
    async def recover(execution_id: str) -> ExecutionView:
        current = engine.get(execution_id)
        if current is None:
            raise HTTPException(404, "execution not found")
        if not engine.checkpoints(execution_id):
            raise HTTPException(409, "recovery requires at least one checkpoint")
        return execution_view(engine.recover(execution_id))

    @app.get("/v1/dlq", response_model=list[ExecutionView], response_model_by_alias=True)
    async def dlq(limit: int = Query(default=100, ge=1, le=1000)) -> list[ExecutionView]:
        return [execution_view(record) for record in engine.list()
                if record.status == ExecutionStatus.DEAD_LETTER][:limit]

    @app.get("/v1/checkpoints", response_model=list[CheckpointView], response_model_by_alias=True)
    async def checkpoints(execution_id: str | None = Query(default=None, alias="executionId")) -> list[CheckpointView]:
        views: list[CheckpointView] = []
        for entry in engine.checkpoints(execution_id):
            state = {"stepId": entry.step_id, "attempt": entry.attempt, "output": entry.output}
            views.append(CheckpointView(id=entry.id, execution_id=entry.execution_id,
                                        completed_steps=[entry.step_id], state=state,
                                        created_at=entry.written_at))
        return views

    return app


app = create_app()