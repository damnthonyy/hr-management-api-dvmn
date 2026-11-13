import { Request, Response } from "express";
import * as service from "./notification.service";
import { sendSuccess, sendPaginated } from "../../utils/response";
import { ApiError } from "../../utils/apiError";

export async function list(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const { items, meta } = await service.listForUser(req.auth.userId, req.query as Record<string, unknown>);
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
  if (!req.auth) throw ApiError.unauthorized();
  sendSuccess(res, await service.invite(req.auth.organizationId, req.body, req.auth.userId));
}
