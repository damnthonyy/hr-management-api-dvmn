import { Router } from "express";
import * as controller from "./payroll.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate, validateIdParams } from "../../middleware/validate";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/authorize";
import { PERMISSIONS } from "../../config/permissions";
import {
  createPeriodSchema,
  generateRecordsSchema,
  adjustmentSchema,
} from "./payroll.validation";

const router = validateIdParams(Router());

router.use(authenticate);

router.get("/periods", requirePermission(PERMISSIONS.PAYROLL_VIEW), asyncHandler(controller.listPeriods));
router.post("/periods", requirePermission(PERMISSIONS.PAYROLL_MANAGE), validate(createPeriodSchema), asyncHandler(controller.createPeriod));
router.post("/periods/:periodId/generate", requirePermission(PERMISSIONS.PAYROLL_MANAGE), validate(generateRecordsSchema), asyncHandler(controller.generateRecords));
router.get("/periods/:periodId/records", requirePermission(PERMISSIONS.PAYROLL_VIEW), asyncHandler(controller.listRecords));
router.get("/periods/:periodId/report", requirePermission(PERMISSIONS.PAYROLL_VIEW), asyncHandler(controller.report));
router.post("/periods/:periodId/submit", requirePermission(PERMISSIONS.PAYROLL_MANAGE), asyncHandler(controller.submit));
router.post("/periods/:periodId/approve", requirePermission(PERMISSIONS.PAYROLL_MANAGE), asyncHandler(controller.approve));
router.post("/periods/:periodId/pay", requirePermission(PERMISSIONS.PAYROLL_MANAGE), asyncHandler(controller.markPaid));

router.get("/records/:recordId", requirePermission(PERMISSIONS.PAYROLL_VIEW), asyncHandler(controller.getRecord));
router.post("/records/:recordId/bonuses", requirePermission(PERMISSIONS.PAYROLL_MANAGE), validate(adjustmentSchema), asyncHandler(controller.addBonus));
router.post("/records/:recordId/deductions", requirePermission(PERMISSIONS.PAYROLL_MANAGE), validate(adjustmentSchema), asyncHandler(controller.addDeduction));

export default router;
