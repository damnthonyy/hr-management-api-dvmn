import { z } from "zod";

export const createRoleSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(240).optional(),
  permissions: z.array(z.string()).default([]),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(240).optional(),
  permissions: z.array(z.string()).optional(),
});

export const assignRoleSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  departmentId: z.string().uuid().optional(),
});

export const setSystemRoleSchema = z.object({
  systemRole: z.enum([
    "SUPER_ADMIN",
    "ORGANIZATION_ADMIN",
    "HR_MANAGER",
    "DEPARTMENT_MANAGER",
    "EMPLOYEE",
    "FINANCE_MANAGER",
  ]),
});
