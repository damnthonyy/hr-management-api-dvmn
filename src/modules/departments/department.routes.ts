import { Router } from "express";
import * as controller from "./department.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate, validateIdParams } from "../../middleware/validate";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/authorize";
import { PERMISSIONS } from "../../config/permissions";
import {
  createDepartmentSchema,
  updateDepartmentSchema,
  assignManagerSchema,
  assignEmployeeSchema,
  transferEmployeeSchema,
  createTeamSchema,
  updateTeamSchema,
  teamMemberSchema,
} from "./department.validation";

const router = validateIdParams(Router());

router.use(authenticate);

router.get("/teams", requirePermission(PERMISSIONS.DEPARTMENT_VIEW), asyncHandler(controller.listTeams));
router.post("/teams", requirePermission(PERMISSIONS.DEPARTMENT_MANAGE), validate(createTeamSchema), asyncHandler(controller.createTeam));
router.patch("/teams/:teamId", requirePermission(PERMISSIONS.DEPARTMENT_MANAGE), validate(updateTeamSchema), asyncHandler(controller.updateTeam));
router.delete("/teams/:teamId", requirePermission(PERMISSIONS.DEPARTMENT_MANAGE), asyncHandler(controller.removeTeam));
router.post("/teams/:teamId/members", requirePermission(PERMISSIONS.DEPARTMENT_MANAGE), validate(teamMemberSchema), asyncHandler(controller.addTeamMember));
router.delete("/teams/members/:employeeId", requirePermission(PERMISSIONS.DEPARTMENT_MANAGE), asyncHandler(controller.removeTeamMember));

router.get("/", requirePermission(PERMISSIONS.DEPARTMENT_VIEW), asyncHandler(controller.list));
router.post("/", requirePermission(PERMISSIONS.DEPARTMENT_MANAGE), validate(createDepartmentSchema), asyncHandler(controller.create));
router.post("/transfer", requirePermission(PERMISSIONS.DEPARTMENT_MANAGE), validate(transferEmployeeSchema), asyncHandler(controller.transferEmployee));
router.get("/:id", requirePermission(PERMISSIONS.DEPARTMENT_VIEW), asyncHandler(controller.getOne));
router.patch("/:id", requirePermission(PERMISSIONS.DEPARTMENT_MANAGE), validate(updateDepartmentSchema), asyncHandler(controller.update));
router.delete("/:id", requirePermission(PERMISSIONS.DEPARTMENT_MANAGE), asyncHandler(controller.remove));
router.put("/:id/manager", requirePermission(PERMISSIONS.DEPARTMENT_MANAGE), validate(assignManagerSchema), asyncHandler(controller.assignManager));
router.post("/:id/employees", requirePermission(PERMISSIONS.DEPARTMENT_MANAGE), validate(assignEmployeeSchema), asyncHandler(controller.assignEmployee));

export default router;
