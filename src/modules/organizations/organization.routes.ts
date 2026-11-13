import { Router } from "express";
import * as controller from "./organization.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { validateIdParams } from "../../middleware/validate";
import { authenticate } from "../../middleware/authenticate";
import { requireRole, requirePermission } from "../../middleware/authorize";
import { SystemRole } from "@prisma/client";
import { PERMISSIONS } from "../../config/permissions";
import { requireSameOrganizationParam } from "../../utils/tenant";

const router = validateIdParams(Router());

router.use(authenticate);

router.get("/", requireRole(SystemRole.SUPER_ADMIN), asyncHandler(controller.list));
router.post("/", requireRole(SystemRole.SUPER_ADMIN), asyncHandler(controller.create));

// Every /:id route below only targets the caller's own organization,
// except for SUPER_ADMIN.
router.use("/:id", requireSameOrganizationParam("id"));
router.get("/:id", asyncHandler(controller.getOne));
router.get("/:id/stats", asyncHandler(controller.stats));
router.patch(
  "/:id",
  requirePermission(PERMISSIONS.ORGANIZATION_MANAGE),
  asyncHandler(controller.update)
);
router.put(
  "/:id/settings",
  requirePermission(PERMISSIONS.ORGANIZATION_MANAGE),
  asyncHandler(controller.updateSettings)
);
router.put(
  "/:id/subscription",
  // Billing is managed by the platform, not by the tenant itself.
  requireRole(SystemRole.SUPER_ADMIN),
  asyncHandler(controller.updateSubscription)
);
router.get("/:id/admins", requirePermission(PERMISSIONS.USER_MANAGE), asyncHandler(controller.listAdmins));
router.post(
  "/:id/admins",
  requirePermission(PERMISSIONS.USER_MANAGE),
  asyncHandler(controller.addAdmin)
);

export default router;
