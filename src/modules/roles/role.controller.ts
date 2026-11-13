import { Request, Response } from "express";
import * as service from "./role.service";
import { sendSuccess, sendCreated, sendNoContent } from "../../utils/response";
import { ApiError } from "../../utils/apiError";

function orgId(req: Request): string {
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth.organizationId;
}

export async function listPermissions(_req: Request, res: Response): Promise<void> {
  const permissions = await service.listPermissions();
  sendSuccess(res, permissions);
}

export async function listRoles(req: Request, res: Response): Promise<void> {
  const roles = await service.listRoles(orgId(req));
  sendSuccess(res, roles);
}

export async function createRole(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const role = await service.createRole(orgId(req), req.body, req.auth.userId);
  sendCreated(res, role);
}

export async function updateRole(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const role = await service.updateRole(req.params.id, req.body, req.auth.userId);
  sendSuccess(res, role);
}

export async function deleteRole(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  await service.deleteRole(req.params.id, req.auth.userId);
  sendNoContent(res);
}

export async function assignRole(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const assignment = await service.assignRole(req.body, req.auth.userId);
  sendCreated(res, assignment);
}

export async function revokeAssignment(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  await service.revokeAssignment(req.params.assignmentId, req.auth.userId);
  sendNoContent(res);
}

export async function setSystemRole(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const user = await service.setSystemRole(req.params.userId, req.body.systemRole, req.auth.userId);
  sendSuccess(res, user);
}
