import { db } from "@lockdoctor/db";
import { vulnerabilities, scanResults } from "@lockdoctor/db/schema";
import { parseLockfile } from "./parser/lockfile";
import { parsePackageJson } from "./parser/packageJson";
import { buildGraph } from "./graph/builder";
import { detectNativeBinaries } from "./detectors/nativeBinary";
import { detectDuplicates } from "./detectors/duplicateVersions";
import { formatLogMessage } from "./explain/formatter";

export interface ScanOptions {
  lockfilePath: string;
  packageJsonPath: string;
  tenantId: number;
}

export async function runSecurityAudit(options: ScanOptions) {
  const { lockfilePath, packageJsonPath, tenantId } = options;

  console.log(`[Analyzer] Запуск реального аудиту безпеки для Орендаря №${tenantId}...`);

  const lockfileData = await parseLockfile(lockfilePath);
  const packageJsonData = await parsePackageJson(packageJsonPath);
  const dependencyGraph = buildGraph(lockfileData, packageJsonData);

  const nativeBinaries = await detectNativeBinaries(dependencyGraph);
  const duplicateVersions = await detectDuplicates(dependencyGraph);
  const allFindings = [...nativeBinaries, ...duplicateVersions];
  
  const calculatedThreatLevel = Math.min(allFindings.length * 12, 100);

  const [insertedScan] = await db.insert(scanResults).values({
    tenantId,
    threatLevel: calculatedThreatLevel,
    totalIssues: allFindings.length,
    status: allFindings.length > 0 ? "КРИТИЧНО" : "БЕЗПЕЧНО",
    createdAt: new Date()
  }).returning();

  for (const issue of allFindings) {
    const humanReadableText = formatLogMessage(issue);
    await db.insert(vulnerabilities).values({
      scanId: insertedScan.id,
      tenantId,
      type: issue.type,
      severity: issue.score > 20 ? "HIGH" : "WARN",
      score: issue.score,
      description: humanReadableText,
      status: "OPEN"
    });
  }

  console.log(`[Analyzer] Знайдено реальних загроз: ${allFindings.length}. Ризик: ${calculatedThreatLevel}%`);
  
  return {
    scanId: insertedScan.id,
    threatLevel: calculatedThreatLevel,
    issuesCount: allFindings.length
  };
}
