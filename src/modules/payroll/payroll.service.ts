import { type PayrollStatus, type Prisma } from "@prisma/client";
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

/**
 * Payroll records can only change while their period is a DRAFT: once
 * submitted, approved or paid, amounts are frozen (payslips are generated on
 * approval). Records have no organizationId column: scope through their period.
 */
async function assertRecordEditable(organizationId: string, id: string): Promise<void> {
  const record = await prisma.payrollRecord.findFirst({
    where: { id, period: { organizationId } },
    select: { period: { select: { status: true } } },
  });
  if (!record) throw ApiError.notFound("Payroll record not found");
  if (record.period.status !== "DRAFT") {
    throw ApiError.conflict("Payroll records can only be changed while the period is a draft");
  }
}

/**
 * Lifecycle: DRAFT -> PENDING_APPROVAL -> APPROVED -> PAID. The transition is
 * a conditional update on the expected current status, in the same
 * transaction as the records: concurrent or out-of-order calls (approving
 * twice, paying a draft) get a 409 instead of applying twice.
 */
async function transitionPeriod(
  organizationId: string,
  periodId: string,
  from: PayrollStatus,
  to: PayrollStatus,
  extra: Prisma.PayrollPeriodUpdateManyMutationInput = {}
) {
  await findPeriodInOrg(organizationId, periodId);
  return prisma.$transaction(async (tx) => {
    const moved = await tx.payrollPeriod.updateMany({
      where: { id: periodId, organizationId, status: from },
      data: { ...extra, status: to },
    });
    if (moved.count === 0) {
      throw ApiError.conflict(`The payroll period must be ${from} to become ${to}`);
    }
    await tx.payrollRecord.updateMany({ where: { periodId }, data: { status: to } });
    return tx.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
  });
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

export async function createPeriod(
  organizationId: string,
  data: {
    label: string;
    periodStart: string;
    periodEnd: string;
    payDate: string;
  },
  actorId: string
) {
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
  if (period.status !== "DRAFT") {
    throw ApiError.conflict("Payroll records can only be generated while the period is a draft");
  }

  const employees = await prisma.employee.findMany({
    where: {
      organizationId: period.organizationId,
      status: { in: ["ACTIVE", "ON_LEAVE"] },
      ...(employeeIds && employeeIds.length > 0 ? { id: { in: employeeIds } } : {}),
    },
    select: { id: true, baseSalary: true, currency: true },
  });

  // One statement instead of a lookup + insert per employee; existing
  // records (unique periodId + employeeId) are skipped, also under
  // concurrent calls.
  const { count } = await prisma.payrollRecord.createMany({
    data: employees.map((employee) => {
      const gross = toNumber(employee.baseSalary) / 12;
      return {
        periodId,
        employeeId: employee.id,
        grossSalary: gross,
        bonusTotal: 0,
        deductionTotal: 0,
        netSalary: gross,
        currency: employee.currency,
        status: "DRAFT" as const,
      };
    }),
    skipDuplicates: true,
  });

  await recordAudit({
    organizationId: period.organizationId,
    userId: actorId,
    action: "payroll.records_generated",
    entityType: "PayrollPeriod",
    entityId: periodId,
    metadata: { count },
  });

  return { generated: count };
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

/**
 * The bonus/deduction and the record totals are written in one transaction,
 * with atomic increments: concurrent additions can no longer overwrite each
 * other's totals (the previous recompute read then wrote the record).
 */
export async function addBonus(organizationId: string, recordId: string, data: { label: string; amount: number }) {
  await assertRecordEditable(organizationId, recordId);
  const [bonus] = await prisma.$transaction([
    prisma.bonus.create({ data: { payrollRecordId: recordId, label: data.label, amount: data.amount } }),
    prisma.payrollRecord.update({
      where: { id: recordId },
      data: { bonusTotal: { increment: data.amount }, netSalary: { increment: data.amount } },
    }),
  ]);
  return bonus;
}

export async function addDeduction(organizationId: string, recordId: string, data: { label: string; amount: number }) {
  await assertRecordEditable(organizationId, recordId);
  const [deduction] = await prisma.$transaction([
    prisma.deduction.create({ data: { payrollRecordId: recordId, label: data.label, amount: data.amount } }),
    prisma.payrollRecord.update({
      where: { id: recordId },
      data: { deductionTotal: { increment: data.amount }, netSalary: { decrement: data.amount } },
    }),
  ]);
  return deduction;
}

export async function submitForApproval(organizationId: string, periodId: string, actorId: string) {
  const period = await transitionPeriod(organizationId, periodId, "DRAFT", "PENDING_APPROVAL");
  await recordAudit({
    organizationId,
    userId: actorId,
    action: "payroll.submitted",
    entityType: "PayrollPeriod",
    entityId: periodId,
  });
  return period;
}

export async function approvePeriod(organizationId: string, periodId: string, actorId: string) {
  const updated = await transitionPeriod(organizationId, periodId, "PENDING_APPROVAL", "APPROVED", {
    approvedById: actorId,
    approvedAt: new Date(),
  });

  // Payslips are queued once, after the approval is committed.
  const records = await prisma.payrollRecord.findMany({ where: { periodId }, select: { id: true } });
  for (const record of records) {
    await enqueuePayslip({ payrollRecordId: record.id, organizationId });
  }

  await recordAudit({
    organizationId,
    userId: actorId,
    action: "payroll.approved",
    entityType: "PayrollPeriod",
    entityId: periodId,
  });

  return updated;
}

export async function markPaid(organizationId: string, periodId: string, actorId: string) {
  const period = await transitionPeriod(organizationId, periodId, "APPROVED", "PAID");
  await recordAudit({
    organizationId,
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
