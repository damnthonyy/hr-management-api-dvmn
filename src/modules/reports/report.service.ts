import { type Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { cacheGet, cacheSet } from "../../services/cache";

function toNumber(value: Prisma.Decimal | number | null): number {
  if (value === null) return 0;
  return typeof value === "number" ? value : Number(value.toString());
}

export async function employeeStatistics(organizationId: string) {
  const [total, byStatus, byDepartment] = await Promise.all([
    prisma.employee.count({ where: { organizationId } }),
    prisma.employee.groupBy({ by: ["status"], where: { organizationId }, _count: true }),
    prisma.employee.groupBy({ by: ["departmentId"], where: { organizationId }, _count: true }),
  ]);
  return { total, byStatus, byDepartment };
}

export async function departmentStatistics(organizationId: string) {
  const departments = await prisma.department.findMany({
    where: { organizationId },
    include: { _count: { select: { employees: true, teams: true } } },
  });
  return departments.map((d) => ({
    id: d.id,
    name: d.name,
    code: d.code,
    employees: d._count.employees,
    teams: d._count.teams,
  }));
}

export async function salarySummary(organizationId: string) {
  const cacheKey = `report:salary:${organizationId}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const employees = await prisma.employee.findMany({
    where: { organizationId },
    select: { baseSalary: true, currency: true, departmentId: true, jobTitle: true },
  });
  const salaries = employees.map((e) => toNumber(e.baseSalary));
  const total = salaries.reduce((sum, s) => sum + s, 0);
  const average = salaries.length > 0 ? total / salaries.length : 0;
  const max = salaries.length > 0 ? Math.max(...salaries) : 0;
  const min = salaries.length > 0 ? Math.min(...salaries) : 0;

  const result = { headcount: employees.length, total, average, max, min };
  await cacheSet(cacheKey, result, 60);
  return result;
}

export async function leaveStatistics(organizationId: string) {
  const byStatus = await prisma.leaveRequest.groupBy({
    by: ["status"],
    where: { organizationId },
    _count: true,
  });
  const byType = await prisma.leaveRequest.groupBy({
    by: ["leaveTypeId"],
    where: { organizationId },
    _count: true,
  });
  return { byStatus, byType };
}

export async function turnover(organizationId: string) {
  const now = new Date();
  const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const [hired, terminated, active] = await Promise.all([
    prisma.employee.count({ where: { organizationId, startDate: { gte: yearAgo } } }),
    prisma.employee.count({ where: { organizationId, terminationDate: { gte: yearAgo } } }),
    prisma.employee.count({ where: { organizationId, status: "ACTIVE" } }),
  ]);
  const rate = active > 0 ? terminated / active : 0;
  return { hired, terminated, active, turnoverRate: rate };
}

/** The salary summary is only included for callers with salary:view. */
export async function dashboard(organizationId: string, includeSalary: boolean) {
  const [employees, departments, pendingLeaves, openReviews, salary] = await Promise.all([
    prisma.employee.count({ where: { organizationId } }),
    prisma.department.count({ where: { organizationId } }),
    prisma.leaveRequest.count({ where: { organizationId, status: "PENDING" } }),
    prisma.performanceReview.count({ where: { employee: { organizationId }, status: { not: "FINALIZED" } } }),
    includeSalary ? salarySummary(organizationId) : Promise.resolve(undefined),
  ]);
  return { employees, departments, pendingLeaves, openReviews, salary };
}
