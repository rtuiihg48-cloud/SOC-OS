---
name: DNA attack graph
description: Durable rules for linking attack predictions without weakening authoritative memory.
---

Treat predictions and outcomes as authoritative facts. Attack-graph edges are
derived, directional memory that explains relationships between those facts
using explicit evidence and confidence.

**Why:** The graph is useful for attack-chain learning, but inferred
relationships can be incomplete or wrong. A graph error must never prevent or
rewrite the underlying prediction and outcome.

**How to apply:** Append links from older predictions to newer predictions,
retain their evidence and model version, prevent self-links and duplicate
pair/type edges, and isolate graph-building failures from the base DNA-memory
write path.