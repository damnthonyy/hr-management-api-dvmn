import { Request, Response } from "express";
import * as service from "./organization.service";
import { sendSuccess, sendCreated, sendPaginated } from "../../utils/response";
import { ApiError } from "../../utils/apiError";

export async function list(req: Request, res: Response): Promise<void> {
  const { items, meta } = await service.listOrganizations(req.query as Record<string, unknown>);
  sendPaginated(res, items, meta);
}

export async function create(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const org = await service.createOrganization(req.body, req.auth.userId);
  sendCreated(res, org);
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const org = await service.getOrganization(req.params.id);
  sendSuccess(res, org);
}

export async function update(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const org = await service.updateOrganization(req.params.id, req.body, req.auth.userId);
  sendSuccess(res, org);
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const org = await service.updateSettings(req.params.id, req.body.settings, req.auth.userId);
  sendSuccess(res, org);
}

export async function updateSubscription(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const sub = await service.updateSubscription(req.params.id, req.body, req.auth.userId);
  sendSuccess(res, sub);
}

export async function listAdmins(req: Request, res: Response): Promise<void> {
  const admins = await service.listAdmins(req.params.id);
  sendSuccess(res, admins);
}

export async function addAdmin(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const admin = await service.addAdmin(req.params.id, req.body, req.auth.userId);
  sendCreated(res, admin);
}

export async function stats(req: Request, res: Response): Promise<void> {
  const result = await service.organizationStats(req.params.id);
  sendSuccess(res, result);
}
