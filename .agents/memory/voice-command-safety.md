---
name: Voice command safety
description: Defines how spoken SOC requests become auditable, allowlisted system actions.
---

Voice input is untrusted text. It may select only deterministic, typed SOC
intents and criteria. The system must preview the parsed plan and require
explicit confirmation before execution.

**Why:** Speech transcription is probabilistic and may be ambiguous or
adversarial. Treating a transcript as code, shell input, or an unrestricted
agent prompt would create an unsafe execution plane.

**How to apply:** Re-parse and validate the transcript on the server at
execution time. Virus tests read metadata and indicators only. Synthetic
defense uses harmless text scenarios and does not write them into the live
event stream. Keep binary, shell, network, host, VM, and META-CUBE execution
disabled, and append an audit record for every completed command.