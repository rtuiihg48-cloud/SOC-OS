import { Router, type IRouter } from "express";
import { getHckBiosStatus } from "../lib/hck-bios";
import { requireCapability, singleTenantScope } from "../middlewares/principal";

const router: IRouter = Router();

router.get("/boot/status", requireCapability("agent:observe", singleTenantScope), (_req, res) => {
  const status = getHckBiosStatus();
  res.status(status.status === "failed" ? 503 : 200).json(status);
});

export default router;