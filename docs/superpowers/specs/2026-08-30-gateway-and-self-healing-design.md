# Gateway, VirtualBox Control, and SOC Self-Healing Design

**Date:** 2026-08-30  
**Status:** Awaiting written-spec review  
**Scope:** Node Gateway, remote VirtualBox Gateway Agent, gateway protocol, authorization boundary, and expanded self-healing

## 1. Goals

SOC-OS needs two separately isolated connection components:

1. A Node Gateway for node enrollment, telemetry, heartbeat, live delivery, and
   command acknowledgements over HTTP and WebSocket.
2. A VirtualBox Gateway Agent that runs on a host where VirtualBox is
   installed and provides typed, fully managed lab control without exposing
   host shell access to the central SOC.

Self-healing must cover both registered managed artifacts and SOC control /
derived runtime state. It must never erase, rewrite, or roll back immutable
security evidence.

The system must preserve these existing boundaries:

- PostgreSQL is authoritative storage.
- Redis is transport only.
- META-CUBE owns durable execution mechanics, retries, checkpoints, and
  recovery transport; it does not own VirtualBox semantics.
- Quarantine is a logical deny-by-default envelope.
- HCK-BIOS and hardware-like diagnostics remain read-only.
- Markov analysis and CPU-emulated quantum observations remain separate
  analytical layers.
- Observer and analytical layers cannot directly operate gateways.

## 2. Non-goals and safety constraints

This design does not provide:

- arbitrary shell, `eval`, terminal, SQL, package installation, or process
  execution through either gateway;
- direct API access from nodes or VirtualBox hosts to PostgreSQL, Redis, or
  META-CUBE;
- host/workspace rollback;
- automatic release of quarantine;
- automatic issuance or widening of gateway capabilities;
- rollback or deletion of event hash chains, quarantine captures, DNA memory,
  attack graph evidence, or audit history;
- a claim that SHA-256 is encryption.

TLS/mTLS protects transport. HMAC-SHA-256 authenticates message envelopes.
SHA-256 provides integrity hashes for payloads, snapshots, and state.

Full VirtualBox control is only enabled after the authorization execution-plane
boundary and durable audit records are available. Until then, the agent may
run in inventory/read-only or fake-provider mode.

## 3. Architecture

```text
Node ── HTTPS / WebSocket ──> Node Gateway ──┐
                                             │
VirtualBox Host ─ outbound mTLS/WS ─> VBox Agent
                                             │
                                             ▼
                                  API Gateway Ingress
                                             │
                        ┌────────────────────┴────────────────────┐
                        ▼                                         ▼
                    SOC pipeline                              META-CUBE
                        │                                         │
             ┌──────────┼──────────┬──────────┐          durable command jobs
             ▼          ▼          ▼          ▼
          Markov     Quantum      DNA      Quarantine
          layer      CPU-only    memory
                        │
                  Self-healing
```

### 3.1 Node Gateway

Node Gateway is a separate service and workflow. It owns edge connection
management, not SOC decisions or command execution.

Responsibilities:

- enrollment proof validation and node identity lifecycle;
- HTTP telemetry and heartbeat ingestion;
- WebSocket connection management, heartbeat, delivery, acknowledgement, and
  reconnect handling;
- message size, rate, schema, timestamp, nonce, and signature checks;
- per-node ordering and deduplication;
- forwarding only validated envelopes to the central API ingress;
- delivery status and sanitized connection errors.

It does not execute a command received from a node. A command sent to a node
is an already authorized, typed command and the node only acknowledges receipt
or reports the result permitted by its capability scope.

### 3.2 VirtualBox Gateway Agent

VirtualBox Gateway Agent is a separately deployed process on the VirtualBox
host. It establishes an outbound authenticated connection to the central
gateway/API. The host does not need an inbound management port.

The agent owns:

- local VirtualBox provider access;
- host and VM identity verification;
- typed operation validation;
- VM, snapshot, and network allowlists;
- local precondition checks;
- idempotency and duplicate-operation protection;
- sanitized result mapping.

The central API never constructs or executes a `VBoxManage` string. The
production adapter may use a VirtualBox API or generated argv calls, but
operations are constructed from validated typed values and never from a raw
command string. The agent runs under a least-privilege host service account.

### 3.3 Shared protocol library

`lib/gateway-protocol` contains only shared protocol primitives:

- envelope schemas;
- canonical serialization;
- HMAC-SHA-256 signing and verification;
- payload SHA-256 calculation;
- timestamp / nonce / message ID replay checks;
- typed message and operation schemas;
- bounded payload and error normalization helpers.

The library does not contain database access, VirtualBox calls, authorization
policy storage, or gateway-specific business logic.

## 4. Gateway protocol

Every gateway message uses this logical envelope:

```json
{
  "protocolVersion": 1,
  "messageId": "unique-message-id",
  "correlationId": "request-correlation-id",
  "sourceId": "node-or-host-identity",
  "tenantId": "authenticated-tenant",
  "timestamp": "2026-08-30T00:00:00.000Z",
  "nonce": "single-use-value",
  "messageType": "typed-message-kind",
  "payloadHash": "sha256-of-canonical-payload",
  "payload": {},
  "signature": "hmac-sha256-signature"
}
```

`tenantId` is derived from the authenticated identity and is not trusted when
only supplied in a body or query parameter.

### 4.1 Node HTTP surface

The first Node Gateway surface is:

```text
POST /v1/nodes/enroll
POST /v1/nodes/{nodeId}/heartbeat
POST /v1/nodes/{nodeId}/events
GET  /v1/nodes/{nodeId}/status
POST /v1/nodes/{nodeId}/commands/{commandId}/ack
```

All requests use the envelope rules. Enrollment is the only operation that
creates identity state, and it requires an enrollment proof. Status returns
only allowlisted operational fields.

### 4.2 Node WebSocket surface

The WebSocket connection is authenticated during handshake and then validates
the same envelope for every frame. It supports:

- server and client heartbeat;
- live telemetry;
- delivery of already approved typed commands;
- delivery acknowledgement;
- reconnect with exponential backoff;
- per-node sequence/order and message deduplication.

WebSocket does not bypass HTTP policy or capability checks.

### 4.3 VirtualBox message types

The initial typed operation set is:

```text
vm.status
vm.start
vm.stop
vm.pause
vm.reset
snapshot.create
snapshot.restore
network.attach
network.detach
```

The operation payload identifies `hostId`, `vmId`, and, where applicable,
`snapshotId`, network profile, and an idempotent `requestId`. It does not
contain a shell command.

The agent may add provider-specific fields only behind a versioned schema and
allowlist. Unknown fields and unknown operation types are rejected rather than
silently ignored.

## 5. Authorization and command lifecycle

The gateway is an authenticated control boundary, not an authorization
bypass. Each command is checked in this order:

```text
authenticated principal
→ tenant scope
→ role
→ capability
→ host allowlist
→ VM allowlist
→ operation allowlist
→ risk / approval policy
→ quarantine state
→ current-state preconditions
→ idempotency
```

Capability scopes are separate:

```text
virtualbox:read
virtualbox:vm-lifecycle
virtualbox:snapshot
virtualbox:network
virtualbox:quarantine-release
```

High-risk operations require explicit approval. This includes stop, reset,
snapshot restore, network mutation, quarantine release, and any operation
against a VM with an active incident.

The durable command state machine is:

```text
REQUESTED
→ POLICY_CHECKED
→ APPROVAL_REQUIRED | APPROVED
→ DISPATCHED
→ EXECUTING
→ COMPLETED | FAILED | TIMED_OUT | CANCELLED
```

The command ledger is written before dispatch. Retries use the same
idempotency key. A reconnect or at-least-once transport delivery cannot
silently repeat a destructive VM mutation.

META-CUBE may transport durable gateway command jobs and provide retry /
checkpoint mechanics. It does not decide whether an operation is safe or
translate VirtualBox operations. The VirtualBox Agent performs the final
precondition and idempotency checks immediately before mutation.

## 6. Quarantine interaction

When an event produces `ISOLATE` for a VM or managed resource:

1. the event and quarantine capture are persisted atomically;
2. execution and network access are marked disabled in the logical envelope;
3. normal VM lifecycle, network, and release operations are denied;
4. snapshot and recovery references are preserved in evidence;
5. self-healing may prepare a verified restore plan;
6. no quarantine release occurs without a separate authorized transition.

The gateway never accepts a command merely because it appears in an event
payload. Quarantine evidence, event hash chain, DNA memory, attack graph
links, and audit records remain append-only.

## 7. Self-healing model

Self-healing uses explicit managed resources and verified restore manifests.
Every restorable item has a stable logical key, a `managed://` location, a
canonical JSON state, a SHA-256 state hash, a schema version, and an immutable
verified restore point.

The existing 64 KB per-state policy remains in force. Larger configurations
are represented as multiple logical resources in a manifest; the limit is not
bypassed by accepting an unbounded blob.

### 7.1 Managed artifacts

Managed artifact restore is same-location and atomic:

```text
resource lookup
→ verified restore point
→ hash check
→ location check
→ preview
→ authorized apply
→ post-restore hash verification
```

An explicit `managedResourceKey` may enable `AUTO` restore for a resource
whose policy allows automatic recovery. A failed restore records the failure
and leaves the resource quarantined or degraded.

### 7.2 SOC control state

The following are restorable control resources:

- detection rules;
- correlation rules;
- policy and configuration;
- SOAR policy configuration;
- gateway capability and allowlist policy;
- runtime configuration required to start a consistent pipeline.

These use logical keys such as `managed://soc/control/...` and require preview
plus authorized apply by default. A security event alone cannot silently
replace detection or authorization policy.

### 7.3 Derived runtime state

Derived runtime state is rebuilt from durable facts rather than restored as an
unverified old dump:

1. commit the verified control snapshot;
2. rebuild in-memory indexes;
3. replay durable security facts;
4. recompute first-order Markov observations;
5. recompute CPU-emulated quantum observations;
6. rebuild read models and health projections.

First-order Markov analysis uses `P(next_state | current_state)` and returns a
separate observation with transition probability, confidence, timestamp, and
correlation ID. It does not control a gateway.

The CPU quantum emulator is a separate CPU-only observation layer. It has no
host, gateway, VM, or execution privilege. Its failure cannot block DNA facts,
quarantine, or integrity verification.

DNA memory and attack graph data remain append-only facts / derived links.
They can be projected or replayed into read models, but self-healing never
deletes or rewrites their historical records.

## 8. Durable storage and API

The control plane adds isolated records for:

```text
gateway_nodes
gateway_hosts
gateway_connections
gateway_commands
gateway_command_events
gateway_audit_entries
```

Records include authenticated identity, tenant scope, capability policy,
connection state, request/correlation/message IDs, typed operation, payload
hash, approval decision, previous/current state, result, error code, and
timestamps.

Private keys, HMAC secrets, enrollment secrets, and raw credentials are not
stored in PostgreSQL. Records may contain a credential reference, fingerprint,
or key version.

Central API route groups are:

```text
/api/gateway/nodes/*
/api/gateway/hosts/*
/api/gateway/commands/*
/api/gateway/audit/*
/api/gateway/policies/*
```

Gateway transport endpoints remain separate from operator-facing API routes.
Dashboard actions create typed command requests; they never call VirtualBox
directly.

## 9. Service layout

The intended implementation layout is:

```text
artifacts/node-gateway       central Node HTTP + WebSocket service
services/virtualbox-agent    remote VirtualBox host agent
lib/gateway-protocol         shared typed protocol and crypto helpers
artifacts/api-server         authorization, command ledger, SOC integration
artifacts/soc-dashboard      inventory, approvals, status, and audit UI
```

The VirtualBox Agent exposes a provider abstraction:

```text
VirtualBoxProvider
  getVmState()
  startVm()
  stopVm()
  pauseVm()
  resetVm()
  createSnapshot()
  restoreSnapshot()
  attachNetwork()
  detachNetwork()
```

Development and CI use a fake provider. A real host integration test is
opt-in and must use a disposable VirtualBox lab.

## 10. Verification and rollout

### Protocol and gateway tests

- canonical envelope and HMAC-SHA-256 signature vectors;
- SHA-256 payload hash mismatch;
- timestamp, nonce, message ID, and replay rejection;
- payload size, schema, rate, and unknown-message rejection;
- enrollment and credential rotation;
- WebSocket reconnect, ordering, acknowledgement, and deduplication.

### Authorization and control tests

- tenant isolation and authenticated principal derivation;
- capability denial and approval-required states;
- host / VM / operation allowlist enforcement;
- quarantine denial and authorized release transition;
- idempotent retries for destructive operations;
- command timeout, disconnect, cancellation, and sanitized errors;
- durable audit creation before dispatch.

### Self-healing tests

- verified managed artifact preview and same-location apply;
- invalid hash, invalid location, missing restore point, and oversized state;
- verified SOC control-state restore;
- derived-state replay and Markov / quantum recomputation;
- preservation of quarantine captures and event hash chain;
- partial failure with no partially visible control-state commit.

### Rollout stages

1. Shared protocol library and fake providers.
2. Node Gateway and VirtualBox Agent in read-only / inventory mode.
3. Durable command ledger and authorization with dispatch disabled.
4. Controlled VM lifecycle in a disposable lab.
5. Snapshot and network operations.
6. SOC control-state restore and derived-state replay.
7. Per-host / per-tenant production canary.

The implementation is not complete until HCK-BIOS reports all required
gateway/self-healing schema stages ready, full typecheck passes, protocol and
API tests pass, and browser E2E covers operator approval, command status,
failure, empty, loading, and disconnected states.