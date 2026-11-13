import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/apiError";
import { type SystemRole } from "@prisma/client";
import {
  ALL_PERMISSIONS,
  canGrantSystemRole,
  isKnownPermission,
  missingPermissions,
} from "../../config/permissions";
import type { AuthContext } from "../../types/express";
import { recordAudit } from "../../services/audit.service";
import { assertOrgRefs } from "../../utils/tenant";

/**
 * Custom role permissions must be known keys, and the caller can only
 * hand out permissions they hold themselves.
 */
function assertGrantablePermissions(auth: AuthContext, keys: string[]): void {
  const unknown = keys.filter((key) => !isKnownPermission(key));
  if (unknown.length > 0) throw ApiError.badRequest("Unknown permissions", { permissions: unknown });
  const missing = missingPermissions(auth.permissions, keys);
  if (missing.length > 0) {
    throw ApiError.forbidden("You cannot grant permissions you do not hold");
  }
}

async function rolePermissionKeys(roleId: string): Promise<string[]> {
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permission: { select: { key: true } } },
  });
  return rows.map((row) => row.permission.key);
}

async function findRoleInOrg(organizationId: string, id: string) {
  const role = await prisma.role.findUnique({ where: { id, organizationId } });
  if (!role) throw ApiError.notFound("Role not found");
  return role;
}

export async function listPermissions() {
  return prisma.permission.findMany({ orderBy: { key: "asc" } });
}

export function catalogPermissions() {
  return ALL_PERMISSIONS;
}

export async function listRoles(organizationId: string) {
  return prisma.role.findMany({
    where: { organizationId },
    include: {
      permissions: { include: { permission: true } },
      _count: { select: { assignments: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function createRole(auth: AuthContext, data: {
  name: string;
  description?: string;
  permissions: string[];
}) {
  const { organizationId, userId: actorId } = auth;
  assertGrantablePermissions(auth, data.permissions);
  const permissions = await prisma.permission.findMany({ where: { key: { in: data.permissions } } });
  const role = await prisma.role.create({
    data: {
      organizationId,
      name: data.name,
      description: data.description ?? null,
      permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
    },
    include: { permissions: { include: { permission: true } } },
  });
  await recordAudit({
    organizationId,
    userId: actorId,
    action: "role.created",
    entityType: "Role",
    entityId: role.id,
  });
  return role;
}

export async function updateRole(auth: AuthContext, id: string, data: {
  name?: string;
  description?: string;
  permissions?: string[];
}) {
  const { organizationId, userId: actorId } = auth;
  const existing = await findRoleInOrg(organizationId, id);
  assertGrantablePermissions(auth, await rolePermissionKeys(id));
  if (data.permissions) assertGrantablePermissions(auth, data.permissions);

  const role = await prisma.$transaction(async (tx) => {
    const updated = await tx.role.update({
      where: { id, organizationId },
      data: { name: data.name, description: data.description },
    });
    if (data.permissions) {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      const permissions = await tx.permission.findMany({ where: { key: { in: data.permissions } } });
      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: id, permissionId: p.id })),
      });
    }
    return updated;
  });

  await recordAudit({
    organizationId: existing.organizationId,
    userId: actorId,
    action: "role.permissions_changed",
    entityType: "Role",
    entityId: id,
    metadata: { permissions: data.permissions ?? [] },
  });
  return role;
}

export async function deleteRole(auth: AuthContext, id: string) {
  const { organizationId, userId: actorId } = auth;
  const existing = await findRoleInOrg(organizationId, id);
  if (existing.isSystem) throw ApiError.badRequest("System roles cannot be deleted");
  assertGrantablePermissions(auth, await rolePermissionKeys(id));
  await prisma.role.delete({ where: { id, organizationId } });
  await recordAudit({
    organizationId: existing.organizationId,
    userId: actorId,
    action: "role.deleted",
    entityType: "Role",
    entityId: id,
  });
  return { ok: true };
}

export async function assignRole(auth: AuthContext, data: {
  userId: string;
  roleId: string;
  departmentId?: string;
}) {
  const { organizationId, userId: actorId } = auth;
  await assertOrgRefs(organizationId, { user: data.userId, role: data.roleId, department: data.departmentId });
  assertGrantablePermissions(auth, await rolePermissionKeys(data.roleId));
  const assignment = await prisma.userRole.create({
    data: {
      userId: data.userId,
      roleId: data.roleId,
      departmentId: data.departmentId ?? null,
    },
  });
  await recordAudit({
    organizationId,
    userId: actorId,
    action: "role.assigned",
    entityType: "UserRole",
    entityId: assignment.id,
    metadata: { userId: data.userId, roleId: data.roleId },
  });
  return assignment;
}

export async function revokeAssignment(auth: AuthContext, assignmentId: string) {
  const { organizationId, userId: actorId } = auth;
  const assignment = await prisma.userRole.findUnique({ where: { id: assignmentId, role: { organizationId } } });
  if (!assignment) throw ApiError.notFound("Assignment not found");
  assertGrantablePermissions(auth, await rolePermissionKeys(assignment.roleId));
  await prisma.userRole.delete({ where: { id: assignmentId } });
  await recordAudit({
    organizationId,
    userId: actorId,
    action: "role.revoked",
    entityType: "UserRole",
    entityId: assignmentId,
  });
  return { ok: true };
}

export async function setSystemRole(auth: AuthContext, userId: string, systemRole: SystemRole) {
  const { organizationId, userId: actorId } = auth;
  const target = await prisma.user.findUnique({ where: { id: userId, organizationId } });
  if (!target) throw ApiError.notFound("Referenced user not found");
  if (target.id === actorId) throw ApiError.forbidden("You cannot change your own system role");
  // Both the new role and the user's current role must be within the
  // caller's privileges: an admin can neither promote above themselves
  // nor demote someone more privileged.
  if (!canGrantSystemRole(auth, systemRole) || !canGrantSystemRole(auth, target.systemRole)) {
    throw ApiError.forbidden("You cannot grant or change this system role");
  }
  const user = await prisma.user.update({
    where: { id: userId, organizationId },
    data: { systemRole },
    select: { id: true, email: true, systemRole: true, organizationId: true },
  });
  await recordAudit({
    organizationId: user.organizationId,
    userId: actorId,
    action: "user.system_role_changed",
    entityType: "User",
    entityId: userId,
    metadata: { systemRole },
  });
  return user;
}
