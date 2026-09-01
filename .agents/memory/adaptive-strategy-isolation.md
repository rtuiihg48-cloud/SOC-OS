---
name: Adaptive strategy isolation
description: Corpus ownership and compatibility boundary for global adaptive strategy cycles.
---

Global adaptive strategy cycles may learn only from records explicitly marked as
belonging to the same global synthetic corpus. Tenant-owned DNA predictions,
outcomes, sequences, and graph links must never be mixed into that corpus.
Viewing the shared corpus requires an explicit global capability rather than a
tenant-scoped dashboard permission.

**Why:** A shared strategy trained on tenant records creates cross-tenant
inference and disclosure risk even when the dashboard exposes only aggregate
decisions. Older or differently scoped synthetic records may carry the same
risk indirectly.

**How to apply:** Treat the strategy isolation version as a compatibility and
security boundary. Apply it with the global ownership predicate to every
history, sequence, reconciliation, graph-link, and dashboard query. Start a new
version rather than silently mixing corpora when ownership or input semantics
change. Label simulated outcomes, quality, and drift as synthetic estimates;
never present them as measured tenant effectiveness. Sandbox limits must be
enforced and reported by the executor, not displayed as descriptive constants.