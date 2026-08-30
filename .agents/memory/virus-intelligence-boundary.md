---
name: Virus intelligence boundary
description: Defines trust and execution boundaries for the malware catalog and private sample vault.
---

Virus intelligence separates verified metadata from quarantined sample bytes.
The server-computed SHA-256 is authoritative; feed-claimed hashes are untrusted
until verified. Exact hashes, byte fingerprints, and versioned signatures remain
distinct match types.

**Why:** Threat-intelligence ingestion must not turn the SOC control plane into
a malware execution or exfiltration path. Tenant samples are private by default,
and a catalog match is evidence for risk/quarantine decisions, never permission
to execute content.

**How to apply:** Store global catalog metadata in PostgreSQL and sample bytes
only in private object storage. Require authorization and append-only audit for
binary access. Keep downloads and dynamic analysis fail-closed until their
separate authorization and sandbox phases exist. Never send sample bytes to a
shell, LLM, public path, or execution plane.