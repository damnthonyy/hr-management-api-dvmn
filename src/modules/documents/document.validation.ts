import { z } from "zod";
import { paginationQuery, uuidFilter } from "../../utils/query";

export const importFromUrlSchema = z.object({
  url: z.url({ protocol: /^https$/ }).max(2048),
  employeeId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  fileName: z.string().max(200).optional(),
});

export const createCategorySchema = z.object({
  name: z.string().min(1).max(80),
});

export const attachMetadataSchema = z.object({
  employeeId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
});

export const listDocumentsQuery = z.object({
  ...paginationQuery,
  employeeId: uuidFilter,
  categoryId: uuidFilter,
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuery>;

/** Text fields of the multipart upload (all optional). */
export const uploadDocumentSchema = z.object({
  employeeId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
});
