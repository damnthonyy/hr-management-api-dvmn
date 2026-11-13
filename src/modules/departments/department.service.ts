import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/apiError";
import { parsePagination, buildMeta } from "../../utils/pagination";
import { recordAudit } from "../../services/audit.service";

export async function listDepartments(organizationId: string, query: Record<string, unknown>) {
  const params = parsePagination(query);
  const [items, total] = await Promise.all([
    prisma.department.findMany({
      where: { organizationId },
      skip: params.skip,
      take: params.take,
      orderBy: { name: "asc" },
      include: {
        manager: { select: { id: true, firstName: true, lastName: true } },
        parent: { select: { id: true, name: true } },
        _count: { select: { employees: true, teams: true, children: true } },
      },
    }),
    prisma.department.count({ where: { organizationId } }),
  ]);
  return { items, meta: buildMeta(params, total) };
}

export async function getDepartment(id: string) {
  const department = await prisma.department.findUnique({
    where: { id },
    include: {
      manager: true,
      parent: true,
      children: true,
      teams: { include: { lead: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { members: true } } } },
      employees: { select: { id: true, firstName: true, lastName: true, jobTitle: true, status: true } },
    },
  });
  if (!department) throw ApiError.notFound("Department not found");
  return department;
}

export async function createDepartment(organizationId: string, data: Record<string, unknown>, actorId: string) {
  const department = await prisma.department.create({
    data: {
      organizationId,
      name: data.name as string,
      code: data.code as string,
      description: (data.description as string) ?? null,
      parentId: (data.parentId as string) ?? null,
      managerId: (data.managerId as string) ?? null,
    },
  });
  await recordAudit({
    organizationId,
    userId: actorId,
    action: "department.created",
    entityType: "Department",
    entityId: department.id,
  });
  return department;
}

export async function updateDepartment(id: string, data: Record<string, unknown>, actorId: string) {
  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Department not found");
  const department = await prisma.department.update({ where: { id }, data });
  await recordAudit({
    organizationId: existing.organizationId,
    userId: actorId,
    action: "department.updated",
    entityType: "Department",
    entityId: id,
  });
  return department;
}

export async function deleteDepartment(id: string, actorId: string) {
  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Department not found");
  await prisma.department.delete({ where: { id } });
  await recordAudit({
    organizationId: existing.organizationId,
    userId: actorId,
    action: "department.deleted",
    entityType: "Department",
    entityId: id,
  });
  return { ok: true };
}

export async function assignManager(id: string, managerId: string, actorId: string) {
  const department = await prisma.department.update({
    where: { id },
    data: { managerId },
  });
  await recordAudit({
    organizationId: department.organizationId,
    userId: actorId,
    action: "department.manager_assigned",
    entityType: "Department",
    entityId: id,
    metadata: { managerId },
  });
  return department;
}

export async function assignEmployee(id: string, employeeId: string) {
  return prisma.employee.update({
    where: { id: employeeId },
    data: { departmentId: id },
  });
}

export async function transferEmployee(employeeId: string, targetDepartmentId: string, actorId: string) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw ApiError.notFound("Employee not found");
  const updated = await prisma.employee.update({
    where: { id: employeeId },
    data: { departmentId: targetDepartmentId },
  });
  await recordAudit({
    organizationId: employee.organizationId,
    userId: actorId,
    action: "employee.transferred",
    entityType: "Employee",
    entityId: employeeId,
    metadata: { from: employee.departmentId, to: targetDepartmentId },
  });
  return updated;
}

export async function listTeams(organizationId: string, query: Record<string, unknown>) {
  const where = { organizationId } as Record<string, unknown>;
  if (typeof query.departmentId === "string") where.departmentId = query.departmentId;
  return prisma.team.findMany({
    where,
    include: {
      department: { select: { id: true, name: true } },
      lead: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { members: true } },
    },
  });
}

export async function createTeam(organizationId: string, data: Record<string, unknown>) {
  return prisma.team.create({
    data: {
      organizationId,
      departmentId: data.departmentId as string,
      name: data.name as string,
      leadId: (data.leadId as string) ?? null,
    },
  });
}

export async function updateTeam(id: string, data: Record<string, unknown>) {
  return prisma.team.update({ where: { id }, data });
}

export async function deleteTeam(id: string) {
  await prisma.team.delete({ where: { id } });
  return { ok: true };
}

export async function addTeamMember(teamId: string, employeeId: string) {
  return prisma.employee.update({ where: { id: employeeId }, data: { teamId } });
}

export async function removeTeamMember(employeeId: string) {
  return prisma.employee.update({ where: { id: employeeId }, data: { teamId: null } });
}
