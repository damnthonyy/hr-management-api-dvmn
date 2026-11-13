import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/apiError";
import { ALL_PERMISSIONS } from "../../config/permissions";
import { recordAudit } from "../../services/audit.service";
import { assertOrgRefs } from "../../utils/tenant";

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

export async function createRole(organizationId: string, data: {
  name: string;
  description?: string;
  permissions: string[];
}, actorId: string) {
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

export async function updateRole(organizationId: string, id: string, data: {
  name?: string;
  description?: string;
  permissions?: string[];
}, actorId: string) {
  const existing = await findRoleInOrg(organizationId, id);

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

export async function deleteRole(organizationId: string, id: string, actorId: string) {
  const existing = await findRoleInOrg(organizationId, id);
  if (existing.isSystem) throw ApiError.badRequest("System roles cannot be deleted");
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

export async function assignRole(organizationId: string, data: {
  userId: string;
  roleId: string;
  departmentId?: string;
}, actorId: string) {
  await assertOrgRefs(organizationId, { user: data.userId, role: data.roleId, department: data.departmentId });
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

export async function revokeAssignment(organizationId: string, assignmentId: string, actorId: string) {
  const assignment = await prisma.userRole.findUnique({ where: { id: assignmentId, role: { organizationId } } });
  if (!assignment) throw ApiError.notFound("Assignment not found");
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

export async function setSystemRole(organizationId: string, userId: string, systemRole: string, actorId: string) {
  await assertOrgRefs(organizationId, { user: userId });
  const user = await prisma.user.update({
    where: { id: userId, organizationId },
    data: { systemRole: systemRole as never },
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
