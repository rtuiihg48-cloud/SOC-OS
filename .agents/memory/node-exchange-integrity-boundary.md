---
name: Node exchange integrity boundary
description: Durable security semantics for the permissioned node-to-node exchange ledger.
---

Node exchange records are tamper-evident evidence, not a claim of physical immutability. Envelopes use exact canonical UTC timestamps, canonical JSON, SHA-256 links, Ed25519 signatures, nonces, and monotonically increasing sender sequences. Public keys are versioned and immutable; revocation is final, and historical verification uses the exact recorded key version. Private signing keys never belong in PostgreSQL or application source.

**Why:** Hashes alone do not establish identity, key management, delivery, payload safety, or execution. Mutable historical keys, non-canonical timestamps, and non-monotonic sequences can make a seemingly valid ledger unverifiable or replayable.

**How to apply:** Keep append, sender-sequence advancement, route-hop creation, ledger-head movement, and audit evidence atomic. Scope uniqueness by tenant. Describe route verification as cryptographic integrity only; mTLS remains an infrastructure boundary unless client-certificate evidence is actually verified.