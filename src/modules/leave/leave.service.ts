import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/apiError";
import { parsePagination, buildMeta } from "../../utils/pagination";
import { recordAudit } from "../../services/audit.service";
import { enqueueNotification, enqueueEmail } from "../../queues";
import { assertOrgRefs } from "../../utils/tenant";

function businessDays(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
  return days > 0 ? days : 1;
}

export async function listLeaveTypes(organizationId: string) {
  return prisma.leaveType.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
}

export async function createLeaveType(organizationId: string, data: Record<string, unknown>) {
  return prisma.leaveType.create({
    data: {
      organizationId,
      name: data.name as string,
      code: data.code as string,
      defaultDays: (data.defaultDays as number) ?? 0,
      paid: (data.paid as boolean) ?? true,
      requiresApproval: (data.requiresApproval as boolean) ?? true,
    },
  });
}

export async function listRequests(organizationId: string, query: Record<string, unknown>) {
  const params = parsePagination(query);
  const where: Prisma.LeaveRequestWhereInput = { organizationId };
  if (typeof query.status === "string") where.status = query.status as never;
  if (typeof query.employeeId === "string") where.employeeId = query.employeeId;

  const [items, total] = await Promise.all([
    prisma.leaveRequest.findMany({
      where,
      skip: params.skip,
      take: params.take,
      orderBy: { createdAt: "desc" },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, departmentId: true } },
        leaveType: { select: { id: true, name: true, code: true } },
        approver: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.leaveRequest.count({ where }),
  ]);
  return { items, meta: buildMeta(params, total) };
}

export async function createRequest(organizationId: string, data: {
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason?: string;
}, actorId: string) {
  const employee = await prisma.employee.findUnique({ where: { id: data.employeeId, organizationId } });
  if (!employee) throw ApiError.notFound("Employee not found");
  await assertOrgRefs(organizationId, { leaveType: data.leaveTypeId });

  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  if (end.getTime() < start.getTime()) {
    throw ApiError.badRequest("End date must be after start date");
  }
  const days = businessDays(start, end);

  const request = await prisma.leaveRequest.create({
    data: {
      organizationId,
      employeeId: data.employeeId,
      leaveTypeId: data.leaveTypeId,
      startDate: start,
      endDate: end,
      days,
      reason: data.reason ?? null,
      status: "PENDING",
    },
  });

  if (employee.managerId) {
    const managerUser = await prisma.employee.findUnique({
      where: { id: employee.managerId, organizationId },
      select: { userId: true },
    });
    if (managerUser?.userId) {
      await enqueueNotification({
        organizationId,
        userId: managerUser.userId,
        type: "leave.requested",
        title: "New leave request",
        body: `${employee.firstName} ${employee.lastName} requested ${days} day(s) of leave`,
        data: { requestId: request.id },
      });
    }
  }

  await recordAudit({
    organizationId,
    userId: actorId,
    action: "leave.requested",
    entityType: "LeaveRequest",
    entityId: request.id,
  });

  return request;
}

export async function approveRequest(organizationId: string, id: string, approverUserId: string, note?: string) {
  const request = await prisma.leaveRequest.findUnique({
    where: { id, organizationId },
    include: { employee: true, leaveType: true },
  });
  if (!request) throw ApiError.notFound("Leave request not found");
  if (request.status !== "PENDING") {
    throw ApiError.badRequest("Only pending requests can be approved");
  }

  const year = request.startDate.getFullYear();
  const balance = await prisma.leaveBalance.findUnique({
    where: {
      employeeId_leaveTypeId_year: {
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        year,
      },
    },
  });

  const updated = await prisma.leaveRequest.update({
    where: { id, organizationId },
    data: {
      status: "APPROVED",
      approverId: approverUserId,
      decidedAt: new Date(),
      decisionNote: note ?? null,
    },
  });

  if (balance) {
    await prisma.leaveBalance.update({
      where: { id: balance.id },
      data: { usedDays: { increment: request.days } },
    });
  }

  if (request.employee.userId) {
    await enqueueNotification({
      organizationId: request.organizationId,
      userId: request.employee.userId,
      type: "leave.approved",
      title: "Leave approved",
      body: `Your leave request for ${request.days} day(s) was approved`,
      data: { requestId: id },
    });
    await enqueueEmail({
      to: request.employee.email,
      subject: "Your leave request was approved",
      template: "leave_approved",
      context: { days: request.days.toString(), start: request.startDate.toISOString() },
    });
  }

  await recordAudit({
    organizationId: request.organizationId,
    userId: approverUserId,
    action: "leave.approved",
    entityType: "LeaveRequest",
    entityId: id,
  });

  return updated;
}

export async function rejectRequest(organizationId: string, id: string, approverUserId: string, note?: string) {
  const request = await prisma.leaveRequest.findUnique({ where: { id, organizationId }, include: { employee: true } });
  if (!request) throw ApiError.notFound("Leave request not found");
  if (request.status !== "PENDING") {
    throw ApiError.badRequest("Only pending requests can be rejected");
  }
  const updated = await prisma.leaveRequest.update({
    where: { id, organizationId },
    data: { status: "REJECTED", approverId: approverUserId, decidedAt: new Date(), decisionNote: note ?? null },
  });
  if (request.employee.userId) {
    await enqueueNotification({
      organizationId: request.organizationId,
      userId: request.employee.userId,
      type: "leave.rejected",
      title: "Leave rejected",
      data: { requestId: id },
    });
  }
  await recordAudit({
    organizationId: request.organizationId,
    userId: approverUserId,
    action: "leave.rejected",
    entityType: "LeaveRequest",
    entityId: id,
  });
  return updated;
}

export async function cancelRequest(organizationId: string, id: string, actorId: string) {
  const request = await prisma.leaveRequest.findUnique({ where: { id, organizationId } });
  if (!request) throw ApiError.notFound("Leave request not found");
  const updated = await prisma.leaveRequest.update({
    where: { id, organizationId },
    data: { status: "CANCELED" },
  });
  await recordAudit({
    organizationId: request.organizationId,
    userId: actorId,
    action: "leave.canceled",
    entityType: "LeaveRequest",
    entityId: id,
  });
  return updated;
}

export async function setBalance(organizationId: string, data: {
  employeeId: string;
  leaveTypeId: string;
  year: number;
  entitledDays: number;
}) {
  await assertOrgRefs(organizationId, { employee: data.employeeId, leaveType: data.leaveTypeId });
  return prisma.leaveBalance.upsert({
    where: {
      employeeId_leaveTypeId_year: {
        employeeId: data.employeeId,
        leaveTypeId: data.leaveTypeId,
        year: data.year,
      },
    },
    update: { entitledDays: data.entitledDays },
    create: {
      employeeId: data.employeeId,
      leaveTypeId: data.leaveTypeId,
      year: data.year,
      entitledDays: data.entitledDays,
    },
  });
}

export async function listBalances(organizationId: string, employeeId: string) {
  await assertOrgRefs(organizationId, { employee: employeeId });
  return prisma.leaveBalance.findMany({
    where: { employeeId },
    include: { leaveType: true },
  });
}

export async function employeeHistory(organizationId: string, employeeId: string) {
  await assertOrgRefs(organizationId, { employee: employeeId });
  return prisma.leaveRequest.findMany({
    where: { employeeId, organizationId },
    include: { leaveType: true },
    orderBy: { startDate: "desc" },
  });
}

export async function departmentCalendar(
  organizationId: string,
  departmentId: string,
  query: Record<string, unknown>
) {
  await assertOrgRefs(organizationId, { department: departmentId });
  const from = typeof query.from === "string" ? new Date(query.from) : new Date();
  const to = typeof query.to === "string" ? new Date(query.to) : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  return prisma.leaveRequest.findMany({
    where: {
      organizationId,
      status: "APPROVED",
      employee: { departmentId },
      startDate: { lte: to },
      endDate: { gte: from },
    },
    include: { employee: { select: { id: true, firstName: true, lastName: true } }, leaveType: true },
    orderBy: { startDate: "asc" },
  });
}
