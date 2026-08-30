# SOC OS with META-CUBE

Security operations dashboard with a separate reliable execution plane for checkpointed DAG workloads.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `cd services/meta-cube && PORT=8008 python main.py` — run the META-CUBE execution service
- `cd services/meta-cube && pytest -q` — run META-CUBE engine tests
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional env: `META_CUBE_URL` (defaults to `http://127.0.0.1:8008`), `META_CUBE_TIMEOUT_MS`, `META_CUBE_STATE_PATH`, `REDIS_URL`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Execution: Python 3.12 + FastAPI, optional Redis Streams
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/soc-dashboard` — React operator dashboard
- `artifacts/api-server` — Express control plane and META-CUBE bridge
- `services/meta-cube` — FastAPI execution plane, checkpoints, recovery, retry, and DLQ
- `lib/api-spec/openapi.yaml` — public API contract and generated client source

## Architecture decisions

- Express owns presentation/control APIs; META-CUBE exclusively owns worker, retry, checkpoint, recovery, and DAG behavior.
- Local atomic file persistence is explicit development mode. Configured-but-unavailable Redis is reported as degraded rather than silently ignored.
- Browser clients call the generated `/api/meta-cube/*` contract; they never connect to FastAPI directly.

## Product

- Monitor SOC alerts, events, rules, correlations, tenants, and system health.
- Submit deterministic META-CUBE executions, inspect checkpoints, and operate retry/recovery/DLQ flows from `/runtime`.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
