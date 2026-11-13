import { Router, Request, Response } from "express";
import * as service from "./report.service";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/authorize";
import { PERMISSIONS } from "../../config/permissions";
import { sendSuccess } from "../../utils/response";
import { ApiError } from "../../utils/apiError";
import { enqueueReport } from "../../queues";
import { requireOrgId } from "../../utils/tenant";

const orgId = requireOrgId;

const router = Router();

router.use(authenticate);
router.use(requirePermission(PERMISSIONS.REPORT_VIEW));

router.get("/employees", asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await service.employeeStatistics(orgId(req)));
}));

router.get("/departments", asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await service.departmentStatistics(orgId(req)));
}));

router.get("/salary-summary", requirePermission(PERMISSIONS.SALARY_VIEW), asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await service.salarySummary(orgId(req)));
}));

router.get("/leave", asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await service.leaveStatistics(orgId(req)));
}));

router.get("/turnover", asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await service.turnover(orgId(req)));
}));

router.get("/dashboard", asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await service.dashboard(orgId(req)));
}));

router.post("/export", asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) throw ApiError.unauthorized();
  await enqueueReport({
    organizationId: req.auth.organizationId,
    reportType: String(req.body?.reportType ?? "dashboard"),
    requestedBy: req.auth.userId,
    params: (req.body?.params as Record<string, unknown>) ?? {},
  });
  sendSuccess(res, { queued: true });
}));

export default router;
