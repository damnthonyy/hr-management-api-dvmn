import { type Request, type Response } from "express";
import * as service from "./notification.service";
import { parseBody, parseQuery } from "../../middleware/validate";
import { inviteSchema, listNotificationsQuery } from "./notification.validation";
import { sendSuccess, sendPaginated } from "../../utils/response";
import { ApiError } from "../../utils/apiError";
import { canGrantSystemRole } from "../../config/permissions";

export async function list(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const { items, meta } = await service.listForUser(req.auth.userId, parseQuery(req, listNotificationsQuery));
  sendPaginated(res, items, meta);
}

export async function unreadCount(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  sendSuccess(res, await service.unreadCount(req.auth.userId));
}

export async function markRead(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  sendSuccess(res, await service.markRead(req.params.id, req.auth.userId));
}

export async function markAllRead(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  sendSuccess(res, await service.markAllRead(req.auth.userId));
}

export async function invite(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, inviteSchema);
  if (!req.auth) throw ApiError.unauthorized();
  if (!canGrantSystemRole(req.auth, body.role)) {
    throw ApiError.forbidden("You cannot invite users with this role");
  }
  sendSuccess(res, await service.invite(req.auth.organizationId, body, req.auth.userId));
}
