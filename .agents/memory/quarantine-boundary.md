---
name: Quarantine boundary
description: Defines how detected threats are captured before any future execution sandbox is enabled.
---

An event classified as `ISOLATE` must be marked `QUARANTINED` and captured in a
separate logical isolation envelope in the same PostgreSQL transaction.

**Why:** Merely labeling an event `ISOLATE` does not prove containment. A
dedicated record makes the boundary observable and auditable while preventing a
malicious payload from being treated as executable input.

**How to apply:** Store evidence and a bounded snapshot, never execute the event
text, and keep execution, network, and host access disabled. A future container
phase must be separately authorized, fail closed, and must not weaken the
logical quarantine invariant.