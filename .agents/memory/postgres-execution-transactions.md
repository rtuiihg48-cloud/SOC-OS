---
name: PostgreSQL execution transactions
description: Multi-instance locking and atomicity rules for authoritative execution state.
---

When work is protected by a PostgreSQL session advisory lock, every database
operation in that scope must reuse the connection that owns the lock. Never
check out a second pooled connection from inside the locked scope.

**Why:** Reserving one connection for the lock and waiting for another can
deadlock at pool capacity. Operations that represent one state transition,
such as resetting an execution while removing its DLQ record, can also become
internally inconsistent if committed separately.

**How to apply:** Keep lock ownership connection-scoped, commit durable
checkpoints on that connection while retaining the session lock, and combine
coupled record changes into one transaction with rollback tests.