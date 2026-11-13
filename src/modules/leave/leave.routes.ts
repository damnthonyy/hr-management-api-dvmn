import { Router } from "express";
import * as controller from "./leave.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate, validateIdParams } from "../../middleware/validate";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/authorize";
import { PERMISSIONS } from "../../config/permissions";
import {
  createLeaveTypeSchema,
  createLeaveRequestSchema,
  decisionSchema,
  setBalanceSchema,
} from "./leave.validation";

const router = validateIdParams(Router());

router.use(authenticate);

router.get("/types", asyncHandler(controller.listTypes));
router.post("/types", requirePermission(PERMISSIONS.LEAVE_MANAGE), validate(createLeaveTypeSchema), asyncHandler(controller.createType));

router.get("/requests", requirePermission(PERMISSIONS.LEAVE_VIEW), asyncHandler(controller.listRequests));
router.post("/requests", validate(createLeaveRequestSchema), asyncHandler(controller.createRequest));
router.post("/requests/:id/approve", requirePermission(PERMISSIONS.LEAVE_APPROVE), validate(decisionSchema), asyncHandler(controller.approve));
router.post("/requests/:id/reject", requirePermission(PERMISSIONS.LEAVE_APPROVE), validate(decisionSchema), asyncHandler(controller.reject));
router.post("/requests/:id/cancel", asyncHandler(controller.cancel));

router.put("/balances", requirePermission(PERMISSIONS.LEAVE_MANAGE), validate(setBalanceSchema), asyncHandler(controller.setBalance));
router.get("/balances/:employeeId", requirePermission(PERMISSIONS.LEAVE_VIEW), asyncHandler(controller.listBalances));
router.get("/history/:employeeId", requirePermission(PERMISSIONS.LEAVE_VIEW), asyncHandler(controller.history));
router.get("/calendar/:departmentId", requirePermission(PERMISSIONS.LEAVE_VIEW), asyncHandler(controller.calendar));

export default router;
