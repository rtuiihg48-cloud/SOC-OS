import { Router, type IRouter } from "express";
import { getHckBiosStatus } from "../lib/hck-bios";

const router: IRouter = Router();

router.get("/boot/status", (_req, res) => {
  const status = getHckBiosStatus();
  res.status(status.status === "failed" ? 503 : 200).json(status);
});

export default router;