import { Request, Response } from "express";
import * as service from "./department.service";
import { sendSuccess, sendCreated, sendPaginated, sendNoContent } from "../../utils/response";
import { requireAuthContext, requireOrgId } from "../../utils/tenant";

export async function list(req: Request, res: Response): Promise<void> {
  const { items, meta } = await service.listDepartments(requireOrgId(req), req.query as Record<string, unknown>);
  sendPaginated(res, items, meta);
}

export async function getOne(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getDepartment(requireOrgId(req), req.params.id));
}

export async function create(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  sendCreated(res, await service.createDepartment(auth.organizationId, req.body, auth.userId));
}

export async function update(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  sendSuccess(res, await service.updateDepartment(auth.organizationId, req.params.id, req.body, auth.userId));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  await service.deleteDepartment(auth.organizationId, req.params.id, auth.userId);
  sendNoContent(res);
}

export async function assignManager(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  sendSuccess(
    res,
    await service.assignManager(auth.organizationId, req.params.id, req.body.managerId, auth.userId)
  );
}

export async function assignEmployee(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.assignEmployee(requireOrgId(req), req.params.id, req.body.employeeId));
}

export async function transferEmployee(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  sendSuccess(
    res,
    await service.transferEmployee(auth.organizationId, req.body.employeeId, req.body.targetDepartmentId, auth.userId)
  );
}

export async function listTeams(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listTeams(requireOrgId(req), req.query as Record<string, unknown>));
}

export async function createTeam(req: Request, res: Response): Promise<void> {
  sendCreated(res, await service.createTeam(requireOrgId(req), req.body));
}

export async function updateTeam(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.updateTeam(requireOrgId(req), req.params.teamId, req.body));
}

export async function removeTeam(req: Request, res: Response): Promise<void> {
  await service.deleteTeam(requireOrgId(req), req.params.teamId);
  sendNoContent(res);
}

export async function addTeamMember(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.addTeamMember(requireOrgId(req), req.params.teamId, req.body.employeeId));
}

export async function removeTeamMember(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.removeTeamMember(requireOrgId(req), req.params.employeeId));
}
