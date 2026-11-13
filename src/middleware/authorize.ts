import { NextFunction, Request, Response } from "express";
import { SystemRole } from "@prisma/client";
import { ApiError } from "../utils/apiError";
import { PermissionKey } from "../config/permissions";


// logic for checking authentication and authorization in Express routes
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(ApiError.unauthorized());
    return;
  }
  next();
}

// logic for checking if the authenticated user has a specific role
export function requireRole(...roles: SystemRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(ApiError.unauthorized());
      return;
    }
    // If the user is a SUPER_ADMIN, they are allowed to proceed regardless of the required roles
    if (req.auth.role === SystemRole.SUPER_ADMIN || roles.includes(req.auth.role)) {
      next();
      return;
    }
    next(ApiError.forbidden());
  };
}

export function requirePermission(...required: PermissionKey[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(ApiError.unauthorized());
      return;
    }
    const granted = req.auth.permissions;
    const ok = required.every((perm) => granted.includes(perm));
    if (!ok) {
      next(ApiError.forbidden("Missing required permission"));
      return;
    }
    next();
  };
}

export function requireAnyPermission(...required: PermissionKey[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(ApiError.unauthorized());
      return;
    }
    const granted = req.auth.permissions;
    const ok = required.some((perm) => granted.includes(perm));
    if (!ok) {
      next(ApiError.forbidden("Missing required permission"));
      return;
    }
    next();
  };
}
