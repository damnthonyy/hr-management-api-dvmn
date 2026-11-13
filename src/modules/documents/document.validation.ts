import { z } from "zod";

export const importFromUrlSchema = z.object({
  url: z.string().url(),
  employeeId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  fileName: z.string().max(200).optional(),
});

export const createCategorySchema = z.object({
  name: z.string().min(1).max(80),
});

export const attachMetadataSchema = z.object({
  employeeId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
});
