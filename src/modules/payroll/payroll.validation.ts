import { z } from "zod";

export const createPeriodSchema = z.object({
  label: z.string().min(1).max(80),
  periodStart: z.iso.datetime(),
  periodEnd: z.iso.datetime(),
  payDate: z.iso.datetime(),
});

export const generateRecordsSchema = z.object({
  employeeIds: z.array(z.uuid()).optional(),
});

export const adjustmentSchema = z.object({
  label: z.string().min(1).max(120),
  amount: z.number(),
});

export const recalcSchema = z.object({
  grossSalary: z.number().nonnegative().optional(),
});
