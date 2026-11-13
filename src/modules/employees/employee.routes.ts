import { Router } from "express";
import * as controller from "./employee.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { validateIdParams } from "../../middleware/validate";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission, requireAnyPermission } from "../../middleware/authorize";
import { PERMISSIONS } from "../../config/permissions";

const router = validateIdParams(Router());

router.use(authenticate);

router.get("/", requirePermission(PERMISSIONS.EMPLOYEE_VIEW), asyncHandler(controller.list));
router.post("/", requirePermission(PERMISSIONS.EMPLOYEE_CREATE), asyncHandler(controller.create));
router.get("/:id", requirePermission(PERMISSIONS.EMPLOYEE_VIEW), asyncHandler(controller.getOne));
router.patch("/:id", requirePermission(PERMISSIONS.EMPLOYEE_UPDATE), asyncHandler(controller.update));
router.post("/:id/deactivate", requirePermission(PERMISSIONS.EMPLOYEE_UPDATE), asyncHandler(controller.deactivate));
router.delete("/:id", requirePermission(PERMISSIONS.EMPLOYEE_DELETE), asyncHandler(controller.remove));

router.get(
  "/:id/emergency-contacts",
  requirePermission(PERMISSIONS.EMPLOYEE_VIEW),
  asyncHandler(controller.listEmergencyContacts)
);
router.post(
  "/:id/emergency-contacts",
  requirePermission(PERMISSIONS.EMPLOYEE_UPDATE),
  asyncHandler(controller.addEmergencyContact)
);

router.get(
  "/:id/contracts",
  requireAnyPermission(PERMISSIONS.CONTRACT_VIEW, PERMISSIONS.EMPLOYEE_VIEW),
  asyncHandler(controller.listContracts)
);
router.post("/:id/contracts", requirePermission(PERMISSIONS.EMPLOYEE_UPDATE), asyncHandler(controller.addContract));

router.get("/:id/salary-history", requirePermission(PERMISSIONS.SALARY_VIEW), asyncHandler(controller.salaryHistory));
router.post("/:id/salary", requirePermission(PERMISSIONS.SALARY_MANAGE), asyncHandler(controller.updateSalary));
router.get("/:id/reports", requirePermission(PERMISSIONS.EMPLOYEE_VIEW), asyncHandler(controller.reports));

export default router;
