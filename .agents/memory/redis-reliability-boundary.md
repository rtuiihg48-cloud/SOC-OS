---
name: Redis reliability boundary
description: Reliability rules for using Redis Streams as transport while another backend owns execution state.
---

Treat Redis Streams as queue transport, not persistence, unless Redis truly owns all authoritative execution and checkpoint state. Health reporting must distinguish the two.

**Why:** A connected queue can still fail after durable acceptance or while consuming. Claiming Redis persistence, or publishing only once, makes queued work appear reliable while allowing transient outages to strand it.

**How to apply:** Persist acceptance first, acknowledge only after state/checkpoint persistence, reclaim pending messages, and continuously replay durable queued records with bounded reconnect backoff. Any publish exception must invalidate the transport so reconnect and durable outbox replay actually run; a still-present client is not proof of availability.