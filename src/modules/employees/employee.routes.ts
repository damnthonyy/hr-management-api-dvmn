import { Router } from "express";
import * as controller from "./employee.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate } from "../../middleware/validate";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission, requireAnyPermission } from "../../middleware/authorize";
import { PERMISSIONS } from "../../config/permissions";
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  emergencyContactSchema,
  contractSchema,
  salaryUpdateSchema,
} from "./employee.validation";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission(PERMISSIONS.EMPLOYEE_VIEW), asyncHandler(controller.list));
router.post("/", requirePermission(PERMISSIONS.EMPLOYEE_CREATE), validate(createEmployeeSchema), asyncHandler(controller.create));
router.get("/:id", requirePermission(PERMISSIONS.EMPLOYEE_VIEW), asyncHandler(controller.getOne));
router.patch("/:id", requirePermission(PERMISSIONS.EMPLOYEE_UPDATE), validate(updateEmployeeSchema), asyncHandler(controller.update));
router.post("/:id/deactivate", requirePermission(PERMISSIONS.EMPLOYEE_UPDATE), asyncHandler(controller.deactivate));
router.delete("/:id", requirePermission(PERMISSIONS.EMPLOYEE_DELETE), asyncHandler(controller.remove));

router.get("/:id/emergency-contacts", requirePermission(PERMISSIONS.EMPLOYEE_VIEW), asyncHandler(controller.listEmergencyContacts));
router.post("/:id/emergency-contacts", requirePermission(PERMISSIONS.EMPLOYEE_UPDATE), validate(emergencyContactSchema), asyncHandler(controller.addEmergencyContact));

router.get("/:id/contracts", requireAnyPermission(PERMISSIONS.CONTRACT_VIEW, PERMISSIONS.EMPLOYEE_VIEW), asyncHandler(controller.listContracts));
router.post("/:id/contracts", requirePermission(PERMISSIONS.EMPLOYEE_UPDATE), validate(contractSchema), asyncHandler(controller.addContract));

router.get("/:id/salary-history", requirePermission(PERMISSIONS.SALARY_VIEW), asyncHandler(controller.salaryHistory));
router.post("/:id/salary", requirePermission(PERMISSIONS.SALARY_MANAGE), validate(salaryUpdateSchema), asyncHandler(controller.updateSalary));
router.get("/:id/reports", requirePermission(PERMISSIONS.EMPLOYEE_VIEW), asyncHandler(controller.reports));

export default router;
