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
import { randomUUID } from "crypto";
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

function refreshExpiry(): Date {
  return new Date(Date.now() + env.jwt.refreshTtl * 1000);
}

/**
 * Creates a refresh token row bound to `sessionId` and returns the signed
 * JWT. Only its SHA-256 is stored.
 */
async function createRefreshToken(
  db: Prisma.TransactionClient,
  user: User,
  sessionId: string,
  family: string
): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  const token = signRefreshToken({ sub: user.id, organizationId: user.organizationId, family, tokenId: id });
  await db.refreshToken.create({
    data: { id, userId: user.id, sessionId, family, tokenHash: sha256(token), expiresAt: refreshExpiry() },
  });
  return { id, token };
}

function signAccess(user: User, sessionId: string): string {
  return signAccessToken({
    sub: user.id,
    organizationId: user.organizationId,
    email: user.email,
    role: user.systemRole,
    sessionId,
  });
}

async function issueTokens(user: User, meta: RequestMeta): Promise<TokenBundle> {
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      expiresAt: refreshExpiry(),
    },
  });
  const { token: refreshToken } = await createRefreshToken(prisma, user, session.id, randomToken(16));
  return { accessToken: signAccess(user, session.id), refreshToken, expiresIn: env.jwt.accessTtl };
}

/**
 * Revokes sessions and their refresh tokens. Used on logout, password
 * change/reset and refresh token reuse.
 */
export async function revokeSessions(where: Prisma.SessionWhereInput): Promise<void> {
  const now = new Date();
  const sessions = await prisma.session.findMany({ where: { ...where, revokedAt: null }, select: { id: true } });
  const ids = sessions.map((session) => session.id);
  if (ids.length === 0) return;
  await prisma.$transaction([
    prisma.session.updateMany({ where: { id: { in: ids } }, data: { revokedAt: now } }),
    prisma.refreshToken.updateMany({ where: { sessionId: { in: ids }, revokedAt: null }, data: { revokedAt: now } }),
  ]);
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
      tokenHash: sha256(verificationToken),
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
  const invalid = () => ApiError.unauthorized("Invalid refresh token");
  let payload;
  try {
    payload = verifyRefreshToken(input.refreshToken);
  } catch {
    throw invalid();
  }

  const record = await prisma.refreshToken.findUnique({ where: { id: payload.tokenId } });
  if (!record || record.userId !== payload.sub || record.tokenHash !== sha256(input.refreshToken)) {
    throw invalid();
  }

  // Reuse detection: a rotated or revoked token is being presented again,
  // so it has leaked. Kill the whole family and its session(s).
  const reuse = async () => {
    const family = await prisma.refreshToken.findMany({
      where: { family: record.family },
      select: { sessionId: true },
    });
    const sessionIds = family.map((t) => t.sessionId).filter((id): id is string => id !== null);
    await prisma.refreshToken.updateMany({
      where: { family: record.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await revokeSessions({ id: { in: sessionIds } });
    await recordAudit({
      userId: record.userId,
      action: "auth.refresh_token_reused",
      entityType: "RefreshToken",
      entityId: record.id,
      ipAddress: meta.ipAddress,
    });
    return ApiError.unauthorized("Refresh token is no longer valid");
  };

  if (record.revokedAt || record.replacedBy) throw await reuse();
  if (!record.sessionId || record.expiresAt.getTime() < Date.now()) throw invalid();

  const session = await prisma.session.findUnique({ where: { id: record.sessionId } });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) throw invalid();

  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (!user || !user.isActive) {
    throw ApiError.unauthorized("Account is not active");
  }

  const sessionId = record.sessionId;
  const rotated = await prisma.$transaction(async (tx) => {
    // Conditional update: two concurrent refreshes with the same token
    // cannot both succeed; the loser is treated as a reuse.
    const claimed = await tx.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null, replacedBy: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) return null;
    const next = await createRefreshToken(tx, user, sessionId, record.family);
    await tx.refreshToken.update({ where: { id: record.id }, data: { replacedBy: next.id } });
    await tx.session.update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } });
    return next;
  });
  if (!rotated) throw await reuse();

  return { accessToken: signAccess(user, sessionId), refreshToken: rotated.token, expiresIn: env.jwt.accessTtl };
}

export async function logout(userId: string, sessionId: string): Promise<void> {
  await revokeSessions({ id: sessionId, userId });
}

export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findFirst({ where: { email } });
  if (!user) {
    return;
  }
  const token = randomToken(24);
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
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
}

export async function resetPassword(token: string, newPassword: string) {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
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
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: sha256(token) } });
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
  await revokeSessions({ id: sessionId, userId });
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
