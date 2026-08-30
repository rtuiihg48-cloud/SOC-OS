---
name: GitHub connector and local Git
description: Replit GitHub OAuth connections authenticate connector API calls, not the local git credential helper.
---

The Replit GitHub connector can read and write repository data through its authenticated proxy, but a normal local `git fetch` or `git push` over HTTPS does not automatically receive that OAuth credential.

**Why:** Treating the connector as a local Git credential caused a fetch failure even though the GitHub connection was healthy.

**How to apply:** Keep `origin` configured for repository identity, use the connector API for deliberate remote operations, and never ask the user to paste a GitHub token into chat.