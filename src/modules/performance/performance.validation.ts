import { z } from "zod";
import { paginationQuery, uuidFilter } from "../../utils/query";

export const createCycleSchema = z.object({
  name: z.string().min(1).max(120),
  startDate: z.iso.datetime(),
  endDate: z.iso.datetime(),
});

export const createReviewSchema = z.object({
  cycleId: z.uuid(),
  employeeId: z.uuid(),
  score: z.number().min(0).max(5).optional(),
  summary: z.string().max(2000).optional(),
  feedback: z.string().max(4000).optional(),
});

export const updateReviewSchema = z.object({
  score: z.number().min(0).max(5).optional(),
  summary: z.string().max(2000).optional(),
  feedback: z.string().max(4000).optional(),
  status: z.enum(["DRAFT", "SUBMITTED", "ACKNOWLEDGED", "FINALIZED"]).optional(),
});

export const createObjectiveSchema = z.object({
  employeeId: z.uuid(),
  title: z.string().min(1).max(160),
  description: z.string().max(1000).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  dueDate: z.iso.datetime().optional(),
});

export const updateObjectiveSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  description: z.string().max(1000).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "CANCELED"]).optional(),
});

export const listReviewsQuery = z.object({ ...paginationQuery, cycleId: uuidFilter, employeeId: uuidFilter });
export type ListReviewsQuery = z.infer<typeof listReviewsQuery>;
