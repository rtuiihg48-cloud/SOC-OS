---
name: Observer-only agent loop
description: Safety and isolation boundaries for deterministic agent analysis in the SOC runtime.
---

The agent loop may observe, analyze, plan, and critique, but it must not expose
general shell/web execution or mutate production systems. Policy decisions,
plans, tool results, and reflections are persisted as immutable audit records.

**Why:** Agentic planning is useful for SOC explanation, but uncontrolled tools
or hidden state changes would turn an analysis feature into an execution plane.

**How to apply:** Allow only named read-only capabilities, validate structured
inputs, block destructive or executable intent, mark production changes false,
and ensure observer/synthetic analysis does not update live detector caches.