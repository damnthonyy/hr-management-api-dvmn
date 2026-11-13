import { z } from "zod";
import { accountEmail } from "../../utils/schemas";

export const registerSchema = z.object({
  organizationName: z.string().min(2).max(120),
  email: accountEmail(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
});

export const loginSchema = z.object({
  email: accountEmail(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

export const forgotPasswordSchema = z.object({
  email: accountEmail(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8).max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
  email: accountEmail().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
