import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/apiError";
import { parsePagination, buildMeta, parseSort } from "../../utils/pagination";
import { randomToken } from "../../utils/tokens";
import { recordAudit } from "../../services/audit.service";
import { assertOrgRefs } from "../../utils/tenant";
import type { ListEmployeesQuery } from "./employee.validation";

/** Loads an employee of the given organization or throws 404. */
async function findEmployeeInOrg(organizationId: string, id: string) {
  const employee = await prisma.employee.findUnique({ where: { id, organizationId } });
  if (!employee) throw ApiError.notFound("Employee not found");
  return employee;
}

const SORTABLE = ["createdAt", "lastName", "startDate", "jobTitle", "baseSalary", "status"];

export async function listEmployees(organizationId: string, query: ListEmployeesQuery) {
  const params = parsePagination(query);
  const orderBy = parseSort(query.sort, SORTABLE, { createdAt: "desc" });

  const filters: Prisma.EmployeeWhereInput = { organizationId };
  if (query.departmentId) filters.departmentId = query.departmentId;
  if (query.status) filters.status = query.status;
  if (query.managerId) filters.managerId = query.managerId;
  if (query.search) {
    filters.OR = [
      { firstName: { contains: query.search, mode: "insensitive" } },
      { lastName: { contains: query.search, mode: "insensitive" } },
      { email: { contains: query.search, mode: "insensitive" } },
      { jobTitle: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.employee.findMany({
      where: filters,
      skip: params.skip,
      take: params.take,
      orderBy,
      include: {
        department: { select: { id: true, name: true, code: true } },
        team: { select: { id: true, name: true } },
        manager: { select: { id: true, firstName: true, lastName: true, jobTitle: true } },
      },
    }),
    prisma.employee.count({ where: filters }),
  ]);

  return { items, meta: buildMeta(params, total) };
}

export async function getEmployee(organizationId: string, id: string) {
  const employee = await prisma.employee.findUnique({
    where: { id, organizationId },
    include: {
      department: true,
      team: true,
      manager: { select: { id: true, firstName: true, lastName: true, jobTitle: true, email: true } },
      reports: { select: { id: true, firstName: true, lastName: true, jobTitle: true } },
      emergencyContacts: true,
      contracts: true,
      salaryHistory: { orderBy: { effectiveAt: "desc" } },
      leaveBalances: { include: { leaveType: true } },
      documents: true,
      user: { select: { id: true, email: true, systemRole: true, isActive: true, lastLoginAt: true } },
    },
  });
  if (!employee) throw ApiError.notFound("Employee not found");
  return employee;
}

export async function createEmployee(organizationId: string, data: Record<string, unknown>, actorId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { employeeLimit: true, _count: { select: { employees: true } } },
  });
  if (!organization) throw ApiError.notFound("Organization not found");
  if (organization._count.employees >= organization.employeeLimit) {
    throw ApiError.unprocessable("Organization employee limit reached");
  }
  await assertOrgRefs(organizationId, {
    department: data.departmentId as string | undefined,
    team: data.teamId as string | undefined,
    employee: data.managerId as string | undefined,
  });

  const employeeNumber =
    (data.employeeNumber as string) ?? `EMP-${randomToken(4).toUpperCase()}`;

  const employee = await prisma.employee.create({
    data: {
      organizationId,
      employeeNumber,
      firstName: data.firstName as string,
      lastName: data.lastName as string,
      email: data.email as string,
      phone: (data.phone as string) ?? null,
      dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth as string) : null,
      nationalId: (data.nationalId as string) ?? null,
      address: (data.address as string) ?? null,
      jobTitle: data.jobTitle as string,
      departmentId: (data.departmentId as string) ?? null,
      teamId: (data.teamId as string) ?? null,
      managerId: (data.managerId as string) ?? null,
      startDate: new Date(data.startDate as string),
      baseSalary: (data.baseSalary as number) ?? 0,
      currency: (data.currency as string) ?? "USD",
    },
  });

  await recordAudit({
    organizationId,
    userId: actorId,
    action: "employee.created",
    entityType: "Employee",
    entityId: employee.id,
  });

  return employee;
}

export async function updateEmployee(
  organizationId: string,
  id: string,
  data: Record<string, unknown>,
  actorId: string
) {
  const existing = await findEmployeeInOrg(organizationId, id);
  await assertOrgRefs(organizationId, {
    department: data.departmentId as string | undefined,
    team: data.teamId as string | undefined,
    employee: data.managerId as string | undefined,
  });

  const payload: Record<string, unknown> = { ...data };
  if (data.startDate) payload.startDate = new Date(data.startDate as string);
  if (data.dateOfBirth) payload.dateOfBirth = new Date(data.dateOfBirth as string);
  if (data.terminationDate) payload.terminationDate = new Date(data.terminationDate as string);

  const employee = await prisma.employee.update({
    where: { id, organizationId },
    data: payload as Prisma.EmployeeUpdateInput,
  });

  await recordAudit({
    organizationId: existing.organizationId,
    userId: actorId,
    action: "employee.updated",
    entityType: "Employee",
    entityId: id,
    metadata: data as Prisma.InputJsonValue,
  });

  return employee;
}

export async function deactivateEmployee(organizationId: string, id: string, actorId: string) {
  const existing = await findEmployeeInOrg(organizationId, id);
  const employee = await prisma.employee.update({
    where: { id, organizationId },
    data: { status: "TERMINATED", terminationDate: new Date() },
  });
  await recordAudit({
    organizationId: existing.organizationId,
    userId: actorId,
    action: "employee.deactivated",
    entityType: "Employee",
    entityId: id,
  });
  return employee;
}

export async function deleteEmployee(organizationId: string, id: string, actorId: string) {
  const existing = await findEmployeeInOrg(organizationId, id);
  await prisma.employee.delete({ where: { id, organizationId } });
  await recordAudit({
    organizationId: existing.organizationId,
    userId: actorId,
    action: "employee.deleted",
    entityType: "Employee",
    entityId: id,
  });
  return { ok: true };
}

export async function addEmergencyContact(
  organizationId: string,
  employeeId: string,
  data: Record<string, unknown>
) {
  await findEmployeeInOrg(organizationId, employeeId);
  return prisma.emergencyContact.create({
    data: {
      employeeId,
      name: data.name as string,
      relationship: data.relationship as string,
      phone: data.phone as string,
      email: (data.email as string) ?? null,
    },
  });
}

export async function listEmergencyContacts(organizationId: string, employeeId: string) {
  await findEmployeeInOrg(organizationId, employeeId);
  return prisma.emergencyContact.findMany({ where: { employeeId } });
}

export async function addContract(
  organizationId: string,
  employeeId: string,
  data: Record<string, unknown>,
  actorId: string
) {
  await findEmployeeInOrg(organizationId, employeeId);
  const contract = await prisma.employmentContract.create({
    data: {
      employeeId,
      contractType: data.contractType as never,
      title: data.title as string,
      startDate: new Date(data.startDate as string),
      endDate: data.endDate ? new Date(data.endDate as string) : null,
      salary: data.salary as number,
      currency: (data.currency as string) ?? "USD",
      weeklyHours: (data.weeklyHours as number) ?? 40,
    },
  });
  await recordAudit({
    organizationId,
    userId: actorId,
    action: "employee.contract_added",
    entityType: "EmploymentContract",
    entityId: contract.id,
  });
  return contract;
}

export async function listContracts(organizationId: string, employeeId: string) {
  await findEmployeeInOrg(organizationId, employeeId);
  return prisma.employmentContract.findMany({ where: { employeeId }, orderBy: { startDate: "desc" } });
}

export async function updateSalary(organizationId: string, employeeId: string, data: {
  newSalary: number;
  reason?: string;
  effectiveAt?: string;
}, actorId: string) {
  const employee = await findEmployeeInOrg(organizationId, employeeId);

  const result = await prisma.$transaction(async (tx) => {
    await tx.salaryHistory.create({
      data: {
        employeeId,
        previousSalary: employee.baseSalary,
        newSalary: data.newSalary,
        currency: employee.currency,
        effectiveAt: data.effectiveAt ? new Date(data.effectiveAt) : new Date(),
        reason: data.reason ?? null,
        changedById: actorId,
      },
    });
    return tx.employee.update({
      where: { id: employeeId },
      data: { baseSalary: data.newSalary },
    });
  });

  await recordAudit({
    organizationId: employee.organizationId,
    userId: actorId,
    action: "employee.salary_changed",
    entityType: "Employee",
    entityId: employeeId,
    metadata: { previous: employee.baseSalary.toString(), next: data.newSalary },
  });

  return result;
}

export async function listReports(organizationId: string, employeeId: string) {
  await findEmployeeInOrg(organizationId, employeeId);
  return prisma.employee.findMany({
    where: { managerId: employeeId, organizationId },
    select: { id: true, firstName: true, lastName: true, jobTitle: true, email: true, status: true },
  });
}

export async function salaryHistory(organizationId: string, employeeId: string) {
  await findEmployeeInOrg(organizationId, employeeId);
  return prisma.salaryHistory.findMany({
    where: { employeeId },
    orderBy: { effectiveAt: "desc" },
  });
}
