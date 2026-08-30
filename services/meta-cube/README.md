# META-CUBE execution service

Standalone FastAPI service for deterministic, checkpointed DAG executions.

## Run

From this directory:

```bash
PORT=8008 python main.py
```

State is atomically persisted to `meta-cube-state.json`, or the path in
`META_CUBE_STATE_PATH`. Run tests with `pytest tests`.

`POST /v1/events` accepts the bridge contract:

```json
{"name":"example","payload":{"key":"value"},"steps":["prepare","apply"],"idempotencyKey":"optional","maxRetries":3}
```

Public step names become a deterministic linear DAG internally (`prepare`
then `apply`). Acceptance first persists a queued event; the lifespan-managed
worker executes it asynchronously. Each successful node produces a checkpoint.
Failures retry immediately up to `maxRetries` and then create a DLQ record. Execution
responses use camelCase bridge fields and public statuses (`queued`, `running`,
`succeeded`, `failed`, `retrying`, `dead_letter`, or `recovered`).

Successful manual recovery is projected as `succeeded`: all prior checkpoints
remain valid and the recovery timestamp is retained internally as audit state.

Set `REDIS_URL` to enable the optional Redis Streams adapter. It uses
XREADGROUP and XAUTOCLAIM, falling back to XPENDING/XCLAIM on older Redis.
Redis is supplementary in this service: if it cannot connect, `/healthz`
explicitly reports `degraded` and durable local file execution continues.