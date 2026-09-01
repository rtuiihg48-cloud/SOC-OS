import { and, count, eq, inArray, lt, sql } from "drizzle-orm";
import { db, securityTestUsageTable } from "@workspace/db";

export const DEFAULT_FREE_SECURITY_TEST_LIMIT = 3;
const RESERVATION_TTL_MS = 15 * 60 * 1000;

export type SecurityTestType =
  | "SELF_TEST"
  | "SIMULATION"
  | "LOCKFILE_SCAN"
  | "VOICE_VIRUS_TEST"
  | "VOICE_DEFENSE_TEST";

export type QuotaDecision =
  | { allowed: true; paidAccess: true; freeUsed: number; freeRemaining: number }
  | { allowed: true; paidAccess: false; freeUsed: number; freeRemaining: number }
  | { allowed: false; paidAccess: false; freeUsed: number; freeRemaining: 0 };

export function freeSecurityTestLimit(value = process.env.FREE_SECURITY_TEST_LIMIT): number {
  if (value === undefined || value === "") return DEFAULT_FREE_SECURITY_TEST_LIMIT;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("FREE_SECURITY_TEST_LIMIT must be a non-negative integer");
  }
  return parsed;
}

/** Pure so billing and route tests share exactly the same decision semantics. */
export function decideSecurityTestQuota(
  paidAccess: boolean,
  acceptedFreeTests: number,
  freeLimit = freeSecurityTestLimit(),
): QuotaDecision {
  const freeUsed = Math.min(Math.max(acceptedFreeTests, 0), freeLimit);
  const freeRemaining = Math.max(freeLimit - freeUsed, 0);
  if (paidAccess) return { allowed: true, paidAccess: true, freeUsed, freeRemaining };
  if (freeRemaining > 0) return { allowed: true, paidAccess: false, freeUsed, freeRemaining };
  return { allowed: false, paidAccess: false, freeUsed, freeRemaining: 0 };
}

export type QuotaReservation = {
  decision: QuotaDecision;
  usageId?: number;
};

/**
 * Atomically reserves one free test for this user/tenant. `paidAccess` must
 * come from a server-side Whop verification in the current request; a local
 * checkout record is deliberately not accepted as proof of access.
 */
export async function reserveSecurityTestQuota(input: {
  userId: number;
  tenantId: number;
  testType: SecurityTestType;
  paidAccess: boolean;
  freeLimit?: number;
}): Promise<QuotaReservation> {
  const freeLimit = input.freeLimit ?? freeSecurityTestLimit();

  return db.transaction(async (tx) => {
    // Transaction-scoped lock serializes only this principal/tenant pair and
    // automatically releases on commit/rollback, including process errors.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${input.userId}, ${input.tenantId})`);

    const staleBefore = new Date(Date.now() - RESERVATION_TTL_MS);
    await tx.update(securityTestUsageTable)
      .set({ status: "RELEASED", releasedAt: new Date() })
      .where(and(
        eq(securityTestUsageTable.userId, input.userId),
        eq(securityTestUsageTable.tenantId, input.tenantId),
        eq(securityTestUsageTable.status, "RESERVED"),
        lt(securityTestUsageTable.startedAt, staleBefore),
      ));

    const [usage] = await tx.select({ accepted: count() })
      .from(securityTestUsageTable)
      .where(and(
        eq(securityTestUsageTable.userId, input.userId),
        eq(securityTestUsageTable.tenantId, input.tenantId),
        inArray(securityTestUsageTable.status, ["RESERVED", "COMPLETED"]),
      ));
    const decision = decideSecurityTestQuota(input.paidAccess, usage?.accepted ?? 0, freeLimit);
    if (!decision.allowed || input.paidAccess) return { decision };

    const [reservation] = await tx.insert(securityTestUsageTable).values({
      userId: input.userId,
      tenantId: input.tenantId,
      testType: input.testType,
      status: "RESERVED",
    }).returning({ id: securityTestUsageTable.id });
    return { decision, usageId: reservation!.id };
  });
}

export async function completeSecurityTestQuotaReservation(usageId: number): Promise<void> {
  await db.update(securityTestUsageTable)
    .set({ status: "COMPLETED", completedAt: new Date() })
    .where(and(eq(securityTestUsageTable.id, usageId), eq(securityTestUsageTable.status, "RESERVED")));
}

export async function releaseSecurityTestQuotaReservation(usageId: number): Promise<void> {
  await db.update(securityTestUsageTable)
    .set({ status: "RELEASED", releasedAt: new Date() })
    .where(and(eq(securityTestUsageTable.id, usageId), eq(securityTestUsageTable.status, "RESERVED")));
}