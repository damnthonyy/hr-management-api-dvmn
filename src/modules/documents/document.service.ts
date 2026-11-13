import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/apiError";
import { uploadsDir, resolveStoragePath, sanitizeFileName } from "../../lib/storage";
import { randomToken } from "../../utils/tokens";
import { recordAudit } from "../../services/audit.service";
import { enqueueDocumentProcessing } from "../../queues";
import { logger } from "../../lib/logger";
import { assertOrgRefs } from "../../utils/tenant";
import { contentMatchesType, extensionFor, isAllowedMimeType, SIGNATURE_BYTES } from "../../lib/fileType";
import { fetchRemoteFile, RemoteFileTooLargeError, UnsafeUrlError } from "../../lib/safeFetch";
import { env } from "../../config/env";
import { buildMeta, parsePagination } from "../../utils/pagination";
import type { ListDocumentsQuery } from "./document.validation";

interface UploadedFile {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
}

export async function listDocuments(organizationId: string, query: ListDocumentsQuery) {
  const where: Prisma.DocumentWhereInput = { organizationId };
  if (query.employeeId) where.employeeId = query.employeeId;
  if (query.categoryId) where.categoryId = query.categoryId;
  const params = parsePagination(query);
  const [items, total] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: params.skip,
      take: params.take,
      include: { category: true, employee: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.document.count({ where }),
  ]);
  return { items, meta: buildMeta(params, total) };
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
    // The declared MIME type is client controlled: check the content.
    if (!contentMatchesType(file.mimetype, await readHead(file.path))) {
      throw ApiError.unsupportedMediaType("File content does not match its declared type");
    }
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

  let remote;
  try {
    remote = await fetchRemoteFile(data.url, { maxBytes: env.maxUploadBytes });
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw ApiError.badRequest(error.message);
    if (error instanceof RemoteFileTooLargeError) throw ApiError.payloadTooLarge("Remote file is too large");
    // Do not echo network errors (refused, timeout...): they would turn the
    // endpoint into a port scanner.
    logger.warn({ err: error, url: data.url }, "document import failed");
    throw ApiError.badRequest("Could not download the file");
  }

  if (remote.status < 200 || remote.status >= 300) {
    throw ApiError.badRequest("Could not download the file");
  }
  if (!isAllowedMimeType(remote.contentType) || !contentMatchesType(remote.contentType, remote.body)) {
    throw ApiError.unsupportedMediaType("Only PDF, DOCX, PNG and JPEG files are accepted");
  }

  const buffer = remote.body;
  // The user-supplied name is only kept for display: the file on disk gets
  // a server-generated name, so "../" in fileName cannot escape uploads/.
  const safeName = sanitizeFileName(data.fileName ?? path.basename(new URL(remote.finalUrl).pathname), "import");
  const storedName = `${Date.now()}-${randomToken(8)}${extensionFor(remote.contentType)}`;
  const absolutePath = path.join(uploadsDir(), storedName);

  await fs.promises.writeFile(absolutePath, buffer);
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

  const document = await prisma.document.create({
    data: {
      organizationId,
      employeeId: data.employeeId ?? null,
      categoryId: data.categoryId ?? null,
      uploadedById,
      fileName: storedName,
      originalName: safeName,
      mimeType: remote.contentType,
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

async function readHead(filePath: string): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(SIGNATURE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SIGNATURE_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function fileChecksum(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
