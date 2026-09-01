---
name: Node cluster relay boundary
description: Security and scheduling boundaries for the tenant-scoped logical worker cluster.
---

The node cluster is ten tenant-scoped logical process slots. Accepted tasks spawn short-lived fixed-code workers through local IPC; the task envelope is signed and verified, but this is not an encrypted private mesh, container/VM isolation, or durable distributed ownership.

**Why:** Operator-visible runtime and transport claims must describe guarantees the implementation actually provides. A timer-only model cannot be presented as a worker relay, and a local signed process boundary cannot be presented as cross-host encrypted delivery.

**How to apply:** Keep task metadata allowlisted and discriminated, expose only `PROCESS` until another runtime exists, preserve bounded worker lifecycle controls, and schedule shared capacity from a manager-wide priority queue across tenants.