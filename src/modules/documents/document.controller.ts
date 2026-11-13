import { type Request, type Response } from "express";
import * as service from "./document.service";
import { parseBody, parseQuery } from "../../middleware/validate";
import {
  createCategorySchema,
  importFromUrlSchema,
  listDocumentsQuery,
  uploadDocumentSchema,
} from "./document.validation";
import { sendSuccess, sendCreated, sendNoContent, sendPaginated } from "../../utils/response";
import { ApiError } from "../../utils/apiError";
import { removeFile } from "../../lib/storage";
import { requireAuthContext, requireOrgId } from "../../utils/tenant";

export async function list(req: Request, res: Response): Promise<void> {
  const { items, meta } = await service.listDocuments(requireOrgId(req), parseQuery(req, listDocumentsQuery));
  sendPaginated(res, items, meta);
}

export async function getOne(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getDocument(requireOrgId(req), req.params.id));
}

export async function uploadDocument(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  if (!req.file) throw ApiError.badRequest("No file provided");
  let fields;
  try {
    fields = parseBody(req, uploadDocumentSchema);
  } catch (error) {
    // multer already wrote the file: do not leave it behind.
    await removeFile(req.file.path);
    throw error;
  }
  const document = await service.saveUploadedDocument(auth.organizationId, req.file, {
    ...fields,
    uploadedById: auth.userId,
  });
  sendCreated(res, document);
}

export async function importFromUrl(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, importFromUrlSchema);
  const auth = requireAuthContext(req);
  const document = await service.importFromUrl(auth.organizationId, body, auth.userId);
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
  const body = parseBody(req, createCategorySchema);
  sendCreated(res, await service.createCategory(requireOrgId(req), body.name));
}
