---
name: Traffic analysis boundary
description: Safety and interpretation rules for gateway-derived traffic analysis.
---

Traffic analysis consumes only bounded Node Gateway heartbeats and flow-summary metadata. It does not capture raw packets, retain payloads, sniff hosts, perform deep packet inspection, execute content, or change firewalls.

**Why:** Network observations can expose sensitive data and weak per-record thresholds can be mistaken for proven attacks. The current deterministic signals are explainable indicators for analyst review, not authoritative behavioral attribution or permission to act automatically.

**How to apply:** Keep synthetic observations visibly separated, keep recommendations advisory, and require authenticated gateway identity with server-derived tenant scope before production use. Temporal behaviors such as beaconing, scans, tunneling, and volume anomalies should graduate to bounded tenant-scoped baselines before being treated as high-confidence detections.