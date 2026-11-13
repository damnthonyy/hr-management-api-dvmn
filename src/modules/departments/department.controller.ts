import { Request, Response } from "express";
import * as service from "./department.service";
import { sendSuccess, sendCreated, sendPaginated, sendNoContent } from "../../utils/response";
import { ApiError } from "../../utils/apiError";

function orgId(req: Request): string {
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth.organizationId;
}

export async function list(req: Request, res: Response): Promise<void> {
  const { items, meta } = await service.listDepartments(orgId(req), req.query as Record<string, unknown>);
  sendPaginated(res, items, meta);
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const department = await service.getDepartment(req.params.id);
  sendSuccess(res, department);
}

export async function create(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const department = await service.createDepartment(orgId(req), req.body, req.auth.userId);
  sendCreated(res, department);
}

export async function update(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const department = await service.updateDepartment(req.params.id, req.body, req.auth.userId);
  sendSuccess(res, department);
}

export async function remove(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  await service.deleteDepartment(req.params.id, req.auth.userId);
  sendNoContent(res);
}

export async function assignManager(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const department = await service.assignManager(req.params.id, req.body.managerId, req.auth.userId);
  sendSuccess(res, department);
}

export async function assignEmployee(req: Request, res: Response): Promise<void> {
  const employee = await service.assignEmployee(req.params.id, req.body.employeeId);
  sendSuccess(res, employee);
}

export async function transferEmployee(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const employee = await service.transferEmployee(req.body.employeeId, req.body.targetDepartmentId, req.auth.userId);
  sendSuccess(res, employee);
}

export async function listTeams(req: Request, res: Response): Promise<void> {
  const teams = await service.listTeams(orgId(req), req.query as Record<string, unknown>);
  sendSuccess(res, teams);
}

export async function createTeam(req: Request, res: Response): Promise<void> {
  const team = await service.createTeam(orgId(req), req.body);
  sendCreated(res, team);
}

export async function updateTeam(req: Request, res: Response): Promise<void> {
  const team = await service.updateTeam(req.params.teamId, req.body);
  sendSuccess(res, team);
}

export async function removeTeam(req: Request, res: Response): Promise<void> {
  await service.deleteTeam(req.params.teamId);
  sendNoContent(res);
}

export async function addTeamMember(req: Request, res: Response): Promise<void> {
  const member = await service.addTeamMember(req.params.teamId, req.body.employeeId);
  sendSuccess(res, member);
}

export async function removeTeamMember(req: Request, res: Response): Promise<void> {
  const member = await service.removeTeamMember(req.params.employeeId);
  sendSuccess(res, member);
}
