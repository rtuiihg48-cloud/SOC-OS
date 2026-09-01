import { Router, type IRouter } from "express";
import { CyberRangeScenario, CYBER_RANGE_SCENARIOS, cyberRangeManager } from "../lib/cyber-range";
import { requireCapability, singleTenantScope } from "../middlewares/principal";

const router: IRouter = Router();

function tenantIdOrThrow(req: Parameters<typeof singleTenantScope>[0]): number {
  const tenantId = singleTenantScope(req);
  if (tenantId === null) throw new Error("cyber range requires a single tenant scope");
  return tenantId;
}

router.get("/cyber-range", requireCapability("dashboard:read", singleTenantScope), (req, res) => {
  res.json(cyberRangeManager.snapshot(tenantIdOrThrow(req)));
});

router.post("/cyber-range/start", requireCapability("testing:run", singleTenantScope), (req, res) => {
  const scenario = req.body?.scenario;
  if (!CYBER_RANGE_SCENARIOS.includes(scenario)) {
    res.status(400).json({ error: "UNSUPPORTED_CYBER_RANGE_SCENARIO", code: "UNSUPPORTED_CYBER_RANGE_SCENARIO" });
    return;
  }
  const snapshot = cyberRangeManager.start(tenantIdOrThrow(req), scenario as CyberRangeScenario);
  req.log.info({ rangeId: snapshot.rangeId, scenario, cubes: snapshot.totalCubes }, "Cyber range fixed-code process run started");
  res.status(202).json(snapshot);
});

router.post("/cyber-range/pause", requireCapability("testing:run", singleTenantScope), (req, res) => {
  const snapshot = cyberRangeManager.pause(tenantIdOrThrow(req));
  req.log.info({ rangeId: snapshot.rangeId }, "Cyber range paused");
  res.json(snapshot);
});

router.post("/cyber-range/reset", requireCapability("testing:run", singleTenantScope), (req, res) => {
  const snapshot = cyberRangeManager.reset(tenantIdOrThrow(req));
  req.log.info({ rangeId: snapshot.rangeId }, "Cyber range reset");
  res.json(snapshot);
});

export default router;