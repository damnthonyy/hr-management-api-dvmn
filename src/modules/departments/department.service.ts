import { type Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/apiError";
import { parsePagination, buildMeta } from "../../utils/pagination";
import type {
  CreateDepartmentInput,
  CreateTeamInput,
  ListDepartmentsQuery,
  ListTeamsQuery,
  UpdateDepartmentInput,
  UpdateTeamInput,
} from "./department.validation";
import { recordAudit } from "../../services/audit.service";
import { assertOrgRefs } from "../../utils/tenant";

async function findDepartmentInOrg(organizationId: string, id: string) {
  const department = await prisma.department.findUnique({ where: { id, organizationId } });
  if (!department) throw ApiError.notFound("Department not found");
  return department;
}

async function findTeamInOrg(organizationId: string, id: string) {
  const team = await prisma.team.findUnique({ where: { id, organizationId } });
  if (!team) throw ApiError.notFound("Team not found");
  return team;
}

async function findEmployeeInOrg(organizationId: string, id: string) {
  const employee = await prisma.employee.findUnique({ where: { id, organizationId } });
  if (!employee) throw ApiError.notFound("Employee not found");
  return employee;
}

export async function listDepartments(organizationId: string, query: ListDepartmentsQuery) {
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

export async function getDepartment(organizationId: string, id: string) {
  const department = await prisma.department.findUnique({
    where: { id, organizationId },
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

export async function createDepartment(organizationId: string, data: CreateDepartmentInput, actorId: string) {
  await assertOrgRefs(organizationId, { department: data.parentId, employee: data.managerId });
  const department = await prisma.department.create({
    data: {
      organizationId,
      name: data.name,
      code: data.code,
      description: data.description ?? null,
      parentId: data.parentId ?? null,
      managerId: data.managerId ?? null,
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

export async function updateDepartment(
  organizationId: string,
  id: string,
  data: UpdateDepartmentInput,
  actorId: string
) {
  await findDepartmentInOrg(organizationId, id);
  await assertOrgRefs(organizationId, { department: data.parentId, employee: data.managerId });
  const department = await prisma.department.update({ where: { id, organizationId }, data });
  await recordAudit({
    organizationId,
    userId: actorId,
    action: "department.updated",
    entityType: "Department",
    entityId: id,
  });
  return department;
}

export async function deleteDepartment(organizationId: string, id: string, actorId: string) {
  await findDepartmentInOrg(organizationId, id);
  await prisma.department.delete({ where: { id, organizationId } });
  await recordAudit({
    organizationId,
    userId: actorId,
    action: "department.deleted",
    entityType: "Department",
    entityId: id,
  });
  return { ok: true };
}

export async function assignManager(organizationId: string, id: string, managerId: string, actorId: string) {
  await findDepartmentInOrg(organizationId, id);
  await assertOrgRefs(organizationId, { employee: managerId });
  const department = await prisma.department.update({
    where: { id, organizationId },
    data: { managerId },
  });
  await recordAudit({
    organizationId,
    userId: actorId,
    action: "department.manager_assigned",
    entityType: "Department",
    entityId: id,
    metadata: { managerId },
  });
  return department;
}

export async function assignEmployee(organizationId: string, id: string, employeeId: string) {
  await findDepartmentInOrg(organizationId, id);
  await findEmployeeInOrg(organizationId, employeeId);
  return prisma.employee.update({
    where: { id: employeeId, organizationId },
    data: { departmentId: id },
  });
}

export async function transferEmployee(
  organizationId: string,
  employeeId: string,
  targetDepartmentId: string,
  actorId: string
) {
  const employee = await findEmployeeInOrg(organizationId, employeeId);
  await findDepartmentInOrg(organizationId, targetDepartmentId);
  const updated = await prisma.employee.update({
    where: { id: employeeId, organizationId },
    data: { departmentId: targetDepartmentId },
  });
  await recordAudit({
    organizationId,
    userId: actorId,
    action: "employee.transferred",
    entityType: "Employee",
    entityId: employeeId,
    metadata: { from: employee.departmentId, to: targetDepartmentId },
  });
  return updated;
}

export async function listTeams(organizationId: string, query: ListTeamsQuery) {
  const where: Prisma.TeamWhereInput = { organizationId };
  if (query.departmentId) where.departmentId = query.departmentId;
  return prisma.team.findMany({
    where,
    include: {
      department: { select: { id: true, name: true } },
      lead: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { members: true } },
    },
  });
}

export async function createTeam(organizationId: string, data: CreateTeamInput) {
  await assertOrgRefs(organizationId, { department: data.departmentId, employee: data.leadId });
  return prisma.team.create({
    data: {
      organizationId,
      departmentId: data.departmentId,
      name: data.name,
      leadId: data.leadId ?? null,
    },
  });
}

export async function updateTeam(organizationId: string, id: string, data: UpdateTeamInput) {
  await findTeamInOrg(organizationId, id);
  await assertOrgRefs(organizationId, { employee: data.leadId });
  return prisma.team.update({ where: { id, organizationId }, data });
}

export async function deleteTeam(organizationId: string, id: string) {
  await findTeamInOrg(organizationId, id);
  await prisma.team.delete({ where: { id, organizationId } });
  return { ok: true };
}

export async function addTeamMember(organizationId: string, teamId: string, employeeId: string) {
  await findTeamInOrg(organizationId, teamId);
  await findEmployeeInOrg(organizationId, employeeId);
  return prisma.employee.update({ where: { id: employeeId, organizationId }, data: { teamId } });
}

export async function removeTeamMember(organizationId: string, employeeId: string) {
  await findEmployeeInOrg(organizationId, employeeId);
  return prisma.employee.update({ where: { id: employeeId, organizationId }, data: { teamId: null } });
}
