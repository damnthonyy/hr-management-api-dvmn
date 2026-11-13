import { Router } from "express";
import * as controller from "./role.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate, validateIdParams } from "../../middleware/validate";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/authorize";
import { PERMISSIONS } from "../../config/permissions";
import {
  createRoleSchema,
  updateRoleSchema,
  assignRoleSchema,
  setSystemRoleSchema,
} from "./role.validation";

const router = validateIdParams(Router());

router.use(authenticate);

router.get("/permissions", asyncHandler(controller.listPermissions));
router.get("/", requirePermission(PERMISSIONS.ROLE_MANAGE), asyncHandler(controller.listRoles));
router.post("/", requirePermission(PERMISSIONS.ROLE_MANAGE), validate(createRoleSchema), asyncHandler(controller.createRole));
router.patch("/:id", requirePermission(PERMISSIONS.ROLE_MANAGE), validate(updateRoleSchema), asyncHandler(controller.updateRole));
router.delete("/:id", requirePermission(PERMISSIONS.ROLE_MANAGE), asyncHandler(controller.deleteRole));

router.post("/assignments", requirePermission(PERMISSIONS.ROLE_MANAGE), validate(assignRoleSchema), asyncHandler(controller.assignRole));
router.delete("/assignments/:assignmentId", requirePermission(PERMISSIONS.ROLE_MANAGE), asyncHandler(controller.revokeAssignment));
router.put("/users/:userId/system-role", requirePermission(PERMISSIONS.ROLE_MANAGE), validate(setSystemRoleSchema), asyncHandler(controller.setSystemRole));

export default router;
