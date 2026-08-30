import { Router, type IRouter } from "express";
import healthRouter from "./health";
import eventsRouter from "./events";
import dashboardRouter from "./dashboard";
import tenantsRouter from "./tenants";
import rulesRouter from "./rules";
import correlationsRouter from "./correlations";
import { runSecurityAudit } from "@lockdoctor/analyzer";

const router: IRouter = Router();

router.use(healthRouter);
router.use(eventsRouter);
router.use(dashboardRouter);
router.use(tenantsRouter);
router.use(rulesRouter);
router.use(correlationsRouter);
router.post("/scan/lockfile", async (req, res) => {
  try {
    const { apiKey, lockfileContent, packageJsonContent } = req.body;
    if (!apiKey || !lockfileContent || !packageJsonContent) {
      return res.status(400).json({ error: "Відсутні параметри сканування" });
    }

    const auditResult = await runSecurityAudit({
      lockfilePath: lockfileContent,
      packageJsonPath: packageJsonContent,
      tenantId: 1
    });

    return res.status(200).json({ success: true, threatLevel: auditResult.threatLevel });
  } catch (error) {
    return res.status(500).json({ error: "Помилка сервера при скануванні" });
  }
});

export default router;
