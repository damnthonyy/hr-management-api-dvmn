import { z } from "zod";
import { paginationQuery, uuidFilter } from "../../utils/query";

export const createDepartmentSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(40),
  description: z.string().max(240).optional(),
  parentId: z.uuid().optional(),
  managerId: z.uuid().optional(),
});

export const updateDepartmentSchema = createDepartmentSchema.partial();

export const assignManagerSchema = z.object({
  managerId: z.uuid(),
});

export const assignEmployeeSchema = z.object({
  employeeId: z.uuid(),
});

export const transferEmployeeSchema = z.object({
  employeeId: z.uuid(),
  targetDepartmentId: z.uuid(),
});

export const createTeamSchema = z.object({
  name: z.string().min(1).max(120),
  departmentId: z.uuid(),
  leadId: z.uuid().optional(),
});

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  leadId: z.uuid().optional(),
});

export const teamMemberSchema = z.object({
  employeeId: z.uuid(),
});

export const listDepartmentsQuery = z.object({ ...paginationQuery });
export type ListDepartmentsQuery = z.infer<typeof listDepartmentsQuery>;

export const listTeamsQuery = z.object({ departmentId: uuidFilter });
export type ListTeamsQuery = z.infer<typeof listTeamsQuery>;

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
