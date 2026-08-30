# Security Control Plane + Immutable Audit Trail — Implementation Plan

**Date:** 2026-08-30  
**Status:** Proposed implementation plan  
**Design:** `docs/superpowers/specs/2026-08-30-security-control-plane-immutable-audit-design.md`

## Delivery objective

Add Replit-managed Clerk authentication, server-derived tenant authorization,
typed capabilities, and a PostgreSQL-enforced append-only audit chain. Protect
the existing event, META-CUBE, observer, quarantine, self-healing, and traffic
boundaries without changing their domain ownership or permitting autonomous
execution.

## Fixed decisions

- Operator authentication uses Replit-managed Clerk.
- Browser authentication uses Clerk session cookies; the web client does not
  attach bearer tokens.
- Clerk development and production user stores remain separate.
- The public artifact base route remains accessible while the SOC dashboard is
  protected.
- No first-user-wins administrator bootstrap is allowed.
- Gateway/service credentials are scoped, hashed at rest, and separate from
  Clerk user sessions.
- Tenant scope is derived on the server.
- Audit chains are partitioned by tenant, with a separate system chain.
- Hashing provides integrity, not encryption.
- Required audit and protected state transitions commit atomically.
- No local-file fallback is allowed for authoritative audit records.
- Blockchain/external anchoring is not part of this implementation phase.

## Execution sequence

The work is divided into ten dependency-ordered work packages. Do not begin a
later package until the verification gate of its prerequisite package passes.

---

## Work package 1 — Establish test and migration conventions

### Goal

Create the minimum project conventions needed to test policy, PostgreSQL
concurrency, and API behavior before changing security boundaries.

### Changes

1. Inspect `lib/db/drizzle.config.ts` and package scripts to confirm the
   generated migration output path.
2. Add an explicit SQL migration directory under `lib/db/migrations/` if the
   configured Drizzle workflow does not already generate one.
3. Preserve `pnpm --filter @workspace/db run push` for development only; add a
   migration command suitable for repeatable environments.
4. Add a TypeScript test runner to `artifacts/api-server` using the workspace's
   package-management conventions.
5. Add separate commands for:
   - pure unit tests;
   - API integration tests;
   - optional PostgreSQL integration tests requiring `DATABASE_URL`.
6. Ensure integration tests use isolated tenant/test records and clean them up
   without modifying unrelated development data.

### Primary files

- `lib/db/drizzle.config.ts`
- `lib/db/package.json`
- `artifacts/api-server/package.json`
- `pnpm-workspace.yaml`
- new API test configuration and test directories

### Verification

- Empty test suites run successfully.
- A test can connect to the development PostgreSQL database through the
  existing managed connection.
- Migration status can be inspected without applying destructive schema
  changes.

### Gate

No schema or authorization work proceeds until repeatable unit and database
integration test commands exist.

---

## Work package 2 — Provision and integrate Replit-managed Clerk

### Goal

Create a verified Clerk session boundary for web users without exposing or
manually handling credentials.

### Changes

1. Recheck Clerk management status immediately before implementation.
2. Provision Replit-managed Clerk with the platform setup callback if status is
   still `not_configured`.
3. Install canonical Clerk server/client dependencies using the package
   management workflow:
   - API: `http-proxy-middleware`, `@clerk/express`, `@clerk/shared`;
   - dashboard: `@clerk/react`, `@clerk/themes`.
4. Copy the canonical Clerk proxy middleware template into:
   - `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts`.
5. Mount the proxy before Express body parsers and mount `clerkMiddleware`
   before `/api` routes.
6. Add the canonical `ClerkProvider` and Wouter integration using the artifact
   base path.
7. Add exact routes:
   - `/sign-in/*?`;
   - `/sign-up/*?`.
8. Keep `/` publicly accessible. Move the signed-in SOC landing experience to
   `/dashboard` and redirect signed-in users there.
9. Build branded sign-in/sign-up pages matching the existing SOC theme.
10. Clear TanStack Query cache when the signed-in Clerk user changes.

### Primary files

- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts`
- `artifacts/soc-dashboard/src/App.tsx`
- `artifacts/soc-dashboard/src/index.css`
- `artifacts/soc-dashboard/src/components/Layout.tsx`
- new public landing and branded authentication page components
- `artifacts/soc-dashboard/public/logo.svg`
- API/dashboard package manifests

### Safety rules

- Do not ask the user to paste Clerk keys.
- Do not manually set proxy environment variables.
- Do not add bearer-token logic to browser API calls.
- Do not use a default unstyled Clerk screen.
- Do not expose protected dashboard data while Clerk is loading.

### Verification

- Signed-out users can open `/`.
- Signed-out users cannot render `/dashboard` or protected pages.
- Sign-in and sign-up OAuth subpaths resolve without a 404.
- Signed-in users reach `/dashboard`.
- Sign-out returns to `/`.
- Production build includes working proxy-compatible Clerk wiring.

### Gate

The server can reliably distinguish authenticated and unauthenticated requests
before tenant or role authorization is introduced.

---

## Work package 3 — Add principals, memberships, and scoped credentials

### Goal

Translate Clerk sessions and non-user credentials into one normalized,
server-derived principal.

### Schema

Add:

1. `control_plane_users`
   - internal ID;
   - immutable Clerk user ID;
   - status;
   - created/updated timestamps.
2. `tenant_memberships`
   - user ID;
   - tenant ID;
   - role: `SOC_ADMIN`, `ANALYST`, or `VIEWER`;
   - status;
   - created/updated timestamps;
   - unique user/tenant membership.
3. `service_credentials`
   - credential ID/prefix;
   - tenant ID;
   - principal type: `SERVICE` or `GATEWAY`;
   - principal name;
   - secret hash, never the raw secret;
   - allowed capabilities;
   - optional gateway scope;
   - credential version;
   - expiration/revocation timestamps;
   - created/last-used timestamps.

Use restrictive foreign keys, uniqueness constraints, and indexes for all
authorization lookup paths.

### Application components

Add:

- `Principal` TypeScript type;
- Clerk user principal adapter;
- service/gateway credential principal adapter;
- request type augmentation;
- authentication middleware;
- trusted bootstrap command for the initial tenant membership.

The bootstrap command is not a public HTTP route. It must require an explicit
trusted operator invocation and must be idempotent. No authenticated user gains
tenant access merely because they are first.

### Existing tenant API keys

Do not continue using plaintext `tenants.apiKey` as authorization material.
Create a migration path:

1. leave existing values readable only for controlled migration;
2. issue new scoped hashed credentials;
3. migrate gateways/services;
4. revoke and remove authorization dependence on the plaintext column;
5. remove the legacy column only after all callers have migrated.

### Primary files

- `lib/db/src/schema/index.ts`
- `lib/db/migrations/*`
- `lib/db/src/index.ts`
- new `artifacts/api-server/src/lib/principal.ts`
- new authentication middleware under
  `artifacts/api-server/src/middlewares/`
- new trusted bootstrap script

### Tests

- Clerk user creates a `USER` principal but receives no tenant access without
  membership.
- Disabled membership is rejected.
- Revoked/expired service credential is rejected.
- Raw secrets are never persisted.
- Credential scope cannot be widened by request input.
- Cross-tenant principal lookup fails closed.

### Gate

Every protected request has either a verified normalized principal or a `401`
response.

---

## Work package 4 — Implement typed capabilities and policy decisions

### Goal

Centralize authorization so routes cannot invent local role checks.

### Components

Add:

- capability constants and validation;
- target resource types;
- role-to-capability mapping;
- `authorize(principal, action, target, context)` policy service;
- stable decision IDs and reason codes;
- Express middleware/helpers for required capability checks.

Initial capabilities:

- `events:read`;
- `events:ingest`;
- `events:status:update`;
- `traffic:read`;
- `agent:observe`;
- `execution:read`;
- `execution:submit`;
- `execution:retry`;
- `execution:recover`;
- `execution:dlq:operate`;
- `quarantine:read`;
- `quarantine:approve`;
- `self_healing:preview`;
- `self_healing:apply`;
- `audit:read`;
- `audit:verify`.

### Policy behavior

- `401` means there is no authenticated principal.
- `403` means a principal exists but policy denies the action.
- Tenant and target scope come from database state.
- Body/query tenant IDs are consistency checks only.
- Natural-language instructions never become capabilities.
- Future capabilities such as `firewall:apply` require new explicit policy
  definitions.

### Primary files

- new `artifacts/api-server/src/lib/control-policy.ts`
- new authorization middleware/helper files
- API error types and central error handler
- request type augmentation

### Tests

- Role/capability matrix.
- Tenant mismatch.
- Unknown typed action.
- Missing/disabled principal.
- Stable denial reason codes.
- Observer instructions cannot request a capability through prompt text.

### Gate

All policy decisions are deterministic, typed, and independently unit-tested
before they are mounted on existing routes.

---

## Work package 5 — Build the append-only audit chain

### Goal

Create an authoritative tenant-partitioned audit log with concurrent-writer
correctness and independent verification.

### Schema

Add:

1. `audit_chain_heads`
   - partition key: tenant ID or reserved system partition;
   - current sequence;
   - current hash;
   - updated timestamp.
2. `audit_records`
   - monotonically increasing ID;
   - tenant/system partition;
   - per-partition sequence;
   - occurred and inserted timestamps;
   - principal ID/type;
   - typed action;
   - target type/ID;
   - decision/result;
   - reason code;
   - request/correlation ID;
   - bounded sanitized metadata;
   - previous hash;
   - current hash;
   - optional future external anchor reference.

Add unique partition/sequence and partition/hash constraints plus indexes for
tenant/time, correlation ID, action/decision, principal, and target.

### PostgreSQL enforcement

The explicit SQL migration must:

- reject `UPDATE` and `DELETE` on audit records;
- restrict API-role privileges to insert/select;
- provision chain-head rows safely;
- document/fail closed if the production database role cannot enforce the
  required privileges.

### Application components

Add:

- canonical audit payload serializer;
- SHA-256 hash function;
- metadata redaction and size limiting;
- transactional append service;
- full/range verifier;
- audit capability health check.

The append transaction locks the partition's chain-head row with
`SELECT ... FOR UPDATE`, derives the next sequence/hash, inserts the audit
record, updates the head, and commits. All operations use the same pooled
connection. No process-local lock is authoritative.

### Primary files

- `lib/db/src/schema/index.ts`
- `lib/db/migrations/*`
- new `artifacts/api-server/src/lib/audit/*`
- API health/status integration

### Tests

- Canonical hash determinism.
- Every immutable field affects the hash.
- Two concurrent writers to one tenant produce one valid sequence.
- Different tenants have separate chains.
- System events use the system chain.
- Update/delete are rejected by PostgreSQL.
- Missing predecessor and corrupted hash are reported by the verifier.
- No verifier operation changes data.
- No local-file fallback exists.

### Gate

The chain passes deterministic and concurrent PostgreSQL tests before it is
required by any production transition.

---

## Work package 6 — Couple authorization, audit, and state transitions

### Goal

Protect existing mutations in risk order and guarantee evidence/state
consistency.

### Route rollout order

1. Event ingestion and event status updates.
2. META-CUBE submit, retry, recover, and DLQ operations.
3. Observer-agent requests.
4. Quarantine approval and self-healing preview/apply.
5. Traffic ingestion.
6. Tenant-scoped read routes.

### Event flow correction

Refactor `artifacts/api-server/src/routes/events.ts` so:

- tenant is derived from the principal;
- audit chain linking does not depend on “latest event by timestamp”;
- security-event storage and quarantine evidence remain atomic;
- the new audit record is committed in the same transaction for protected
  transitions;
- broadcasts occur only after commit;
- a required audit failure rolls back the transition.

Existing security-event hashes are preserved as event integrity evidence. The
new audit chain does not rewrite historical hashes.

### META-CUBE boundary

In `artifacts/api-server/src/routes/meta-cube.ts`:

- authorize in Express;
- forward correlation ID and a typed, non-secret authorization context;
- keep all execution/retry/checkpoint/recovery/DLQ ownership in META-CUBE;
- audit `QUEUED`/`ACCEPTED` separately from later completion;
- use idempotency keys for mutating operations.

Define and validate the service-to-service authorization-context contract on
both sides before enabling it. META-CUBE must not accept a raw browser identity
or natural-language authorization claim.

### Observer boundary

Protect `/agent/observe` with `agent:observe`, derive tenant from membership,
and audit the run result. Preserve:

- read-only tools;
- `productionChanged: false`;
- no executor adapter;
- no mutating capability regardless of prompt content.

### Quarantine/self-healing boundary

Preserve logical-only quarantine and verified same-location `managed://`
recovery. Add typed capability checks and audit evidence; do not add host-level
actions.

### Traffic boundary

Use scoped `GATEWAY` principals for ingestion. Keep observations metadata-only
and advisory. A traffic signal cannot authorize isolation.

### Primary files

- `artifacts/api-server/src/routes/events.ts`
- `artifacts/api-server/src/routes/meta-cube.ts`
- `artifacts/api-server/src/lib/meta-cube-client.ts`
- `artifacts/api-server/src/routes/agent-observer.ts`
- `artifacts/api-server/src/routes/quarantine.ts`
- `artifacts/api-server/src/routes/self-healing.ts`
- `artifacts/api-server/src/routes/traffic.ts`
- `services/meta-cube/main.py`
- relevant META-CUBE request models/middleware

### Tests

- Unauthenticated mutation returns `401`.
- Cross-tenant mutation returns `403` or safe not-found.
- Required audit failure rolls back the mutation.
- Idempotent replay does not duplicate transition or audit result.
- Broadcast is absent after rollback.
- META-CUBE remains the only execution-state authority.
- Quarantine/self-healing/traffic safety invariants still pass.

### Gate

No high-risk route remains authorized by request-supplied tenant or role.

---

## Work package 7 — Publish typed OpenAPI contracts

### Goal

Make identity, authorization errors, audit reads, and verification available
through generated, typed contracts.

### API surface

Add:

- `GET /auth/me` for current principal, memberships, and safe capabilities;
- `GET /audit/records` with tenant-scoped filters and stable cursor pagination;
- `POST /audit/verify` for authorized read-only verification;
- stable structured error schemas;
- idempotency header requirements on protected mutations.

Do not return raw credential hashes, Clerk claims, private payloads, or
unsanitized audit metadata.

### Code generation

1. Update `lib/api-spec/openapi.yaml`.
2. Run `pnpm --filter @workspace/api-spec run codegen`.
3. Use generated Zod schemas in routes.
4. Use generated React Query hooks in the dashboard.
5. Review generated diffs for accidental contract widening.

### Primary files

- `lib/api-spec/openapi.yaml`
- `lib/api-spec/orval.config.ts`
- `lib/api-zod/src/generated/*`
- `lib/api-client-react/src/generated/*`
- new auth/audit route modules
- `artifacts/api-server/src/routes/index.ts`

### Tests

- OpenAPI generation is clean.
- Server response shapes satisfy generated contracts.
- Cursor/filters are bounded.
- Audit verification endpoint is read-only.

### Gate

All new dashboard calls use generated clients; no raw security API fetches are
introduced.

---

## Work package 8 — Add the protected Audit Trail dashboard

### Goal

Give authorized operators a safe, read-only view of policy decisions and audit
integrity.

### UI

Add:

- protected `/audit-trail` page;
- navigation item visible only with `audit:read`;
- filters for action, decision, principal, target, correlation ID, and time;
- cursor pagination;
- integrity status;
- manual “Verify range” action for `audit:verify`;
- loading, empty, denied, degraded, and integrity-failure states.

The page shows:

- actor;
- typed action;
- target;
- result/decision;
- reason code;
- timestamp;
- correlation ID.

It does not render secrets, raw request bodies, full event payloads, or
credential material.

### Authenticated shell

The shared layout must:

- render protected navigation only after Clerk and `/auth/me` are resolved;
- provide a branded sign-out action through Clerk;
- clear Query cache on user change/sign-out;
- avoid briefly showing the previous user's tenant data.

### Primary files

- `artifacts/soc-dashboard/src/App.tsx`
- `artifacts/soc-dashboard/src/components/Layout.tsx`
- new `artifacts/soc-dashboard/src/pages/AuditTrail.tsx`
- focused audit components under
  `artifacts/soc-dashboard/src/components/`
- generated API client hooks

### Tests

- Signed-out users cannot render audit data.
- Viewer without `audit:verify` cannot invoke verification.
- Filters and pagination remain tenant-scoped.
- Long identifiers do not escape responsive cards/tables.
- No deferred exit orchestration is added to live audit lists.
- No `removeChild`, `NotFoundError`, or React lifecycle error occurs.

### Gate

Desktop/mobile browser tests pass with both allowed and denied principals.

---

## Work package 9 — Harden failure modes and observability

### Goal

Make authorization and audit degradation explicit and operationally visible.

### Changes

Add stable categories:

- `AUTHENTICATION_REQUIRED`;
- `TENANT_SCOPE_MISMATCH`;
- `CAPABILITY_DENIED`;
- `TARGET_NOT_FOUND`;
- `IDEMPOTENCY_CONFLICT`;
- `AUDIT_UNAVAILABLE`;
- `AUDIT_CHAIN_CONFLICT`;
- `AUDIT_INTEGRITY_FAILURE`;
- `INVALID_TYPED_ACTION`.

Add metrics/logging for:

- allow/deny counts by capability and reason code;
- audit append latency/failures;
- chain serialization conflicts;
- verification duration/failures;
- mutations rolled back because audit was unavailable.

Logs include stable identifiers and correlation IDs only. They exclude
credentials, session tokens, private samples, and unsanitized prompt content.

### Degraded behavior

- Required audit failure rolls back protected state.
- Non-critical diagnostic audit failure emits a high-severity integrity alert.
- The health endpoint reports audit/control-plane degradation.
- There is no silent memory/file fallback.

### Verification

- Injected audit failure produces the expected rollback/error/metric.
- Authorization denials do not leak membership or target existence.
- Health reporting differentiates database, audit integrity, and META-CUBE
  transport status.

---

## Work package 10 — Full regression, rollout, and completion review

### Rollout

1. Apply schema in development.
2. Provision the trusted initial membership outside public HTTP routes.
3. Run Clerk sign-in/sign-out and tenant boundary checks.
4. Dual-write audit records for selected transitions.
5. Verify chains under concurrent load.
6. Enable required-audit enforcement route group by route group.
7. Remove body-derived tenant authorization.
8. Run complete regression tests.
9. Confirm production migration/role prerequisites before publishing.

### Required command checks

- API unit/integration tests.
- PostgreSQL audit concurrency tests.
- `pnpm --filter @workspace/api-spec run codegen`.
- `pnpm run typecheck`.
- `pnpm run build`.
- `cd services/meta-cube && pytest -q`.
- Browser end-to-end tests for sign-in, denied access, allowed access, audit
  filters, verification, and protected META-CUBE operations.

### Security regression checks

- Observer remains `productionChanged: false`.
- Quarantine remains logical-only and non-executable.
- Self-healing remains verified, same-location, and `managed://` only.
- Traffic remains metadata-only and advisory.
- Redis remains transport-only.
- PostgreSQL remains authoritative for execution and audit state.
- Concurrent tenant audit writes verify successfully.
- No client-controlled tenant field grants access.
- No generated AI patch can reach merge/deploy through this phase.

### Completion criteria

The phase is complete only when:

- every protected operator route requires a valid Clerk session;
- every gateway/service ingestion route requires a scoped credential;
- membership/capability checks derive tenant server-side;
- every protected mutation has an idempotency strategy;
- required audit/state transitions are atomic;
- audit records are PostgreSQL-enforced append-only;
- chain verification reports no breaks under concurrency;
- cross-tenant tests pass;
- API, META-CUBE, typecheck, build, and browser tests pass;
- no production workflow depends on a process-local security lock or fallback
  store.

## Explicitly deferred

- predictive failure model and calibration;
- agentic remediation executor;
- firewall/WAF application;
- automated code application or deployment;
- raw packet inspection;
- external blockchain/notarization anchoring;
- MFA/SSO dashboard configuration beyond the basic Clerk integration;
- broad tenant administration UI.

These items require separate designs after this phase's authorization and audit
gates are proven.