import { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/apiError";
import { verifyAccessToken } from "../utils/jwt";
import { permissionsForRole } from "../config/permissions";

/** Avoid a write per request: refresh lastSeenAt at most every 5 minutes. */
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header("authorization");
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      throw ApiError.unauthorized();
    }
    const token = header.slice(7).trim();
    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        roleAssignments: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });

    if (!user || !user.isActive) {
      throw ApiError.unauthorized("Account is not active");
    }

    // The access token is only valid while its session is: logout,
    // "revoke session" and password changes take effect immediately.
    const session = await prisma.session.findUnique({ where: { id: payload.sessionId } });
    if (!session || session.userId !== user.id || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      throw ApiError.unauthorized("Session is no longer valid");
    }
    if (Date.now() - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
      void prisma.session
        .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }

    // Role and organization come from the database, not from the token:
    // a demotion or deactivation must take effect immediately, not when
    // the access token expires.
    const rolePermissions = permissionsForRole(user.systemRole);
    const customPermissions = user.roleAssignments.flatMap((assignment) =>
      assignment.role.permissions.map((rp) => rp.permission.key)
    );

    req.auth = {
      userId: user.id,
      organizationId: user.organizationId,
      email: user.email,
      role: user.systemRole,
      sessionId: payload.sessionId,
      permissions: Array.from(new Set([...rolePermissions, ...customPermissions])),
    };
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      next(error);
      return;
    }
    next(ApiError.unauthorized("Invalid or expired token"));
  }
}

export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  if (!header) {
    next();
    return;
  }
  authenticate(req, _res, next).catch(() => next());
}
