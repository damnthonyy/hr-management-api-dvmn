import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/apiError";
import { uploadsDir, resolveStoragePath, sanitizeFileName } from "../../lib/storage";
import { randomToken } from "../../utils/tokens";
import { recordAudit } from "../../services/audit.service";
import { enqueueDocumentProcessing } from "../../queues";
import { logger } from "../../lib/logger";
import { assertOrgRefs } from "../../utils/tenant";

interface UploadedFile {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
}

export async function listDocuments(organizationId: string, query: Record<string, unknown>) {
  const where: Record<string, unknown> = { organizationId };
  if (typeof query.employeeId === "string") where.employeeId = query.employeeId;
  if (typeof query.categoryId === "string") where.categoryId = query.categoryId;
  return prisma.document.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { category: true, employee: { select: { id: true, firstName: true, lastName: true } } },
  });
}

export async function getDocument(organizationId: string, id: string) {
  const document = await prisma.document.findUnique({ where: { id, organizationId } });
  if (!document) throw ApiError.notFound("Document not found");
  return document;
}

export async function saveUploadedDocument(organizationId: string, file: UploadedFile, meta: {
  employeeId?: string;
  categoryId?: string;
  uploadedById: string;
}) {
  try {
    await assertOrgRefs(organizationId, { employee: meta.employeeId, documentCategory: meta.categoryId });
  } catch (error) {
    fs.rmSync(file.path, { force: true });
    throw error;
  }
  const relative = path.join("uploads", file.filename);
  const checksum = await fileChecksum(file.path);
  const document = await prisma.document.create({
    data: {
      organizationId,
      employeeId: meta.employeeId ?? null,
      categoryId: meta.categoryId ?? null,
      uploadedById: meta.uploadedById,
      fileName: file.filename,
      originalName: sanitizeFileName(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storagePath: relative,
      source: "upload",
      checksum,
    },
  });
  await enqueueDocumentProcessing({ documentId: document.id, organizationId });
  await recordAudit({
    organizationId,
    userId: meta.uploadedById,
    action: "document.uploaded",
    entityType: "Document",
    entityId: document.id,
  });
  return document;
}

export async function importFromUrl(organizationId: string, data: {
  url: string;
  employeeId?: string;
  categoryId?: string;
  fileName?: string;
}, uploadedById: string) {
  await assertOrgRefs(organizationId, { employee: data.employeeId, documentCategory: data.categoryId });
  const response = await axios.get(data.url, {
    responseType: "arraybuffer",
    maxRedirects: 5,
    timeout: 10000,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    throw ApiError.badRequest(`Remote server responded with status ${response.status}`);
  }

  const buffer = Buffer.from(response.data as ArrayBuffer);
  const contentType = String(response.headers["content-type"] ?? "application/octet-stream").split(";")[0];
  // The user-supplied name is only kept for display: the file on disk gets
  // a server-generated name, so "../" in fileName cannot escape uploads/.
  const safeName = sanitizeFileName(data.fileName ?? path.basename(new URL(data.url).pathname), "import");
  const storedName = `${Date.now()}-${randomToken(8)}`;
  const absolutePath = path.join(uploadsDir(), storedName);

  fs.writeFileSync(absolutePath, buffer);
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

  const document = await prisma.document.create({
    data: {
      organizationId,
      employeeId: data.employeeId ?? null,
      categoryId: data.categoryId ?? null,
      uploadedById,
      fileName: storedName,
      originalName: safeName,
      mimeType: contentType,
      sizeBytes: buffer.length,
      storagePath: path.join("uploads", storedName),
      source: "url-import",
      sourceUrl: data.url,
      checksum,
    },
  });

  logger.info({ url: data.url, documentId: document.id, bytes: buffer.length }, "document imported from url");
  await enqueueDocumentProcessing({ documentId: document.id, organizationId });
  await recordAudit({
    organizationId,
    userId: uploadedById,
    action: "document.imported",
    entityType: "Document",
    entityId: document.id,
    metadata: { sourceUrl: data.url },
  });

  return document;
}

export async function readDocumentFile(
  organizationId: string,
  id: string
): Promise<{ absolutePath: string; document: Awaited<ReturnType<typeof getDocument>> }> {
  const document = await getDocument(organizationId, id);
  const absolutePath = resolveStoragePath(document.storagePath);
  if (!fs.existsSync(absolutePath)) {
    throw ApiError.notFound("File is no longer available on disk");
  }
  return { absolutePath, document };
}

export async function deleteDocument(organizationId: string, id: string, actorId: string) {
  const document = await getDocument(organizationId, id);
  const absolutePath = resolveStoragePath(document.storagePath);
  try {
    if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
  } catch (error) {
    logger.warn({ err: error, id }, "failed to remove file from disk");
  }
  await prisma.document.delete({ where: { id, organizationId } });
  await recordAudit({
    organizationId: document.organizationId,
    userId: actorId,
    action: "document.deleted",
    entityType: "Document",
    entityId: id,
  });
  return { ok: true };
}

export async function listCategories(organizationId: string) {
  return prisma.documentCategory.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
}

export async function createCategory(organizationId: string, name: string) {
  return prisma.documentCategory.create({ data: { organizationId, name } });
}

async function fileChecksum(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
