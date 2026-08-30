---
name: PostgreSQL execution transactions
description: Multi-instance locking, authoritative storage, and recoverable audit-transition rules.
---

When work is protected by a PostgreSQL session advisory lock, every database
operation in that scope must reuse the connection that owns the lock. Never
check out a second pooled connection from inside the locked scope.

PostgreSQL is the only authoritative META-CUBE store outside explicit
development/test mode. File storage may be selected deliberately for local
work, but a PostgreSQL failure must never trigger an automatic file fallback.

**Why:** Reserving one connection for the lock and waiting for another can
deadlock at pool capacity. Operations that represent one state transition,
such as resetting an execution while removing its DLQ record, can also become
internally inconsistent if committed separately. Automatic file fallback would
split execution history and idempotency state across production instances.

**How to apply:** Keep lock ownership connection-scoped, commit durable
checkpoints on that connection while retaining the session lock, and combine
coupled record changes into one transaction with rollback tests. Require
PostgreSQL in production and fail explicitly when it is unavailable; enable
FileStore only through an explicit development/test configuration.

Prediction/audit workflows may commit an immutable prediction before its later
outcome only when pending predictions are durably reconciled. Unresolved rows
must be excluded from success-rate training statistics rather than interpreted
as failures.

**Why:** Preserving an immediate prediction is useful for auditability, but a
crash between prediction and outcome otherwise poisons the learning feedback
loop and biases future scenario selection.

**How to apply:** Keep prediction and outcome append-only, reconcile missing
outcomes under the same cross-instance lock on the next cycle, and aggregate
defense metrics only over predictions that have an outcome.