import { type Request, type Response } from "express";
import * as service from "./organization.service";
import { parseBody, parseQuery } from "../../middleware/validate";
import { addAdminSchema, createOrganizationSchema, listOrganizationsQuery, updateOrganizationSchema, updateSettingsSchema, updateSubscriptionSchema } from "./organization.validation";
import { sendSuccess, sendCreated, sendPaginated } from "../../utils/response";
import { ApiError } from "../../utils/apiError";
import { requireAuthContext } from "../../utils/tenant";
import { canGrantSystemRole } from "../../config/permissions";

/** Fields that change the tenant's quota or status: platform-level only. */
const PLATFORM_ONLY_FIELDS = ["employeeLimit", "isActive"] as const;

export async function list(req: Request, res: Response): Promise<void> {
  const { items, meta } = await service.listOrganizations(parseQuery(req, listOrganizationsQuery));
  sendPaginated(res, items, meta);
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, createOrganizationSchema);
  if (!req.auth) throw ApiError.unauthorized();
  const org = await service.createOrganization(body, req.auth.userId);
  sendCreated(res, org);
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const org = await service.getOrganization(req.params.id);
  sendSuccess(res, org);
}

export async function update(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, updateOrganizationSchema);
  const auth = requireAuthContext(req);
  const restricted = PLATFORM_ONLY_FIELDS.filter((field) => body[field] !== undefined);
  if (restricted.length > 0 && auth.role !== "SUPER_ADMIN") {
    throw ApiError.forbidden(`Only the platform can change: ${restricted.join(", ")}`);
  }
  const org = await service.updateOrganization(req.params.id, body, auth.userId);
  sendSuccess(res, org);
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, updateSettingsSchema);
  if (!req.auth) throw ApiError.unauthorized();
  const org = await service.updateSettings(req.params.id, body.settings, req.auth.userId);
  sendSuccess(res, org);
}

export async function updateSubscription(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, updateSubscriptionSchema);
  if (!req.auth) throw ApiError.unauthorized();
  const sub = await service.updateSubscription(req.params.id, body, req.auth.userId);
  sendSuccess(res, sub);
}

export async function listAdmins(req: Request, res: Response): Promise<void> {
  const admins = await service.listAdmins(req.params.id);
  sendSuccess(res, admins);
}

export async function addAdmin(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, addAdminSchema);
  const auth = requireAuthContext(req);
  if (!canGrantSystemRole(auth, "ORGANIZATION_ADMIN")) {
    throw ApiError.forbidden("You cannot create organization admins");
  }
  const admin = await service.addAdmin(req.params.id, body, auth.userId);
  sendCreated(res, admin);
}

export async function stats(req: Request, res: Response): Promise<void> {
  const result = await service.organizationStats(req.params.id);
  sendSuccess(res, result);
}
