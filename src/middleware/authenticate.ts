import { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/apiError";
import { verifyAccessToken } from "../utils/jwt";
import { permissionsForRole } from "../config/permissions";

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

    const rolePermissions = permissionsForRole(payload.role);
    const customPermissions = user.roleAssignments.flatMap((assignment) =>
      assignment.role.permissions.map((rp) => rp.permission.key)
    );

    req.auth = {
      userId: user.id,
      organizationId: payload.organizationId,
      email: user.email,
      role: payload.role,
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
