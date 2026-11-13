import { Router } from "express";
import * as controller from "./organization.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate } from "../../middleware/validate";
import { authenticate } from "../../middleware/authenticate";
import { requireRole, requirePermission } from "../../middleware/authorize";
import { SystemRole } from "@prisma/client";
import { PERMISSIONS } from "../../config/permissions";
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  updateSettingsSchema,
  updateSubscriptionSchema,
  addAdminSchema,
} from "./organization.validation";

const router = Router();

router.use(authenticate);

router.get("/", requireRole(SystemRole.SUPER_ADMIN), asyncHandler(controller.list));
router.post("/", requireRole(SystemRole.SUPER_ADMIN), validate(createOrganizationSchema), asyncHandler(controller.create));
router.get("/:id", asyncHandler(controller.getOne));
router.get("/:id/stats", asyncHandler(controller.stats));
router.patch(
  "/:id",
  requirePermission(PERMISSIONS.ORGANIZATION_MANAGE),
  validate(updateOrganizationSchema),
  asyncHandler(controller.update)
);
router.put(
  "/:id/settings",
  requirePermission(PERMISSIONS.ORGANIZATION_MANAGE),
  validate(updateSettingsSchema),
  asyncHandler(controller.updateSettings)
);
router.put(
  "/:id/subscription",
  requireRole(SystemRole.SUPER_ADMIN, SystemRole.ORGANIZATION_ADMIN),
  validate(updateSubscriptionSchema),
  asyncHandler(controller.updateSubscription)
);
router.get("/:id/admins", requirePermission(PERMISSIONS.USER_MANAGE), asyncHandler(controller.listAdmins));
router.post(
  "/:id/admins",
  requirePermission(PERMISSIONS.USER_MANAGE),
  validate(addAdminSchema),
  asyncHandler(controller.addAdmin)
);

export default router;
