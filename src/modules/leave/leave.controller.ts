import { Request, Response } from "express";
import * as service from "./leave.service";
import { sendSuccess, sendCreated, sendPaginated } from "../../utils/response";
import { requireAuthContext, requireOrgId } from "../../utils/tenant";

const orgId = requireOrgId;

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
  const auth = requireAuthContext(req);
  sendCreated(res, await service.createRequest(auth.organizationId, req.body, auth.userId));
}

export async function approve(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  sendSuccess(res, await service.approveRequest(auth.organizationId, req.params.id, auth.userId, req.body?.decisionNote));
}

export async function reject(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  sendSuccess(res, await service.rejectRequest(auth.organizationId, req.params.id, auth.userId, req.body?.decisionNote));
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  sendSuccess(res, await service.cancelRequest(auth.organizationId, req.params.id, auth.userId));
}

export async function setBalance(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.setBalance(orgId(req), req.body));
}

export async function listBalances(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listBalances(orgId(req), req.params.employeeId));
}

export async function history(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.employeeHistory(orgId(req), req.params.employeeId));
}

export async function calendar(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.departmentCalendar(orgId(req), req.params.departmentId, req.query as Record<string, unknown>));
}
