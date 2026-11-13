import { type Request, type Response } from "express";
import * as service from "./payroll.service";
import { parseBody, parseQuery } from "../../middleware/validate";
import { adjustmentSchema, createPeriodSchema, generateRecordsSchema, listPayrollQuery } from "./payroll.validation";
import { sendSuccess, sendCreated, sendPaginated } from "../../utils/response";
import { requireAuthContext, requireOrgId } from "../../utils/tenant";

export async function listPeriods(req: Request, res: Response): Promise<void> {
  const { items, meta } = await service.listPeriods(requireOrgId(req), parseQuery(req, listPayrollQuery));
  sendPaginated(res, items, meta);
}

export async function createPeriod(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, createPeriodSchema);
  const auth = requireAuthContext(req);
  sendCreated(res, await service.createPeriod(auth.organizationId, body, auth.userId));
}

export async function generateRecords(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, generateRecordsSchema);
  const auth = requireAuthContext(req);
  sendSuccess(
    res,
    await service.generateRecords(auth.organizationId, req.params.periodId, body?.employeeIds, auth.userId)
  );
}

export async function listRecords(req: Request, res: Response): Promise<void> {
  const { items, meta } = await service.listRecords(
    requireOrgId(req),
    req.params.periodId,
    parseQuery(req, listPayrollQuery)
  );
  sendPaginated(res, items, meta);
}

export async function getRecord(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getRecord(requireOrgId(req), req.params.recordId));
}

export async function addBonus(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, adjustmentSchema);
  sendCreated(res, await service.addBonus(requireOrgId(req), req.params.recordId, body));
}

export async function addDeduction(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, adjustmentSchema);
  sendCreated(res, await service.addDeduction(requireOrgId(req), req.params.recordId, body));
}

export async function submit(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  sendSuccess(res, await service.submitForApproval(auth.organizationId, req.params.periodId, auth.userId));
}

export async function approve(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  sendSuccess(res, await service.approvePeriod(auth.organizationId, req.params.periodId, auth.userId));
}

export async function markPaid(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  sendSuccess(res, await service.markPaid(auth.organizationId, req.params.periodId, auth.userId));
}

export async function report(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.payrollReport(requireOrgId(req), req.params.periodId));
}
