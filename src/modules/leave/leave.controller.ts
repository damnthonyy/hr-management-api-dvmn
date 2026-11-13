import { Request, Response } from "express";
import * as service from "./leave.service";
import { sendSuccess, sendCreated, sendPaginated } from "../../utils/response";
import { ApiError } from "../../utils/apiError";

function orgId(req: Request): string {
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth.organizationId;
}

export async function listTypes(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listLeaveTypes(orgId(req)));
}

export async function createType(req: Request, res: Response): Promise<void> {
  sendCreated(res, await service.createLeaveType(orgId(req), req.body));
}

export async function listRequests(req: Request, res: Response): Promise<void> {
  const { items, meta } = await service.listRequests(orgId(req), req.query as Record<string, unknown>);
  sendPaginated(res, items, meta);
}

export async function createRequest(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  sendCreated(res, await service.createRequest(orgId(req), req.body, req.auth.userId));
}

export async function approve(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  sendSuccess(res, await service.approveRequest(req.params.id, req.auth.userId, req.body?.decisionNote));
}

export async function reject(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  sendSuccess(res, await service.rejectRequest(req.params.id, req.auth.userId, req.body?.decisionNote));
}

export async function cancel(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  sendSuccess(res, await service.cancelRequest(req.params.id, req.auth.userId));
}

export async function setBalance(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.setBalance(req.body));
}

export async function listBalances(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listBalances(req.params.employeeId));
}

export async function history(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.employeeHistory(req.params.employeeId));
}

export async function calendar(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.departmentCalendar(req.params.departmentId, req.query as Record<string, unknown>));
}
