import { z } from "zod";
import { paginationQuery, searchFilter, uuidFilter } from "../../utils/query";

export const createEmployeeSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.email(),
  phone: z.string().max(40).optional(),
  dateOfBirth: z.iso.datetime().optional(),
  nationalId: z.string().max(60).optional(),
  address: z.string().max(240).optional(),
  jobTitle: z.string().min(1).max(120),
  departmentId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  managerId: z.uuid().optional(),
  startDate: z.iso.datetime(),
  baseSalary: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  employeeNumber: z.string().max(40).optional(),
});

export const updateEmployeeSchema = createEmployeeSchema.partial().extend({
  status: z.enum(["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"]).optional(),
  terminationDate: z.iso.datetime().optional(),
});

export const emergencyContactSchema = z.object({
  name: z.string().min(1).max(120),
  relationship: z.string().min(1).max(60),
  phone: z.string().min(3).max(40),
  email: z.email().optional(),
});

export const contractSchema = z.object({
  contractType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "TEMPORARY"]),
  title: z.string().min(1).max(120),
  startDate: z.iso.datetime(),
  endDate: z.iso.datetime().optional(),
  salary: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
  weeklyHours: z.number().int().positive().max(80).optional(),
});

export const salaryUpdateSchema = z.object({
  newSalary: z.number().nonnegative(),
  reason: z.string().max(240).optional(),
  effectiveAt: z.iso.datetime().optional(),
});

export const listEmployeesQuery = z.object({
  ...paginationQuery,
  sort: z.string().max(40).optional(),
  departmentId: uuidFilter,
  managerId: uuidFilter,
  status: z.enum(["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"]).optional(),
  search: searchFilter,
});
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuery>;
