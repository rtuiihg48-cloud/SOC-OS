---
name: Voice audio format boundary
description: Defines the fail-closed boundary for browser and uploaded voice audio containers.
---

Client-declared MIME types may route diagnostics but must never authorize an
unknown byte container. Every accepted container needs byte-level
identification and a format-specific completeness check before transcription.

**Why:** ffmpeg can exit successfully at EOF after decoding a usable prefix of
a truncated WebM, OGG, MP3, or MP4 file. A successful decode alone therefore
does not prove that the uploaded container is complete, and MIME values are
fully client-controlled.

**How to apply:** Keep the accepted container set explicit, validate structural
lengths/end markers or frame boundaries before invoking ffmpeg, then retain
strict decode, timeout, and temporary-file cleanup as a second validation
layer. Test trailing truncation for every accepted format and test a decodable
but unallowlisted container with an allowlisted MIME hint.