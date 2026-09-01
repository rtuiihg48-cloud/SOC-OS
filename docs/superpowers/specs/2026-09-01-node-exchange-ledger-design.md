# Node Exchange Ledger Design

**Status:** Proposed for review  
**Date:** 2026-09-01  
**Scope:** Internal permissioned node-to-node exchange for SOC OS

## 1. Goal

Add a gateway through which META-CUBE nodes exchange signed messages and
persist a tamper-evident, hash-linked record of each accepted message and every
route hop. Operators must be able to inspect the complete route for a
correlation/message ID and verify the chain without granting the exchange
layer permission to execute payloads or mutate production policy.

“Impossible to forge” is implemented as **cryptographically detectable
tampering**:

- SHA-256 detects changes to canonical payloads, blocks, and route records.
- Ed25519 signatures authenticate the node that produced each message/hop.
- mTLS protects the transport connection and authenticates the gateway channel.
- Append-only database controls and verification detect storage tampering.

No system can promise safety if every signing key and every verifier is
compromised. The UI and API must therefore say “integrity verified” or
“verification failed”, not “mathematically impossible”.

## 2. Recommended architecture

### Components

1. **Node Exchange Gateway**
   - Accepts signed envelopes from registered nodes.
   - Validates protocol, node identity, signature, payload hash, sequence,
     nonce, TTL, route policy, and message size.
   - Appends a block and the current route hop atomically.
   - Relays only validated envelopes to the next allowed node.
   - Never evaluates the payload as code and never applies policy changes.

2. **Node Registry**
   - Stores node ID, role, public signing key, key version, status, allowed
     route peers, and last accepted sequence.
   - Private keys remain outside PostgreSQL in the service/node secret store.
   - Revocation and rotation are explicit and auditable.

3. **Exchange Ledger**
   - One append-only block stream per logical tenant/exchange scope.
   - Each block links to the previous block with SHA-256.
   - Database trigger rejects UPDATE, DELETE, and TRUNCATE.
   - A locked head row serializes concurrent appends.
   - The application role can insert and verify, but cannot rewrite history.

4. **Route Index**
   - Stores one immutable hop per accepted message.
   - Links all hops by `messageId` and `correlationId`.
   - Records source, destination, gateway, sequence, block number, timestamps,
     verification results, and failure reason when applicable.

5. **Verification service**
   - Recomputes payload hashes, signatures, block hashes, previous-hash links,
     sequence continuity, and route ordering.
   - Returns the first invalid block/hop and a complete verification summary.

6. **Dashboard route viewer**
   - Shows message identity, verification state, block chain, and a visual
     `N7 → Gateway → N2 → Gateway → N3` route.
   - Shows exactly which check passed or failed; no green state is shown when
     only transport succeeded but cryptographic verification is missing.

## 3. Signed message protocol

All hashes are computed over a canonical UTF-8 JSON representation with:

- sorted object keys;
- no insignificant whitespace;
- explicit protocol version;
- normalized ISO-8601 UTC timestamps;
- bounded payload size;
- no secret material in the payload.

The signed envelope is:

```json
{
  "protocolVersion": "node-exchange-v1",
  "messageId": "msg_...",
  "correlationId": "corr_...",
  "senderNodeId": "N7",
  "recipientNodeId": "N2",
  "sequence": 1042,
  "nonce": "base64url...",
  "issuedAt": "2026-09-01T08:00:00.000Z",
  "expiresAt": "2026-09-01T08:00:30.000Z",
  "payloadType": "strategy.signal",
  "payload": {},
  "payloadHash": "sha256:...",
  "previousMessageHash": "sha256:...",
  "keyVersion": 3,
  "signatureAlgorithm": "Ed25519",
  "signature": "base64url..."
}
```

`payloadHash` is SHA-256 over the canonical payload only. The signature covers
the canonical envelope excluding the signature field. The block hash covers
the canonical persisted block header, envelope hash, and route metadata.

SHA-256 is not used as encryption. Sensitive payloads require transport
encryption and, if needed, application-level encryption separately.

## 4. Block and route data model

Add migrations and Drizzle models for focused tables:

### `node_exchange_nodes`

- `node_id` primary key
- `role` (`ALLOCATION`, `COMPUTE`, `LEARNING`, `GATEWAY`, etc.)
- `public_key`
- `key_version`
- `status` (`ACTIVE`, `REVOKED`, `SUSPENDED`)
- `allowed_peer_ids` JSON
- `created_at`, `rotated_at`, `revoked_at`

### `node_exchange_heads`

- `scope_key` primary key
- `sequence`
- `current_block_hash`
- `updated_at`

### `node_exchange_blocks`

- generated ID
- `scope_key`
- block sequence
- `message_id`, `correlation_id`
- sender/recipient node IDs
- canonical envelope hash
- payload hash
- previous block hash
- block hash
- signature and key version
- verification status
- created/accepted timestamps
- bounded metadata only

Unique constraints cover `(scope_key, sequence)`, `(scope_key, block_hash)`,
and `(scope_key, message_id)` for idempotent retries.

### `node_exchange_route_hops`

- generated ID
- message ID and correlation ID
- hop sequence
- source node, gateway node, destination node
- block ID
- received/forwarded timestamps
- hop hash
- signature verification status
- route decision (`ACCEPTED`, `REJECTED`, `EXPIRED`, `REPLAYED`)
- reason code

Unique constraints cover `(message_id, hop_sequence)` and the hop hash.
Payload bytes are not duplicated into the route table.

## 5. Gateway flow

### Accept

1. Authenticate the service/gateway channel with mTLS and a scoped service
   credential.
2. Load the sender public key and active key version.
3. Validate protocol version, node status, peer route, payload size, and TTL.
4. Recompute canonical payload SHA-256 and compare in constant time.
5. Verify the Ed25519 signature.
6. Reject stale or repeated `(senderNodeId, sequence, nonce)` values.
7. Acquire the scope head lock on the same database connection.
8. Confirm `previousBlockHash` and append block + hop + updated head in one
   transaction.
9. Return block hash, verification status, correlation ID, and hop sequence.
10. Relay only after the transaction commits.

### Retry and failure behavior

- Same `messageId` with the same canonical hash returns the existing accepted
  result (idempotent retry).
- Same `messageId` with a different hash is a hard conflict and is audited.
- Invalid signature, hash, route, sequence, or TTL is rejected and never
  enters the accepted ledger.
- A relay failure does not rewrite accepted history; it appends a rejected or
  delivery-failed route observation linked to the same correlation ID.
- No exchange failure invokes execution, isolation, recovery, rule mutation,
  role mutation, or policy mutation.

## 6. API surface

Add contract-first OpenAPI endpoints:

- `POST /node-exchange/messages`
  - scoped gateway/service capability `node-exchange:submit`;
  - accepts a signed envelope;
  - returns accepted block, verification result, and first route hop.

- `GET /node-exchange/messages/:messageId/route`
  - capability `node-exchange:read`;
  - returns ordered hops, blocks, node labels, hashes, and verification checks;
  - tenant/scope filtering is enforced server-side.

- `POST /node-exchange/verify`
  - capability `node-exchange:verify`;
  - verifies a message route or bounded scope range;
  - never repairs or rewrites data.

- `GET /node-exchange/health`
  - capability `node-exchange:verify`;
  - reports head continuity, append readiness, key registry status, and
    pending verification failures.

All responses include `correlationId`, explicit `verificationStatus`, and
machine-readable reason codes. The API must not expose private keys or
unbounded payloads.

## 7. Authorization and key management

- Add capabilities separately from `dashboard:read`.
- `SOC_ADMIN` may inspect the route; `ANALYST` may inspect only tenant-scoped
  routes according to policy; `VIEWER` receives no exchange write capability.
- Only service/gateway principals with `node-exchange:submit` can submit a
  message.
- A request cannot select an arbitrary tenant or scope.
- Public keys are metadata and may be stored in PostgreSQL; private signing
  keys are workspace/service secrets or node-local secrets only.
- Key rotation increments `keyVersion`, leaves previous public keys available
  for historical verification, and blocks revoked keys for new messages.
- Audit every register, rotate, revoke, accept, reject, verify, and conflict
  decision with the existing immutable audit chain.

## 8. UI design

Add a **Node Exchange Integrity** surface to the SOC dashboard:

- status strip: `LEDGER HEALTH`, `HEAD`, `LAST VERIFIED`, `KEYS`;
- route summary with source, gateways, destinations, and hop status;
- expandable block details with sequence, previous hash, current hash,
  payload hash, signature key version, and timestamps;
- verification checklist:
  - payload hash;
  - signature;
  - previous block;
  - sequence/nonce;
  - route policy;
  - append transaction;
- filters for message ID, correlation ID, node, status, and time range;
- explicit states for loading, no route, rejected message, verification failure,
  and unavailable key;
- mobile view becomes a vertical timeline, not a squeezed table.

Use “Integrity verified” and “Verification failed”, never “unbreakable” or
“impossible to forge”. The UI must distinguish accepted ledger history from
successful downstream delivery.

## 9. Threat model and non-goals

### Covered

- payload alteration in transit;
- forged node identity without a private signing key;
- deleted/reordered/rewritten ledger rows;
- replayed messages;
- stale or revoked signing keys;
- unauthorized route hops;
- duplicate delivery;
- cross-tenant route disclosure;
- accidental execution of exchange payloads.

### Not covered by this subsystem

- public blockchain consensus or external notarization;
- cryptocurrency/token economics;
- recovery of a compromised private key;
- encryption of payload contents beyond TLS/mTLS;
- automatic repair of corrupted history;
- autonomous node spawning or capability changes.

If third-party proof is later required, add a separate anchoring design that
publishes only periodic Merkle roots, never tenant payloads or private data.

## 10. Testing and rollout

### Unit tests

- canonical JSON is stable across key insertion order;
- SHA-256 payload/block hashes detect one-byte changes;
- Ed25519 valid/invalid/rotated/revoked signatures;
- sequence, nonce, TTL, route, and idempotency rules;
- block-head locking and conflict behavior;
- verification identifies the first broken link;
- bounded route/payload limits.

### Database tests

- append succeeds in one transaction;
- concurrent appends preserve one sequence;
- UPDATE/DELETE/TRUNCATE are rejected;
- unique constraints reject duplicate sequence/hash/message;
- tenant/scope predicates prevent route disclosure.

### E2E tests

- submit `N7 → Gateway → N2 → Gateway → N3`;
- display the full route and verified checks;
- tamper with a test ledger row and show verification failure;
- retry the same message idempotently;
- reject a changed-hash duplicate;
- reject a viewer write and an unauthorized route read;
- verify mobile route timeline;
- prove no execution/policy mutation occurs.

Roll out behind a feature flag. Start with a synthetic test corpus and
service-to-service credentials, then register real node public keys only after
verification and rotation procedures are tested.
