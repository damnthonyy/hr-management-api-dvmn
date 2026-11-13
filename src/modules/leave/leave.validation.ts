import { z } from "zod";
import { LeaveRequestStatus } from "@prisma/client";
import { paginationQuery, uuidFilter, dateFilter } from "../../utils/query";

export const createLeaveTypeSchema = z.object({
  name: z.string().min(1).max(80),
  code: z.string().min(1).max(40),
  defaultDays: z.number().int().nonnegative().optional(),
  paid: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
});

export const createLeaveRequestSchema = z.object({
  employeeId: z.uuid(),
  leaveTypeId: z.uuid(),
  startDate: z.iso.datetime(),
  endDate: z.iso.datetime(),
  reason: z.string().max(400).optional(),
});

export const decisionSchema = z.object({
  decisionNote: z.string().max(400).optional(),
});

export const setBalanceSchema = z.object({
  employeeId: z.uuid(),
  leaveTypeId: z.uuid(),
  year: z.number().int(),
  entitledDays: z.number().nonnegative(),
});

export const listLeaveRequestsQuery = z.object({
  ...paginationQuery,
  status: z.enum(LeaveRequestStatus).optional(),
  employeeId: uuidFilter,
});
export type ListLeaveRequestsQuery = z.infer<typeof listLeaveRequestsQuery>;

export const calendarQuery = z
  .object({ from: dateFilter.optional(), to: dateFilter.optional() })
  .refine((value) => !value.from || !value.to || value.from <= value.to, { message: "from must be before to", path: ["to"] });
export type CalendarQuery = z.infer<typeof calendarQuery>;
