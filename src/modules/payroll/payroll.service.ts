import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/apiError";
import { parsePagination, buildMeta } from "../../utils/pagination";
import type { ListPayrollQuery } from "./payroll.validation";
import { recordAudit } from "../../services/audit.service";
import { enqueuePayslip } from "../../queues";

function toNumber(value: Prisma.Decimal | number): number {
  return typeof value === "number" ? value : Number(value.toString());
}

async function findPeriodInOrg(organizationId: string, id: string) {
  const period = await prisma.payrollPeriod.findUnique({ where: { id, organizationId } });
  if (!period) throw ApiError.notFound("Payroll period not found");
  return period;
}

/** Payroll records have no organizationId column: scope through their period. */
async function assertRecordInOrg(organizationId: string, id: string): Promise<void> {
  const count = await prisma.payrollRecord.count({ where: { id, period: { organizationId } } });
  if (count === 0) throw ApiError.notFound("Payroll record not found");
}

export async function listPeriods(organizationId: string, query: ListPayrollQuery) {
  const params = parsePagination(query);
  const [items, total] = await Promise.all([
    prisma.payrollPeriod.findMany({
      where: { organizationId },
      skip: params.skip,
      take: params.take,
      orderBy: { periodStart: "desc" },
      include: { _count: { select: { records: true } } },
    }),
    prisma.payrollPeriod.count({ where: { organizationId } }),
  ]);
  return { items, meta: buildMeta(params, total) };
}

export async function createPeriod(organizationId: string, data: {
  label: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
}, actorId: string) {
  const period = await prisma.payrollPeriod.create({
    data: {
      organizationId,
      label: data.label,
      periodStart: new Date(data.periodStart),
      periodEnd: new Date(data.periodEnd),
      payDate: new Date(data.payDate),
      status: "DRAFT",
    },
  });
  await recordAudit({
    organizationId,
    userId: actorId,
    action: "payroll.period_created",
    entityType: "PayrollPeriod",
    entityId: period.id,
  });
  return period;
}

export async function generateRecords(
  organizationId: string,
  periodId: string,
  employeeIds: string[] | undefined,
  actorId: string
) {
  const period = await findPeriodInOrg(organizationId, periodId);

  const employees = await prisma.employee.findMany({
    where: {
      organizationId: period.organizationId,
      status: { in: ["ACTIVE", "ON_LEAVE"] },
      ...(employeeIds && employeeIds.length > 0 ? { id: { in: employeeIds } } : {}),
    },
  });

  const created = [];
  for (const employee of employees) {
    const gross = toNumber(employee.baseSalary) / 12;
    const existing = await prisma.payrollRecord.findUnique({
      where: { periodId_employeeId: { periodId, employeeId: employee.id } },
    });
    if (existing) continue;
    const record = await prisma.payrollRecord.create({
      data: {
        periodId,
        employeeId: employee.id,
        grossSalary: gross,
        bonusTotal: 0,
        deductionTotal: 0,
        netSalary: gross,
        currency: employee.currency,
        status: "DRAFT",
      },
    });
    created.push(record);
  }

  await recordAudit({
    organizationId: period.organizationId,
    userId: actorId,
    action: "payroll.records_generated",
    entityType: "PayrollPeriod",
    entityId: periodId,
    metadata: { count: created.length },
  });

  return { generated: created.length };
}

export async function listRecords(organizationId: string, periodId: string, query: ListPayrollQuery) {
  await findPeriodInOrg(organizationId, periodId);
  const params = parsePagination(query);
  const [items, total] = await Promise.all([
    prisma.payrollRecord.findMany({
      where: { periodId },
      skip: params.skip,
      take: params.take,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, jobTitle: true } },
        bonuses: true,
        deductions: true,
      },
    }),
    prisma.payrollRecord.count({ where: { periodId } }),
  ]);
  return { items, meta: buildMeta(params, total) };
}

export async function getRecord(organizationId: string, id: string) {
  const record = await prisma.payrollRecord.findUnique({
    where: { id, period: { organizationId } },
    include: { employee: true, bonuses: true, deductions: true, period: true },
  });
  if (!record) throw ApiError.notFound("Payroll record not found");
  return record;
}

async function recomputeRecord(recordId: string) {
  const record = await prisma.payrollRecord.findUnique({
    where: { id: recordId },
    include: { bonuses: true, deductions: true },
  });
  if (!record) return;
  const bonusTotal = record.bonuses.reduce((sum, b) => sum + toNumber(b.amount), 0);
  const deductionTotal = record.deductions.reduce((sum, d) => sum + toNumber(d.amount), 0);
  const net = toNumber(record.grossSalary) + bonusTotal - deductionTotal;
  await prisma.payrollRecord.update({
    where: { id: recordId },
    data: { bonusTotal, deductionTotal, netSalary: net },
  });
}

export async function addBonus(organizationId: string, recordId: string, data: { label: string; amount: number }) {
  await assertRecordInOrg(organizationId, recordId);
  const bonus = await prisma.bonus.create({
    data: { payrollRecordId: recordId, label: data.label, amount: data.amount },
  });
  await recomputeRecord(recordId);
  return bonus;
}

export async function addDeduction(organizationId: string, recordId: string, data: { label: string; amount: number }) {
  await assertRecordInOrg(organizationId, recordId);
  const deduction = await prisma.deduction.create({
    data: { payrollRecordId: recordId, label: data.label, amount: data.amount },
  });
  await recomputeRecord(recordId);
  return deduction;
}

export async function submitForApproval(organizationId: string, periodId: string, actorId: string) {
  await findPeriodInOrg(organizationId, periodId);
  const period = await prisma.payrollPeriod.update({
    where: { id: periodId, organizationId },
    data: { status: "PENDING_APPROVAL" },
  });
  await prisma.payrollRecord.updateMany({
    where: { periodId },
    data: { status: "PENDING_APPROVAL" },
  });
  await recordAudit({
    organizationId: period.organizationId,
    userId: actorId,
    action: "payroll.submitted",
    entityType: "PayrollPeriod",
    entityId: periodId,
  });
  return period;
}

export async function approvePeriod(organizationId: string, periodId: string, actorId: string) {
  const period = await findPeriodInOrg(organizationId, periodId);

  const updated = await prisma.payrollPeriod.update({
    where: { id: periodId, organizationId },
    data: { status: "APPROVED", approvedById: actorId, approvedAt: new Date() },
  });
  await prisma.payrollRecord.updateMany({
    where: { periodId },
    data: { status: "APPROVED" },
  });

  const records = await prisma.payrollRecord.findMany({ where: { periodId }, select: { id: true } });
  for (const record of records) {
    await enqueuePayslip({ payrollRecordId: record.id, organizationId: period.organizationId });
  }

  await recordAudit({
    organizationId: period.organizationId,
    userId: actorId,
    action: "payroll.approved",
    entityType: "PayrollPeriod",
    entityId: periodId,
  });

  return updated;
}

export async function markPaid(organizationId: string, periodId: string, actorId: string) {
  await findPeriodInOrg(organizationId, periodId);
  const period = await prisma.payrollPeriod.update({
    where: { id: periodId, organizationId },
    data: { status: "PAID" },
  });
  await prisma.payrollRecord.updateMany({ where: { periodId }, data: { status: "PAID" } });
  await recordAudit({
    organizationId: period.organizationId,
    userId: actorId,
    action: "payroll.paid",
    entityType: "PayrollPeriod",
    entityId: periodId,
  });
  return period;
}

export async function payrollReport(organizationId: string, periodId: string) {
  await findPeriodInOrg(organizationId, periodId);
  const records = await prisma.payrollRecord.findMany({
    where: { periodId, period: { organizationId } },
    include: { employee: { select: { firstName: true, lastName: true, departmentId: true } } },
  });
  const totalGross = records.reduce((sum, r) => sum + toNumber(r.grossSalary), 0);
  const totalNet = records.reduce((sum, r) => sum + toNumber(r.netSalary), 0);
  const totalBonus = records.reduce((sum, r) => sum + toNumber(r.bonusTotal), 0);
  const totalDeductions = records.reduce((sum, r) => sum + toNumber(r.deductionTotal), 0);
  return { count: records.length, totalGross, totalNet, totalBonus, totalDeductions, records };
}
