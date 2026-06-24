import { Router, type IRouter } from "express";
import healthRouter from "./health";
import eventsRouter from "./events";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(eventsRouter);
router.use(dashboardRouter);

export default router;
