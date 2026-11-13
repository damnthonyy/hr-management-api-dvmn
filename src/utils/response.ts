import { type Response } from "express";

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function sendSuccess(res: Response, data: unknown, statusCode = 200): Response {
  return res.status(statusCode).json({ success: true, data });
}

export function sendCreated(res: Response, data: unknown): Response {
  return res.status(201).json({ success: true, data });
}

export function sendPaginated(
  res: Response,
  data: unknown[],
  meta: PaginationMeta,
  statusCode = 200
): Response {
  return res.status(statusCode).json({ success: true, data, meta });
}

export function sendNoContent(res: Response): Response {
  return res.status(204).send();
}
