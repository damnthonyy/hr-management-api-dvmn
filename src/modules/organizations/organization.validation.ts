import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(120),
  legalName: z.string().max(160).optional(),
  domain: z.string().max(120).optional(),
  timezone: z.string().max(60).optional(),
  currency: z.string().length(3).optional(),
  employeeLimit: z.number().int().positive().optional(),
});

export const updateOrganizationSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  legalName: z.string().max(160).optional(),
  domain: z.string().max(120).optional(),
  logoUrl: z.url().optional(),
  timezone: z.string().max(60).optional(),
  currency: z.string().length(3).optional(),
  employeeLimit: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

export const updateSettingsSchema = z.object({
  settings: z.record(z.string(), z.unknown()),
});

export const updateSubscriptionSchema = z.object({
  plan: z.enum(["FREE", "STARTER", "BUSINESS", "ENTERPRISE"]).optional(),
  status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"]).optional(),
  seats: z.number().int().positive().optional(),
  renewsAt: z.iso.datetime().optional(),
});

export const addAdminSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
});
