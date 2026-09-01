---
name: Cyber range process boundary
description: Safety and reliability claims permitted for the lightweight logical-cube cyber range.
---

The lightweight cyber range is a trusted fixed-code process lab with bounded per-instance admission. Arbitrary user code, shell input, and payload execution remain disabled. Its state and worker ownership are instance-local and volatile; it is not a VM, container sandbox, or multi-instance coordinator.

**Why:** A child process shares the service account's OS capabilities even when its code and environment are tightly controlled. Accurate labels prevent logical isolation from being mistaken for a security sandbox, and prevent local lifecycle control from being mistaken for durable distributed ownership.

**How to apply:** Keep scenarios allowlisted and deterministic, track children by process identity, enforce a manager-wide worker cap, and describe the boundary explicitly. Require the separate sandbox and multi-instance phases before accepting untrusted workloads or claiming distributed lifecycle guarantees.