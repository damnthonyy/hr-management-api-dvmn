import { z } from "zod";
import { parseBody, validateIdParams } from "../../middleware/validate";
import { Router, type Request, type Response } from "express";
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

const router = validateIdParams(Router());

router.use(authenticate);
router.use(requirePermission(PERMISSIONS.REPORT_VIEW));

router.get(
  "/employees",
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await service.employeeStatistics(orgId(req)));
  })
);

router.get(
  "/departments",
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await service.departmentStatistics(orgId(req)));
  })
);

router.get(
  "/salary-summary",
  requirePermission(PERMISSIONS.SALARY_VIEW),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await service.salarySummary(orgId(req)));
  })
);

router.get(
  "/leave",
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await service.leaveStatistics(orgId(req)));
  })
);

router.get(
  "/turnover",
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await service.turnover(orgId(req)));
  })
);

router.get(
  "/dashboard",
  asyncHandler(async (req: Request, res: Response) => {
    const includeSalary = Boolean(req.auth?.permissions.includes(PERMISSIONS.SALARY_VIEW));
    sendSuccess(res, await service.dashboard(orgId(req), includeSalary));
  })
);

const exportSchema = z.object({
  reportType: z.enum(["dashboard", "salary-summary", "turnover", "leave"]).default("dashboard"),
  params: z.record(z.string(), z.unknown()).default({}),
});

router.post(
  "/export",
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw ApiError.unauthorized();
    const body = parseBody(req, exportSchema);
    const includeSalary = req.auth.permissions.includes(PERMISSIONS.SALARY_VIEW);
    if (body.reportType === "salary-summary" && !includeSalary) {
      throw ApiError.forbidden("The salary report requires the salary:view permission");
    }
    await enqueueReport({
      organizationId: req.auth.organizationId,
      reportType: body.reportType,
      requestedBy: req.auth.userId,
      includeSalary,
      params: body.params,
    });
    sendSuccess(res, { queued: true });
  })
);

export default router;
