import { Request, Response } from "express";
import * as service from "./document.service";
import { sendSuccess, sendCreated, sendNoContent } from "../../utils/response";
import { ApiError } from "../../utils/apiError";

function orgId(req: Request): string {
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth.organizationId;
}

export async function list(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listDocuments(orgId(req), req.query as Record<string, unknown>));
}

export async function getOne(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getDocument(req.params.id));
}

export async function uploadDocument(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  if (!req.file) throw ApiError.badRequest("No file provided");
  const document = await service.saveUploadedDocument(orgId(req), req.file, {
    employeeId: req.body?.employeeId,
    categoryId: req.body?.categoryId,
    uploadedById: req.auth.userId,
  });
  sendCreated(res, document);
}

export async function importFromUrl(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const document = await service.importFromUrl(orgId(req), req.body, req.auth.userId);
  sendCreated(res, document);
}

export async function download(req: Request, res: Response): Promise<void> {
  const { absolutePath, document } = await service.readDocumentFile(req.params.id);
  res.setHeader("Content-Type", document.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${document.originalName}"`);
  res.sendFile(absolutePath);
}

export async function remove(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  await service.deleteDocument(req.params.id, req.auth.userId);
  sendNoContent(res);
}

export async function listCategories(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listCategories(orgId(req)));
}

export async function createCategory(req: Request, res: Response): Promise<void> {
  sendCreated(res, await service.createCategory(orgId(req), req.body.name));
}
