import { Router, type IRouter } from "express";
import healthRouter from "./health";
import eventsRouter from "./events";
import dashboardRouter from "./dashboard";
import tenantsRouter from "./tenants";
import rulesRouter from "./rules";
import correlationsRouter from "./correlations";
import metaCubeRouter from "./meta-cube";
import voiceRouter from "./voice";
import agentObserverRouter from "./agent-observer";
import bootRouter from "./boot";
import quarantineRouter from "./quarantine";
import selfHealingRouter from "./self-healing";
import virusDatabaseRouter from "./virus-database";
import trafficRouter from "./traffic";
import { runSecurityAudit } from "../lib/lockfile-analyzer";
import authRouter from "./auth";
import auditRouter from "./audit";
import billingRouter from "./billing";
import nodeExchangeRouter from "./node-exchange";
import incidentsRouter from "./incidents";
import cyberRangeRouter from "./cyber-range";
import nodeClusterRouter from "./node-cluster";
import { requireCapability, singleTenantScope } from "../middlewares/principal";
import { requireSecurityTestAccess } from "../lib/security-test-access";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(auditRouter);
router.use(billingRouter);
router.use(eventsRouter);
router.use(dashboardRouter);
router.use(tenantsRouter);
router.use(rulesRouter);
router.use(correlationsRouter);
router.use(metaCubeRouter);
router.use(voiceRouter);
router.use(agentObserverRouter);
router.use(bootRouter);
router.use(quarantineRouter);
router.use(selfHealingRouter);
router.use(virusDatabaseRouter);
router.use(trafficRouter);
router.use(nodeExchangeRouter);
router.use(incidentsRouter);
router.use(cyberRangeRouter);
router.use(nodeClusterRouter);
router.post("/scan/lockfile", requireCapability("testing:run", singleTenantScope), async (req, res) => {
  const { apiKey, lockfileContent, packageJsonContent } = req.body;
  if (!apiKey || !lockfileContent || !packageJsonContent) {
    return res.status(400).json({ error: "Відсутні параметри сканування" });
  }
  if (
    typeof lockfileContent !== "string" ||
    typeof packageJsonContent !== "string"
  ) {
    return res.status(400).json({ error: "Некоректний формат файлів" });
  }
  const quota = await requireSecurityTestAccess(req, res, "LOCKFILE_SCAN");
  if (!quota) return;

  try {
    const auditResult = await runSecurityAudit({
      lockfileContent,
      packageJsonContent,
    });
    await quota.complete();
    return res.status(200).json({
      success: true,
      threatLevel: auditResult.threatLevel,
    });
  } catch {
    await quota.release();
    return res.status(500).json({ error: "Помилка сервера при скануванні" });
  }
});

export default router;
