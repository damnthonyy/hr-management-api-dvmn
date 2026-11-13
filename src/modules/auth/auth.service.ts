import { type Prisma, SystemRole, type User } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { ApiError } from "../../utils/apiError";
import { hashPassword, verifyPassword } from "../../utils/password";
import { randomToken, sha256 } from "../../utils/tokens";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../utils/jwt";
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

/** Issues a new verification token (stored hashed) and emails the link. */
async function sendEmailVerification(user: Pick<User, "id" | "email" | "firstName">): Promise<void> {
  const verificationToken = randomToken(24);
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(verificationToken),
      expiresAt: new Date(Date.now() + env.emailVerificationTtl * 1000),
    },
  });
  await enqueueEmail({
    to: user.email,
    subject: "Verify your email",
    template: "email_verification",
    context: {
      firstName: user.firstName,
      verifyUrl: `${env.appPublicUrl}/api/v1/auth/verify-email?token=${verificationToken}`,
    },
  });
}

export async function register(
  input: {
    organizationName: string;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  },
  meta: RequestMeta
) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
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

  await sendEmailVerification(result.user);

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

/** Consecutive failures before the account is locked. */
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

let dummyHash: Promise<string> | null = null;
/**
 * Verifying against a throwaway hash for unknown emails makes the response
 * time the same as for existing accounts (no user enumeration by timing).
 */
function burnPasswordCheck(plain: string): Promise<boolean> {
  dummyHash ??= hashPassword(randomToken(16));
  return dummyHash.then((hash) => verifyPassword(hash, plain));
}

export async function login(input: { email: string; password: string }, meta: RequestMeta) {
  const invalid = () => ApiError.unauthorized("Invalid email or password");
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    await burnPasswordCheck(input.password);
    throw invalid();
  }

  const history = (success: boolean, reason: string | null) =>
    prisma.loginHistory.create({
      data: {
        userId: user.id,
        success,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        reason,
      },
    });

  // While locked, the password is not even checked (but the time spent
  // is the same), and the answer is the generic one.
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await burnPasswordCheck(input.password);
    await history(false, "locked");
    throw invalid();
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    // Atomic increment: parallel guesses cannot dodge the counter.
    const { failedLoginCount } = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    const lock = failedLoginCount >= MAX_FAILED_LOGINS;
    if (lock) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) },
      });
    }
    await history(false, lock ? "invalid_credentials_locked" : "invalid_credentials");
    if (lock) {
      await recordAudit({
        organizationId: user.organizationId,
        userId: user.id,
        action: "user.locked",
        entityType: "User",
        entityId: user.id,
        ipAddress: meta.ipAddress,
      });
    }
    throw invalid();
  }

  if (!user.isActive) {
    await history(false, "inactive");
    throw ApiError.forbidden("This account has been deactivated");
  }

  await history(true, null);
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
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
  const user = await prisma.user.findUnique({ where: { email } });
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
  const applied = await prisma.$transaction(async (tx) => {
    // Claim the token atomically so it cannot be used twice concurrently.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) return false;
    // Any other pending reset link for this account becomes useless too.
    await tx.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    // A reset also unlocks the account.
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    });
    return true;
  });
  if (!applied) throw ApiError.badRequest("Invalid or already used reset token");
  // Whoever had access before the reset (possibly an attacker) is logged out.
  await revokeSessions({ userId: record.userId });
  await recordAudit({
    userId: record.userId,
    action: "user.password_reset",
    entityType: "User",
    entityId: record.userId,
  });
  return { ok: true };
}

export async function changePassword(
  userId: string,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound("User not found");
  const valid = await verifyPassword(user.passwordHash, currentPassword);
  if (!valid) throw ApiError.badRequest("Current password is incorrect");
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  // Keep the current session, log out every other device.
  await revokeSessions({ userId, id: { not: currentSessionId } });
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
  data: Partial<Pick<User, "firstName" | "lastName" | "email">> & { currentPassword?: string }
) {
  const { currentPassword, ...changes } = data;
  const current = await prisma.user.findUnique({ where: { id: userId } });
  if (!current) throw ApiError.notFound("User not found");

  const emailChanged = changes.email !== undefined && changes.email !== current.email;
  if (!emailChanged) {
    delete changes.email;
    const user = await prisma.user.update({ where: { id: userId }, data: changes });
    return sanitizeUser(user);
  }

  // The email is the login and password-reset channel: changing it with a
  // stolen session alone would allow a full account takeover.
  if (!currentPassword || !(await verifyPassword(current.passwordHash, currentPassword))) {
    throw ApiError.badRequest("Current password is required to change the email address");
  }

  const user = await prisma.$transaction(async (tx) => {
    // Pending reset / verification links point to the old address.
    await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    await tx.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    return tx.user.update({ where: { id: userId }, data: { ...changes, emailVerified: false } });
  });

  await sendEmailVerification(user);
  await enqueueEmail({
    to: current.email,
    subject: "Your email address was changed",
    template: "email_changed",
    context: { firstName: current.firstName, newEmail: user.email },
  });
  await recordAudit({
    organizationId: user.organizationId,
    userId,
    action: "user.email_changed",
    entityType: "User",
    entityId: userId,
    metadata: { from: current.email, to: user.email },
  });
  return sanitizeUser(user);
}

export async function listSessions(userId: string) {
  // Active sessions only: every login creates one, the full history grows forever.
  return prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    take: 100,
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
