from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, model_validator


class ExecutionStatus(StrEnum):
    CREATED = "created"
    RUNNING = "running"
    RETRY_WAIT = "retry_wait"
    COMPLETED = "completed"
    FAILED = "failed"
    DEAD_LETTER = "dead_letter"
    RECOVERED = "recovered"


class StepSpec(BaseModel):
    id: str = Field(min_length=1)
    depends_on: list[str] = Field(default_factory=list)
    action: str = "echo"
    value: Any = None
    failures_before_success: int = Field(default=0, ge=0)


class EventRequest(BaseModel):
    name: str = "default"
    event_id: str | None = Field(default=None, min_length=1)
    idempotency_key: str | None = Field(default=None, min_length=1)
    payload: dict[str, Any] = Field(default_factory=dict)
    steps: list[StepSpec] = Field(default_factory=lambda: [StepSpec(id="main")])
    max_attempts: int = Field(default=3, ge=1, le=100)
    tenant_id: int = 0

    @model_validator(mode="after")
    def validate_dag(self) -> "EventRequest":
        names = [step.id for step in self.steps]
        if len(names) != len(set(names)):
            raise ValueError("step ids must be unique")
        known = set(names)
        for step in self.steps:
            if step.id in step.depends_on:
                raise ValueError(f"step {step.id} cannot depend on itself")
            unknown = set(step.depends_on) - known
            if unknown:
                raise ValueError(f"step {step.id} has unknown dependencies: {sorted(unknown)}")
        return self


class Checkpoint(BaseModel):
    id: str
    execution_id: str
    step_id: str
    attempt: int
    output: Any
    written_at: str


class ExecutionRecord(BaseModel):
    id: str
    event_id: str
    tenant_id: int = 0
    name: str = "default"
    idempotency_key: str
    status: ExecutionStatus
    payload: dict[str, Any]
    steps: list[StepSpec]
    max_attempts: int
    attempts: dict[str, int] = Field(default_factory=dict)
    results: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    created_at: str
    updated_at: str
    recovered_at: str | None = None
    finished_at: str | None = None
    request_fingerprint: str | None = None
    operation_idempotency: dict[str, str] = Field(default_factory=dict)


class DeadLetterRecord(BaseModel):
    id: str
    execution_id: str
    event_id: str
    step_id: str
    attempts: int
    error: str
    created_at: str


class HealthResponse(BaseModel):
    status: str
    persistence: str
    redis: str
    redis_configured: bool