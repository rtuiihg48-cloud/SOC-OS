# META-CUBE execution service

Standalone FastAPI service for deterministic, checkpointed DAG executions.

## Run

From this directory:

```bash
PORT=8008 python main.py
```

In default file mode, state is atomically persisted to
`meta-cube-state.json`, or the path in `META_CUBE_STATE_PATH`. Run tests
with `pytest -q`.

## PostgreSQL authoritative mode

File mode is the default development backend. For shared multi-instance
execution history, apply the versioned migration and start every instance with
the same PostgreSQL database:

```bash
psql "$DATABASE_URL" -f migrations/001_meta_cube_authoritative.sql
export META_CUBE_STORAGE=postgres
PORT=8008 python main.py
```

PostgreSQL mode uses a bounded psycopg pool (`META_CUBE_PG_POOL_MIN`, default
`1`; `META_CUBE_PG_POOL_MAX`, default `5`) and advisory execution locks.
Startup fails explicitly when `DATABASE_URL` is missing, unreachable, or the
migration has not been applied; it never falls back to file storage.

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
Redis is supplementary transport: if it cannot connect, `/healthz`
explicitly reports `degraded` and execution continues against the selected
authoritative backend (`file` or `postgres`).