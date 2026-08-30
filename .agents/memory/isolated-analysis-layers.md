---
name: Isolated analysis layers
description: Separation rules for Markov and CPU-emulated quantum analyses attached to DNA predictions.
---

Markov and quantum processing are separate analyses with independent outputs.
Neither layer is an authoritative prediction or outcome, and their results must
not be merged into one opaque model response.

**Why:** Separate observations preserve explainability and allow either
experimental model to evolve or fail without corrupting the CPU simulator's
authoritative DNA facts.

**How to apply:** Keep each layer behind a pure interface, persist one
append-only observation per prediction and layer, and isolate failures from the
prediction/outcome transaction. Quantum processing remains CPU-only simulation
unless real quantum hardware is explicitly requested later.