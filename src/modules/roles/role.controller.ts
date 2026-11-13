import { Request, Response } from "express";
import { assignRoleSchema, createRoleSchema, setSystemRoleSchema, updateRoleSchema } from "./role.validation";
import { parseBody } from "../../middleware/validate";
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
  const body = parseBody(req, createRoleSchema);
  const auth = requireAuthContext(req);
  const role = await service.createRole(auth, body);
  sendCreated(res, role);
}

export async function updateRole(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, updateRoleSchema);
  const auth = requireAuthContext(req);
  const role = await service.updateRole(auth, req.params.id, body);
  sendSuccess(res, role);
}

export async function deleteRole(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  await service.deleteRole(auth, req.params.id);
  sendNoContent(res);
}

export async function assignRole(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, assignRoleSchema);
  const auth = requireAuthContext(req);
  const assignment = await service.assignRole(auth, body);
  sendCreated(res, assignment);
}

export async function revokeAssignment(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  await service.revokeAssignment(auth, req.params.assignmentId);
  sendNoContent(res);
}

export async function setSystemRole(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, setSystemRoleSchema);
  const auth = requireAuthContext(req);
  const user = await service.setSystemRole(auth, req.params.userId, body.systemRole);
  sendSuccess(res, user);
}
