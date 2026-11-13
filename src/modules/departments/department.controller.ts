import { Request, Response } from "express";
import * as service from "./department.service";
import { parseBody, parseQuery } from "../../middleware/validate";
import { assignEmployeeSchema, assignManagerSchema, createDepartmentSchema, createTeamSchema, listDepartmentsQuery, listTeamsQuery, teamMemberSchema, transferEmployeeSchema, updateDepartmentSchema, updateTeamSchema } from "./department.validation";
import { sendSuccess, sendCreated, sendPaginated, sendNoContent } from "../../utils/response";
import { requireAuthContext, requireOrgId } from "../../utils/tenant";

export async function list(req: Request, res: Response): Promise<void> {
  const { items, meta } = await service.listDepartments(requireOrgId(req), parseQuery(req, listDepartmentsQuery));
  sendPaginated(res, items, meta);
}

export async function getOne(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getDepartment(requireOrgId(req), req.params.id));
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, createDepartmentSchema);
  const auth = requireAuthContext(req);
  sendCreated(res, await service.createDepartment(auth.organizationId, body, auth.userId));
}

export async function update(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, updateDepartmentSchema);
  const auth = requireAuthContext(req);
  sendSuccess(res, await service.updateDepartment(auth.organizationId, req.params.id, body, auth.userId));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  await service.deleteDepartment(auth.organizationId, req.params.id, auth.userId);
  sendNoContent(res);
}

export async function assignManager(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, assignManagerSchema);
  const auth = requireAuthContext(req);
  sendSuccess(
    res,
    await service.assignManager(auth.organizationId, req.params.id, body.managerId, auth.userId)
  );
}

export async function assignEmployee(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, assignEmployeeSchema);
  sendSuccess(res, await service.assignEmployee(requireOrgId(req), req.params.id, body.employeeId));
}

export async function transferEmployee(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, transferEmployeeSchema);
  const auth = requireAuthContext(req);
  sendSuccess(
    res,
    await service.transferEmployee(auth.organizationId, body.employeeId, body.targetDepartmentId, auth.userId)
  );
}

export async function listTeams(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listTeams(requireOrgId(req), parseQuery(req, listTeamsQuery)));
}

export async function createTeam(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, createTeamSchema);
  sendCreated(res, await service.createTeam(requireOrgId(req), body));
}

export async function updateTeam(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, updateTeamSchema);
  sendSuccess(res, await service.updateTeam(requireOrgId(req), req.params.teamId, body));
}

export async function removeTeam(req: Request, res: Response): Promise<void> {
  await service.deleteTeam(requireOrgId(req), req.params.teamId);
  sendNoContent(res);
}

export async function addTeamMember(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, teamMemberSchema);
  sendSuccess(res, await service.addTeamMember(requireOrgId(req), req.params.teamId, body.employeeId));
}

export async function removeTeamMember(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.removeTeamMember(requireOrgId(req), req.params.employeeId));
}
