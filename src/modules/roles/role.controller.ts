import { Request, Response } from "express";
import * as service from "./role.service";
import { sendSuccess, sendCreated, sendNoContent } from "../../utils/response";
import { requireAuthContext, requireOrgId } from "../../utils/tenant";

const orgId = requireOrgId;

export async function listPermissions(_req: Request, res: Response): Promise<void> {
  const permissions = await service.listPermissions();
  sendSuccess(res, permissions);
}

export async function listRoles(req: Request, res: Response): Promise<void> {
  const roles = await service.listRoles(orgId(req));
  sendSuccess(res, roles);
}

export async function createRole(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const role = await service.createRole(auth.organizationId, req.body, auth.userId);
  sendCreated(res, role);
}

export async function updateRole(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const role = await service.updateRole(auth.organizationId, req.params.id, req.body, auth.userId);
  sendSuccess(res, role);
}

export async function deleteRole(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  await service.deleteRole(auth.organizationId, req.params.id, auth.userId);
  sendNoContent(res);
}

export async function assignRole(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const assignment = await service.assignRole(auth.organizationId, req.body, auth.userId);
  sendCreated(res, assignment);
}

export async function revokeAssignment(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  await service.revokeAssignment(auth.organizationId, req.params.assignmentId, auth.userId);
  sendNoContent(res);
}

export async function setSystemRole(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const user = await service.setSystemRole(auth.organizationId, req.params.userId, req.body.systemRole, auth.userId);
  sendSuccess(res, user);
}
