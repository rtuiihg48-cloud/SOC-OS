import { Router } from "express";
import { requireCapability } from "../middlewares/principal";
import { GetCurrentPrincipalResponse } from "@workspace/api-zod";

const router = Router();
router.get("/auth/me", (req, res) => {
  if (!req.principal) { res.status(401).json({ error: "AUTHENTICATION_REQUIRED", code: "AUTHENTICATION_REQUIRED" }); return; }
  res.json(GetCurrentPrincipalResponse.parse({ principalId: req.principal.principalId, principalType: req.principal.principalType, tenantIds: req.principal.tenantIds, roles: req.principal.roles, capabilities: req.principal.capabilities, authMethod: req.principal.authMethod, credentialVersion: req.principal.credentialVersion }));
});
export default router;