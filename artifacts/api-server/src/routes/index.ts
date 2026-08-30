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

const router: IRouter = Router();

router.use(healthRouter);
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
router.post("/scan/lockfile", async (req, res) => {
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

  try {
    const auditResult = await runSecurityAudit({
      lockfileContent,
      packageJsonContent,
    });
    return res.status(200).json({
      success: true,
      threatLevel: auditResult.threatLevel,
    });
  } catch {
    return res.status(500).json({ error: "Помилка сервера при скануванні" });
  }
});

export default router;
