import { z } from "zod";

export const createEmployeeSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email(),
  phone: z.string().max(40).optional(),
  dateOfBirth: z.string().datetime().optional(),
  nationalId: z.string().max(60).optional(),
  address: z.string().max(240).optional(),
  jobTitle: z.string().min(1).max(120),
  departmentId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
  startDate: z.string().datetime(),
  baseSalary: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  employeeNumber: z.string().max(40).optional(),
});

export const updateEmployeeSchema = createEmployeeSchema.partial().extend({
  status: z.enum(["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"]).optional(),
  terminationDate: z.string().datetime().optional(),
});

export const emergencyContactSchema = z.object({
  name: z.string().min(1).max(120),
  relationship: z.string().min(1).max(60),
  phone: z.string().min(3).max(40),
  email: z.string().email().optional(),
});

export const contractSchema = z.object({
  contractType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "TEMPORARY"]),
  title: z.string().min(1).max(120),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  salary: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
  weeklyHours: z.number().int().positive().max(80).optional(),
});

export const salaryUpdateSchema = z.object({
  newSalary: z.number().nonnegative(),
  reason: z.string().max(240).optional(),
  effectiveAt: z.string().datetime().optional(),
});
