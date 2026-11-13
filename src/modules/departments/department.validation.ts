import { z } from "zod";

export const createDepartmentSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(40),
  description: z.string().max(240).optional(),
  parentId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
});

export const updateDepartmentSchema = createDepartmentSchema.partial();

export const assignManagerSchema = z.object({
  managerId: z.string().uuid(),
});

export const assignEmployeeSchema = z.object({
  employeeId: z.string().uuid(),
});

export const transferEmployeeSchema = z.object({
  employeeId: z.string().uuid(),
  targetDepartmentId: z.string().uuid(),
});

export const createTeamSchema = z.object({
  name: z.string().min(1).max(120),
  departmentId: z.string().uuid(),
  leadId: z.string().uuid().optional(),
});

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  leadId: z.string().uuid().optional(),
});

export const teamMemberSchema = z.object({
  employeeId: z.string().uuid(),
});
