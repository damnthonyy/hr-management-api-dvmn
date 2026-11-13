import { z } from "zod";

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
