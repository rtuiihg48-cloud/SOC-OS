---
name: Self-healing boundary
description: Defines the safe restore scope and fail-closed behavior for automated recovery.
---

Self-healing operates only on explicitly registered logical resources under the
`managed://` namespace. Recovery uses immutable verified snapshots and restores
state only to the resource's recorded logical location.

**Why:** A security detector must not gain arbitrary host filesystem or command
execution privileges. Explicit resource identity, hash verification, and
same-location enforcement prevent a compromised event from choosing what or
where to restore.

**How to apply:** Preserve quarantine evidence first, then run recovery in a
separate atomic transaction. If the resource, restore point, hash, or location
cannot be verified, record the failure and leave the resource quarantined.
Never use event payloads as shell, eval, or subprocess input.