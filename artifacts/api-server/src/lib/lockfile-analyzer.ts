import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type AuditCounts = Partial<
  Record<"critical" | "high" | "moderate" | "low" | "info", number>
>;

export type ThreatLevel = "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "NONE";

function getThreatLevel(counts: AuditCounts): ThreatLevel {
  if ((counts.critical ?? 0) > 0) return "CRITICAL";
  if ((counts.high ?? 0) > 0) return "HIGH";
  if ((counts.moderate ?? 0) > 0) return "MODERATE";
  if ((counts.low ?? 0) > 0 || (counts.info ?? 0) > 0) return "LOW";
  return "NONE";
}

function parseAuditOutput(output: string): AuditCounts {
  const parsed = JSON.parse(output) as {
    metadata?: { vulnerabilities?: AuditCounts };
    advisories?: Record<string, { severity?: keyof AuditCounts }>;
  };

  if (parsed.metadata?.vulnerabilities) {
    return parsed.metadata.vulnerabilities;
  }

  const counts: AuditCounts = {};
  for (const advisory of Object.values(parsed.advisories ?? {})) {
    if (advisory.severity) {
      counts[advisory.severity] = (counts[advisory.severity] ?? 0) + 1;
    }
  }
  return counts;
}

export async function runSecurityAudit(input: {
  lockfileContent: string;
  packageJsonContent: string;
}): Promise<{ threatLevel: ThreatLevel }> {
  JSON.parse(input.packageJsonContent);

  const directory = await mkdtemp(join(tmpdir(), "lockfile-audit-"));
  const isPnpm = input.lockfileContent.trimStart().startsWith("lockfileVersion:");
  const lockfileName = isPnpm ? "pnpm-lock.yaml" : "package-lock.json";
  const command = isPnpm ? "pnpm" : "npm";
  const args = isPnpm
    ? ["audit", "--json", "--dir", directory]
    : ["audit", "--json", "--prefix", directory];

  try {
    await Promise.all([
      writeFile(join(directory, "package.json"), input.packageJsonContent),
      writeFile(join(directory, lockfileName), input.lockfileContent),
    ]);

    let output = "";
    try {
      const result = await execFileAsync(command, args, {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      output = result.stdout;
    } catch (error) {
      const auditError = error as Error & { stdout?: string };
      if (!auditError.stdout) throw error;
      output = auditError.stdout;
    }

    return { threatLevel: getThreatLevel(parseAuditOutput(output)) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}