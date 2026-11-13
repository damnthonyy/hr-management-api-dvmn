import { Request, Response } from "express";
import * as service from "./payroll.service";
import { sendSuccess, sendCreated, sendPaginated } from "../../utils/response";
import { ApiError } from "../../utils/apiError";

function orgId(req: Request): string {
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth.organizationId;
}

export async function listPeriods(req: Request, res: Response): Promise<void> {
  const { items, meta } = await service.listPeriods(orgId(req), req.query as Record<string, unknown>);
  sendPaginated(res, items, meta);
}

export async function createPeriod(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  sendCreated(res, await service.createPeriod(orgId(req), req.body, req.auth.userId));
}

export async function generateRecords(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  sendSuccess(res, await service.generateRecords(req.params.periodId, req.body?.employeeIds, req.auth.userId));
}

export async function listRecords(req: Request, res: Response): Promise<void> {
  const { items, meta } = await service.listRecords(req.params.periodId, req.query as Record<string, unknown>);
  sendPaginated(res, items, meta);
}

export async function getRecord(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getRecord(req.params.recordId));
}

export async function addBonus(req: Request, res: Response): Promise<void> {
  sendCreated(res, await service.addBonus(req.params.recordId, req.body));
}

export async function addDeduction(req: Request, res: Response): Promise<void> {
  sendCreated(res, await service.addDeduction(req.params.recordId, req.body));
}

export async function submit(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  sendSuccess(res, await service.submitForApproval(req.params.periodId, req.auth.userId));
}

export async function approve(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  sendSuccess(res, await service.approvePeriod(req.params.periodId, req.auth.userId));
}

export async function markPaid(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  sendSuccess(res, await service.markPaid(req.params.periodId, req.auth.userId));
}

export async function report(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.payrollReport(orgId(req), req.params.periodId));
}
