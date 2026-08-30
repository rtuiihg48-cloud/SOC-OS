---
name: React live-list ownership
description: DOM ownership rule for animated live lists under React 19 and Vite HMR.
---

Keep removal of frequently refreshed list and table nodes under React's direct ownership. Entrance animations are safe, but deferred exit orchestration should not wrap live table rows or feeds that are replaced during refetches and Vite HMR.

**Why:** React 19 and an animation library can race to remove the same stale child after the parent tree has already been replaced, producing a DOM `removeChild` `NotFoundError` with little or no useful stack trace.

**How to apply:** For live `<tbody>` rows and frequently refreshed feeds, animate insertion only and let React synchronously unmount removed items. Use deferred exit animations only where the parent remains stable and the behavior is covered by browser regression tests.