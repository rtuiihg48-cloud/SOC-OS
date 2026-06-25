import { Router, type IRouter } from "express";
import healthRouter from "./health";
import eventsRouter from "./events";
import dashboardRouter from "./dashboard";
import tenantsRouter from "./tenants";
import rulesRouter from "./rules";
import correlationsRouter from "./correlations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(eventsRouter);
router.use(dashboardRouter);
router.use(tenantsRouter);
router.use(rulesRouter);
router.use(correlationsRouter);

export default router;
