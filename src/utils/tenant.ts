import { NextFunction, Request, Response } from "express";
import { SystemRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "./apiError";
import type { AuthContext } from "../types/express";

/**
 * Returns the authenticated context or throws 401.
 */
export function requireAuthContext(req: Request): AuthContext {
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth;
}

/**
 * The organization of the authenticated user. This is the only trusted
 * source for the tenant id: never read it from headers, query or body.
 */
export function requireOrgId(req: Request): string {
  return requireAuthContext(req).organizationId;
}

/**
 * Route guard for `/organizations/:param` style routes: the target
 * organization must be the caller's own, unless the caller is SUPER_ADMIN.
 * Answers 404 so that other tenants' ids are not disclosed.
 */
export function requireSameOrganizationParam(param = "id") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(ApiError.unauthorized());
      return;
    }
    if (req.auth.role === SystemRole.SUPER_ADMIN || req.params[param] === req.auth.organizationId) {
      next();
      return;
    }
    next(ApiError.notFound("Organization not found"));
  };
}

type Ids = string | null | undefined | Array<string | null | undefined>;

const counters = {
  employee: (ids: string[], organizationId: string) =>
    prisma.employee.count({ where: { id: { in: ids }, organizationId } }),
  department: (ids: string[], organizationId: string) =>
    prisma.department.count({ where: { id: { in: ids }, organizationId } }),
  team: (ids: string[], organizationId: string) =>
    prisma.team.count({ where: { id: { in: ids }, organizationId } }),
  user: (ids: string[], organizationId: string) =>
    prisma.user.count({ where: { id: { in: ids }, organizationId } }),
  role: (ids: string[], organizationId: string) =>
    prisma.role.count({ where: { id: { in: ids }, organizationId } }),
  leaveType: (ids: string[], organizationId: string) =>
    prisma.leaveType.count({ where: { id: { in: ids }, organizationId } }),
  documentCategory: (ids: string[], organizationId: string) =>
    prisma.documentCategory.count({ where: { id: { in: ids }, organizationId } }),
  performanceCycle: (ids: string[], organizationId: string) =>
    prisma.performanceCycle.count({ where: { id: { in: ids }, organizationId } }),
} as const;

export type TenantRefKind = keyof typeof counters;

/**
 * Asserts that every referenced id (foreign keys coming from the request
 * body or params) belongs to `organizationId`. Null/undefined ids are
 * ignored, so optional fields can be passed as-is.
 *
 * Throws 404 when a reference is missing or belongs to another tenant.
 */
export async function assertOrgRefs(
  organizationId: string,
  refs: Partial<Record<TenantRefKind, Ids>>
): Promise<void> {
  for (const [kind, value] of Object.entries(refs) as [TenantRefKind, Ids][]) {
    const list = (Array.isArray(value) ? value : [value]).filter(
      (id): id is string => typeof id === "string" && id.length > 0
    );
    const ids = Array.from(new Set(list));
    if (ids.length === 0) continue;
    const found = await counters[kind](ids, organizationId);
    if (found !== ids.length) {
      throw ApiError.notFound(`Referenced ${kind} not found`);
    }
  }
}
