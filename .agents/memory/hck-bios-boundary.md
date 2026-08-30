---
name: HCK-BIOS boundary
description: Defines the operational role and isolation limits of the software BIOS and hardware-like diagnostics.
---

HCK-BIOS is an ordered readiness and control-plane bootstrap, not firmware or a
virtual CPU. It reports real runtime, database, schema, policy, queue, host, and
META-CUBE state.

**Why:** Decorative MESI, NUMA, fake cores, or in-memory RAM would obscure the
actual PostgreSQL, Redis, worker, and host behavior that operators need to trust.

**How to apply:** Keep capability manifests allowlisted and read-only. Hardware
analogies may describe topology and isolation, but must not create fake execution,
authoritative memory, self-modifying code, or production mutation paths.