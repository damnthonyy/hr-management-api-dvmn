import { Prisma, SystemRole, User } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { ApiError } from "../../utils/apiError";
import { hashPassword, verifyPassword } from "../../utils/password";
import { randomToken, sha256 } from "../../utils/tokens";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../utils/jwt";
import { slugify } from "../../utils/slug";
import { recordAudit } from "../../services/audit.service";
import { enqueueEmail } from "../../queues";

interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

async function issueTokens(user: User, meta: RequestMeta): Promise<TokenBundle> {
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      expiresAt: new Date(Date.now() + env.jwt.refreshTtl * 1000),
    },
  });

  const family = randomToken(16);
  const refreshRecord = await prisma.refreshToken.create({
    data: {
      userId: user.id,
      family,
      tokenHash: "",
      expiresAt: new Date(Date.now() + env.jwt.refreshTtl * 1000),
    },
  });

  const accessToken = signAccessToken({
    sub: user.id,
    organizationId: user.organizationId,
    email: user.email,
    role: user.systemRole,
    sessionId: session.id,
  });

  const refreshToken = signRefreshToken({
    sub: user.id,
    organizationId: user.organizationId,
    family,
    tokenId: refreshRecord.id,
  });

  await prisma.refreshToken.update({
    where: { id: refreshRecord.id },
    data: { tokenHash: sha256(refreshToken) },
  });

  return { accessToken, refreshToken, expiresIn: env.jwt.accessTtl };
}

export async function register(input: {
  organizationName: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}, meta: RequestMeta) {
  const existing = await prisma.user.findFirst({ where: { email: input.email } });
  if (existing) {
    throw ApiError.conflict("An account with this email already exists");
  }

  const passwordHash = await hashPassword(input.password);
  const slug = `${slugify(input.organizationName)}-${randomToken(3)}`;

  const result = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: input.organizationName,
        slug,
        subscription: { create: { plan: "FREE", status: "TRIALING", seats: 50 } },
      },
    });

    const user = await tx.user.create({
      data: {
        organizationId: organization.id,
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        systemRole: SystemRole.ORGANIZATION_ADMIN,
        emailVerified: false,
      },
    });

    return { organization, user };
  });

  const verificationToken = randomToken(24);
  await prisma.emailVerificationToken.create({
    data: {
      userId: result.user.id,
      token: verificationToken,
      expiresAt: new Date(Date.now() + env.emailVerificationTtl * 1000),
    },
  });

  await enqueueEmail({
    to: result.user.email,
    subject: "Verify your email",
    template: "email_verification",
    context: {
      firstName: result.user.firstName,
      verifyUrl: `${env.appPublicUrl}/api/v1/auth/verify-email?token=${verificationToken}`,
    },
  });

  await recordAudit({
    organizationId: result.organization.id,
    userId: result.user.id,
    action: "organization.registered",
    entityType: "Organization",
    entityId: result.organization.id,
    ipAddress: meta.ipAddress,
  });

  const tokens = await issueTokens(result.user, meta);
  return { organization: result.organization, user: sanitizeUser(result.user), tokens };
}

export async function login(input: { email: string; password: string }, meta: RequestMeta) {
  const user = await prisma.user.findFirst({ where: { email: input.email } });
  if (!user) {
    throw ApiError.unauthorized("Invalid email or password");
  }

  const valid = await verifyPassword(user.passwordHash, input.password);

  await prisma.loginHistory.create({
    data: {
      userId: user.id,
      success: valid,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      reason: valid ? null : "invalid_credentials",
    },
  });

  if (!valid) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    throw ApiError.unauthorized("Invalid email or password");
  }

  if (!user.isActive) {
    throw ApiError.forbidden("This account has been deactivated");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLoginCount: 0 },
  });

  await recordAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "user.login",
    entityType: "User",
    entityId: user.id,
    ipAddress: meta.ipAddress,
  });

  const tokens = await issueTokens(user, meta);
  return { user: sanitizeUser(user), tokens };
}

export async function refresh(input: { refreshToken: string }, meta: RequestMeta) {
  let payload;
  try {
    payload = verifyRefreshToken(input.refreshToken);
  } catch {
    throw ApiError.unauthorized("Invalid refresh token");
  }

  const record = await prisma.refreshToken.findUnique({ where: { id: payload.tokenId } });
  if (!record || record.revokedAt) {
    throw ApiError.unauthorized("Refresh token is no longer valid");
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw ApiError.unauthorized("Refresh token expired");
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) {
    throw ApiError.unauthorized("Account is not active");
  }

  const newRecord = await prisma.refreshToken.create({
    data: {
      userId: user.id,
      family: record.family,
      tokenHash: "",
      expiresAt: new Date(Date.now() + env.jwt.refreshTtl * 1000),
    },
  });

  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { replacedBy: newRecord.id },
  });

  const accessToken = signAccessToken({
    sub: user.id,
    organizationId: user.organizationId,
    email: user.email,
    role: user.systemRole,
    sessionId: payload.tokenId,
  });

  const refreshToken = signRefreshToken({
    sub: user.id,
    organizationId: user.organizationId,
    family: record.family,
    tokenId: newRecord.id,
  });

  await prisma.refreshToken.update({
    where: { id: newRecord.id },
    data: { tokenHash: sha256(refreshToken) },
  });

  return { accessToken, refreshToken, expiresIn: env.jwt.accessTtl };
}

export async function logout(userId: string, sessionId: string, refreshToken?: string) {
  await prisma.session.updateMany({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
  if (refreshToken) {
    const hash = sha256(refreshToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hash },
      data: { revokedAt: new Date() },
    });
  }
}

export async function forgotPassword(email: string) {
  const user = await prisma.user.findFirst({ where: { email } });
  if (!user) {
    return { token: null };
  }
  const token = randomToken(24);
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + env.passwordResetTtl * 1000),
    },
  });
  await enqueueEmail({
    to: user.email,
    subject: "Reset your password",
    template: "password_reset",
    context: {
      firstName: user.firstName,
      resetUrl: `${env.appPublicUrl}/api/v1/auth/reset-password?token=${token}`,
      token,
    },
  });
  return { token };
}

export async function resetPassword(token: string, newPassword: string) {
  const record = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!record || record.usedAt) {
    throw ApiError.badRequest("Invalid or already used reset token");
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw ApiError.badRequest("Reset token expired");
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: record.userId },
    data: { passwordHash },
  });
  await prisma.passwordResetToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });
  await recordAudit({
    userId: record.userId,
    action: "user.password_reset",
    entityType: "User",
    entityId: record.userId,
  });
  return { ok: true };
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound("User not found");
  const valid = await verifyPassword(user.passwordHash, currentPassword);
  if (!valid) throw ApiError.badRequest("Current password is incorrect");
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  await recordAudit({
    organizationId: user.organizationId,
    userId,
    action: "user.password_changed",
    entityType: "User",
    entityId: userId,
  });
  return { ok: true };
}

export async function verifyEmail(token: string) {
  const record = await prisma.emailVerificationToken.findUnique({ where: { token } });
  if (!record || record.usedAt) {
    throw ApiError.badRequest("Invalid verification token");
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw ApiError.badRequest("Verification token expired");
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } }),
    prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
  return { ok: true };
}

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      organization: true,
      employee: true,
      roleAssignments: { include: { role: true } },
    },
  });
  if (!user) throw ApiError.notFound("User not found");
  return sanitizeUser(user);
}

export async function updateProfile(
  userId: string,
  data: Partial<Pick<User, "firstName" | "lastName" | "email">>
) {
  const user = await prisma.user.update({
    where: { id: userId },
    data,
  });
  return sanitizeUser(user);
}

export async function listSessions(userId: string) {
  return prisma.session.findMany({
    where: { userId },
    orderBy: { lastSeenAt: "desc" },
  });
}

export async function revokeSession(userId: string, sessionId: string) {
  await prisma.session.updateMany({
    where: { id: sessionId, userId },
    data: { revokedAt: new Date() },
  });
  return { ok: true };
}

export async function loginHistory(userId: string) {
  return prisma.loginHistory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

function sanitizeUser<T extends { passwordHash?: string }>(user: T): Omit<T, "passwordHash"> {
  const { passwordHash, ...rest } = user as T & { passwordHash?: string };
  void passwordHash;
  return rest;
}
