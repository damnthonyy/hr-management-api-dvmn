import { Request, Response } from "express";
import * as service from "./document.service";
import { sendSuccess, sendCreated, sendNoContent } from "../../utils/response";
import { ApiError } from "../../utils/apiError";
import { requireAuthContext, requireOrgId } from "../../utils/tenant";

export async function list(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listDocuments(requireOrgId(req), req.query as Record<string, unknown>));
}

export async function getOne(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getDocument(requireOrgId(req), req.params.id));
}

export async function uploadDocument(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  if (!req.file) throw ApiError.badRequest("No file provided");
  const document = await service.saveUploadedDocument(auth.organizationId, req.file, {
    employeeId: req.body?.employeeId,
    categoryId: req.body?.categoryId,
    uploadedById: auth.userId,
  });
  sendCreated(res, document);
}

export async function importFromUrl(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const document = await service.importFromUrl(auth.organizationId, req.body, auth.userId);
  sendCreated(res, document);
}

export async function download(req: Request, res: Response): Promise<void> {
  const { absolutePath, document } = await service.readDocumentFile(requireOrgId(req), req.params.id);
  res.setHeader("Content-Type", document.mimeType);
  // res.attachment() encodes the filename (RFC 6266), preventing header injection.
  res.attachment(document.originalName);
  res.sendFile(absolutePath);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  await service.deleteDocument(auth.organizationId, req.params.id, auth.userId);
  sendNoContent(res);
}

export async function listCategories(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listCategories(requireOrgId(req)));
}

export async function createCategory(req: Request, res: Response): Promise<void> {
  sendCreated(res, await service.createCategory(requireOrgId(req), req.body.name));
}
