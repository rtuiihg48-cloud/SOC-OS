---
name: Billing authorization boundary
description: Durable rules for paid access and the free security-test allowance.
---

Whop is the source of truth for paid access. A payment is accepted only when live checkout, payment, and membership data match a server-generated correlation plus the authenticated control-plane user and tenant. Local billing rows are correlation state, not authorization.

Paid access is offered as either $29 monthly or $290 annually; both plans unlock the same capabilities, and the annual option is positioned as two months free.

**Why:** Redirect parameters and local “verified” flags can be spoofed or become stale. Tenant membership and execution capabilities are separate security decisions and must never be purchased implicitly.

**How to apply:** Keep the first three accepted security-test runs free per user/tenant, enforce the quota atomically across instances, and require current Whop membership verification after the quota. New test-producing routes must use the same guard, and checkout verification must bind to the selected monthly or annual plan.