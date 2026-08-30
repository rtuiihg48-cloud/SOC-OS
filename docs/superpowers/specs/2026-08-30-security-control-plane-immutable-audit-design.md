# Security Control Plane + Immutable Audit Trail

**Date:** 2026-08-30  
**Status:** Design proposal for review  
**Scope:** First implementation phase of the security innovation roadmap

## 1. Context and goals

SOC OS already has a useful separation between the Express control plane, the
META-CUBE execution plane, the observer-only agent loop, traffic metadata, and
logical quarantine/self-healing. It also stores a SHA-256 hash and previous
hash on security events. The next phase must make those boundaries enforceable
by server-side identity, policy, and evidence rather than by request shape or
natural-language filtering.

This phase creates two coupled foundations:

1. A **Security Control Plane** that derives tenant and actor scope from an
   authenticated principal, evaluates typed capabilities, and authorizes every
   state-changing operation.
2. An **Immutable Audit Trail** that records security-relevant decisions and
   transitions in a serialized append-only chain that can be independently
   verified.

The goal is not to add autonomous remediation yet. The goal is to make future
predictive and agentic features safe to add without allowing an AI proposal,
client-provided tenant ID, or traffic signal to bypass authorization.

## 2. Non-goals and preserved boundaries

This phase explicitly does not:

- add arbitrary shell, filesystem, host rollback, or code execution;
- make the observer agent an execution agent;
- automatically apply AI-generated code fixes;
- allow traffic or predictive signals to isolate a node;
- add raw packets, PCAP, passive sniffing, or payload retention;
- replace META-CUBE's PostgreSQL authority, retry, checkpoint, recovery, or DLQ
  semantics;
- replace logical quarantine with a runnable sandbox;
- introduce blockchain as the primary audit database;
- copy secrets, private malware samples, encrypted payloads, or full request
  bodies into audit records.

The existing quarantine invariant remains mandatory: an isolation record is a
logical envelope and its payload remains non-executable. Self-healing remains
limited to verified `managed://` resources at the same logical location.

## 3. Design principles

### 3.1 Server-derived scope

The API must never trust `tenantId`, `actorId`, role, or capability supplied by
the browser or an untrusted gateway. A request receives an authenticated
principal from middleware. Tenant scope is derived from that principal and
the target resource. A body tenant ID may be accepted only as a consistency
check and must be rejected if it differs from the derived scope.

### 3.2 Typed actions, not natural-language authority

Authorization operates on a typed action and target:

```text
subject: authenticated principal
tenant: derived tenant scope
action: typed capability
target: typed resource identity
context: reason, correlation ID, risk metadata, request origin
```

The policy engine returns a structured decision. Agent instructions and voice
transcripts can produce a proposal, but they cannot be passed directly to an
executor or treated as authorization.

### 3.3 Evidence before consequence

The system records the authorization decision and relevant evidence before or
atomically with a state transition. Audit failure must not silently erase the
primary security event. Where the business transition cannot safely be
committed without its evidence, both are rolled back and the caller receives a
retryable error.

### 3.4 Append-only by construction

Application conventions are insufficient for immutability. The database must
enforce append-only behavior using permissions and, where supported by the
current migration strategy, a trigger that rejects `UPDATE` and `DELETE`.
Chain linking must be serialized inside the same transaction that inserts the
record.

## 4. Control-plane architecture

### 4.1 Principal model

Introduce a normalized authenticated principal abstraction with:

- `principalId`;
- `principalType`: `USER`, `SERVICE`, or `GATEWAY`;
- `tenantIds` or an explicit tenant scope;
- assigned roles/capabilities;
- authentication method and credential version;
- request/correlation ID.

The exact authentication provider remains an implementation decision for the
existing project authentication setup. The interface must not expose raw
credentials to route handlers.

The middleware attaches the principal to the request. Routes consume the
principal and do not parse identity from request body fields.

### 4.2 Capability vocabulary

The initial capability vocabulary is intentionally small:

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

Capabilities are not implied by a route name. Each route declares the
capability and target scope required for the operation. Future actions such as
`firewall:apply` or `agent:remediate` must be introduced as new typed
capabilities and cannot be smuggled through an existing generic action.

### 4.3 Policy decision

The policy engine returns a stable object:

```text
allowed: boolean
decisionId: string
subject: principal identity
tenantId: number | null
action: capability
target: typed target
reasonCode: string
expiresAt: timestamp | null
requiredApproval: boolean
```

Denials use stable reason codes rather than sensitive internal details. Every
decision that controls a mutating request is audited, including denials for
security-sensitive actions. Read-only high-volume telemetry reads may use a
bounded audit sampling policy only if that exception is documented; security
state transitions and authorization decisions are never omitted.

### 4.4 Route boundary changes

The first implementation should protect the highest-risk existing boundaries
first:

1. event ingestion and event status mutation;
2. META-CUBE submit/retry/recover/DLQ operations;
3. observer-agent requests;
4. quarantine and self-healing operations;
5. traffic and audit reads.

The META-CUBE service remains a separate execution plane. Express may authorize
an execution request, but only META-CUBE owns execution, retries, checkpoints,
recovery, and DLQ state. The bridge must forward a typed authorization context
and correlation ID, not a raw user instruction.

## 5. Immutable audit model

### 5.1 Unified audit record

Add a dedicated append-only audit record rather than overloading
`security_events`. The record should include:

- monotonic database identifier;
- `tenantId` with restrictive foreign-key behavior;
- `occurredAt` and server insertion timestamp;
- `principalId` and `principalType`;
- `action`;
- `targetType` and non-secret `targetId`;
- `decision`: `ALLOWED`, `DENIED`, `COMMITTED`, `FAILED`, or `REJECTED`;
- `reasonCode`;
- correlation/request ID;
- sanitized metadata JSON with a bounded size;
- `prevHash`;
- `hash`;
- optional `externalAnchorId` for a later anchoring phase.

The hash input must be canonical and include all security-relevant immutable
fields, including tenant, principal, action, decision, target, timestamps,
sanitized metadata, and `prevHash`. Hashing is for integrity verification, not
encryption.

### 5.2 Chain partitioning

Use a single authoritative chain per tenant, with a separate system chain for
global control-plane events that have no tenant. The chain head must be
serialized per partition. A global “latest row ordered by timestamp” query is
not sufficient because concurrent requests can select the same predecessor.

The implementation should use one of these equivalent transactional patterns:

- a tenant/system chain-head row locked with `SELECT ... FOR UPDATE`, then
  insert the new audit row and update the head in the same transaction; or
- a PostgreSQL advisory lock acquired and held on the same pooled connection
  for the full read-head/insert/update transaction.

The connection-scoped locking rule already used by META-CUBE must be preserved.
No process-local mutex may be used as the production correctness mechanism.

### 5.3 Append-only enforcement

The migration must:

- create indexes for tenant/time, correlation ID, action/decision, and chain
  verification;
- grant insert/select privileges to the API role;
- deny update/delete privileges for the audit table;
- add a database trigger that rejects update/delete for defense in depth;
- use restrictive foreign-key behavior for related tenant identity;
- define a bounded metadata size policy.

If the current development migration workflow cannot safely provision separate
database roles, the application must fail closed in production startup with a
clear diagnostic rather than claim immutability based only on TypeScript code.

### 5.4 Verification

Provide a verifier usable both from tests and an operator-facing endpoint with
`audit:verify`. It must support:

- verifying a complete chain;
- verifying a tenant and time range;
- reporting the first broken predecessor, malformed canonical payload, or hash
  mismatch;
- detecting duplicate or missing sequence positions if a sequence is used;
- returning counts and a safe error summary without exposing metadata payloads.

Verification must be read-only. It must never repair or rewrite the chain.

## 6. State-transition flows

### 6.1 Authorized mutating operation

1. Middleware authenticates the request and attaches a principal.
2. Route validates the typed input.
3. Route derives tenant and target scope from server-side state.
4. Policy engine evaluates the typed capability.
5. The system opens one database transaction.
6. The transaction locks the relevant chain head.
7. The state transition and `COMMITTED` audit record are inserted atomically.
8. The transaction commits.
9. External broadcast happens after commit and carries the audit/correlation ID.

If the transition is asynchronous, the audit event records `ACCEPTED` or
`QUEUED` rather than claiming completion. The worker later appends a separate
result event.

### 6.2 Denied operation

The request is rejected with `401` when no principal exists and `403` when a
principal exists but lacks policy. The denial is audited when an authenticated
principal and safe target scope are available. The denial record must not
include raw credentials, full request bodies, or untrusted free-form content.

### 6.3 Concurrent chain writes

Concurrent requests for one tenant must serialize around the chain head. A
deadlock/serialization failure returns a retryable response and does not
publish a WebSocket/SSE event. A retry must use a new request attempt and must
not duplicate a committed state transition; idempotency keys are required for
mutating operations.

### 6.4 Audit storage degradation

The behavior must be explicit:

- if an audit record is required for a state transition and cannot be written,
  the transition is rolled back;
- if a non-critical diagnostic audit write fails after a primary event is
  committed, the system emits a high-severity internal integrity alert and
  exposes degraded status;
- there is no silent in-memory or local-file fallback for authoritative audit
  records.

## 7. API and UI surface

### API

Add typed contracts for:

- current principal/capabilities;
- policy decision result where a caller is allowed to inspect it;
- paginated tenant-scoped audit listing;
- chain verification request and result.

Audit listing must support bounded filters for action, decision, principal,
target type, correlation ID, and time range. Pagination must be cursor-based or
otherwise stable under concurrent inserts.

### Dashboard

The first UI should be a read-only Security Audit Trail page with:

- filters and pagination;
- decision badges;
- actor, action, target, timestamp, and correlation ID;
- safe reason code and result;
- chain integrity status;
- a manual “Verify range” action for users with `audit:verify`.

The UI must not expose secrets or assume that a displayed `ALLOWED` proposal
was applied. Applied state must be represented by a separate committed result.

## 8. Error handling and observability

Use stable error categories:

- `AUTHENTICATION_REQUIRED`;
- `TENANT_SCOPE_MISMATCH`;
- `CAPABILITY_DENIED`;
- `TARGET_NOT_FOUND`;
- `IDEMPOTENCY_CONFLICT`;
- `AUDIT_UNAVAILABLE`;
- `AUDIT_CHAIN_CONFLICT`;
- `AUDIT_INTEGRITY_FAILURE`;
- `INVALID_TYPED_ACTION`.

Metrics should distinguish:

- authorization allow/deny counts by capability and reason code;
- audit append latency and failure count;
- chain serialization conflicts;
- verification duration and broken-chain count;
- state transitions rolled back because audit was unavailable.

Logs may include correlation IDs and stable identifiers, but never credentials,
private sample bytes, or unsanitized prompt/transcript content.

## 9. Testing strategy

### Unit tests

- canonical hash determinism;
- changed-field hash mismatch;
- policy decisions for each initial capability;
- tenant mismatch rejection;
- action typing rejection;
- metadata redaction and size bounds;
- idempotency behavior.

### Database/integration tests

- two concurrent audit writers for one tenant produce a valid chain;
- writers for different tenants do not link to each other;
- update/delete are rejected by database protections;
- a failed audit insert rolls back the protected state transition;
- verifier identifies a deliberately corrupted row;
- no local-file fallback is used for authoritative audit state.

### API tests

- unauthenticated requests receive `401`;
- cross-tenant reads and writes receive `403` or a safe not-found response;
- observer-agent remains `productionChanged: false`;
- META-CUBE routes authorize the bridge but do not execute in Express;
- denial and commit events contain correlation IDs;
- replaying an idempotent mutating request does not duplicate the transition.

### Browser tests

- audit filters and pagination render without DOM lifecycle errors;
- denied actions are visible as denied rather than silently disappearing;
- verification errors render a safe diagnostic state;
- long actor/target values do not escape the layout;
- no secrets or raw event payloads are rendered.

## 10. Rollout and migration

1. Add schema and verifier behind no-op reads; do not alter existing event
   semantics.
2. Add principal middleware and capability checks to one low-risk read route,
   then expand by risk order.
3. Dual-write audit records for selected event and execution transitions while
   comparing verification results.
4. Enable append-only database protections and require audit success for
   protected mutations.
5. Add the dashboard after API and verifier behavior is stable.
6. Remove unsafe body-derived tenant behavior and unscoped route fallbacks.

Migration must preserve existing security-event hashes. The new audit chain is
an additional evidence stream, not a rewrite of historical event hashes.

## 11. Acceptance criteria

The first phase is complete only when:

- authenticated scope is derived server-side for all protected routes;
- no protected route authorizes from a client-provided tenant or role;
- observer-agent remains read-only and cannot reach an executor;
- audit records are serialized, append-only, tenant-scoped, and independently
  verifiable;
- concurrent writers cannot create two records with the same predecessor;
- a required audit failure prevents the associated protected mutation;
- all META-CUBE, quarantine, self-healing, and traffic safety boundaries remain
  intact;
- API, database, and browser regression tests pass;
- production configuration does not rely on a process-local lock or silent
  fallback store.

## 12. Future extension points

This design intentionally leaves clean extension points for:

- authenticated gateway identity and application-level encryption;
- predictive models consuming verified telemetry;
- typed agent remediation proposals;
- external anchoring of chain roots.

An external ledger may store periodic chain roots after this phase. It must not
become a second mutable source of truth or receive private event contents.