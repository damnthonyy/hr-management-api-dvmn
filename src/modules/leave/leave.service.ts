import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/apiError";
import { parsePagination, buildMeta } from "../../utils/pagination";
import type { CalendarQuery, CreateLeaveTypeInput, ListLeaveRequestsQuery } from "./leave.validation";
import { recordAudit } from "../../services/audit.service";
import { enqueueNotification, enqueueEmail } from "../../queues";
import { assertOrgRefs } from "../../utils/tenant";
import { PERMISSIONS } from "../../config/permissions";
import type { AuthContext } from "../../types/express";

/** HR-level leave management, as opposed to self-service. */
function canManageLeave(auth: AuthContext): boolean {
  return auth.permissions.includes(PERMISSIONS.LEAVE_MANAGE);
}

function businessDays(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
  return days > 0 ? days : 1;
}

export async function listLeaveTypes(organizationId: string) {
  return prisma.leaveType.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
}

export async function createLeaveType(organizationId: string, data: CreateLeaveTypeInput) {
  return prisma.leaveType.create({
    data: {
      organizationId,
      name: data.name,
      code: data.code,
      defaultDays: data.defaultDays ?? 0,
      paid: data.paid ?? true,
      requiresApproval: data.requiresApproval ?? true,
    },
  });
}

export async function listRequests(organizationId: string, query: ListLeaveRequestsQuery) {
  const params = parsePagination(query);
  const where: Prisma.LeaveRequestWhereInput = { organizationId };
  if (query.status) where.status = query.status;
  if (query.employeeId) where.employeeId = query.employeeId;

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

export async function createRequest(auth: AuthContext, data: {
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason?: string;
}) {
  const { organizationId, userId: actorId } = auth;
  const employee = await prisma.employee.findUnique({ where: { id: data.employeeId, organizationId } });
  if (!employee) throw ApiError.notFound("Employee not found");
  if (employee.userId !== actorId && !canManageLeave(auth)) {
    throw ApiError.forbidden("You can only request leave for yourself");
  }
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

/** Moves a PENDING request to its decision, or throws 409 if it was decided in the meantime. */
async function claimPendingRequest(
  tx: Prisma.TransactionClient,
  id: string,
  organizationId: string,
  data: Prisma.LeaveRequestUncheckedUpdateManyInput
): Promise<void> {
  const claimed = await tx.leaveRequest.updateMany({ where: { id, organizationId, status: "PENDING" }, data });
  if (claimed.count === 0) throw ApiError.conflict("This leave request has already been decided");
}

/** Adds (or, with a negative value, gives back) used days on the balance of the request's year, if any. */
async function adjustBalance(
  tx: Prisma.TransactionClient,
  request: { employeeId: string; leaveTypeId: string; startDate: Date },
  days: Prisma.Decimal
): Promise<void> {
  await tx.leaveBalance.updateMany({
    where: {
      employeeId: request.employeeId,
      leaveTypeId: request.leaveTypeId,
      year: request.startDate.getFullYear(),
    },
    data: { usedDays: { increment: days } },
  });
}

export async function approveRequest(auth: AuthContext, id: string, note?: string) {
  const { organizationId, userId: approverUserId } = auth;
  const request = await prisma.leaveRequest.findUnique({
    where: { id, organizationId },
    include: { employee: true, leaveType: true },
  });
  if (!request) throw ApiError.notFound("Leave request not found");
  if (request.employee.userId === approverUserId) {
    throw ApiError.forbidden("You cannot approve your own leave request");
  }
  if (request.status !== "PENDING") {
    throw ApiError.badRequest("Only pending requests can be approved");
  }

  // The status change is conditional on PENDING and the balance is debited
  // in the same transaction: two concurrent approvals no longer debit the
  // balance twice.
  const updated = await prisma.$transaction(async (tx) => {
    await claimPendingRequest(tx, id, organizationId, {
      status: "APPROVED",
      approverId: approverUserId,
      decidedAt: new Date(),
      decisionNote: note ?? null,
    });
    await adjustBalance(tx, request, request.days);
    return tx.leaveRequest.findUniqueOrThrow({ where: { id } });
  });

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

export async function rejectRequest(auth: AuthContext, id: string, note?: string) {
  const { organizationId, userId: approverUserId } = auth;
  const request = await prisma.leaveRequest.findUnique({ where: { id, organizationId }, include: { employee: true } });
  if (!request) throw ApiError.notFound("Leave request not found");
  if (request.employee.userId === approverUserId) {
    throw ApiError.forbidden("You cannot reject your own leave request");
  }
  if (request.status !== "PENDING") {
    throw ApiError.badRequest("Only pending requests can be rejected");
  }
  const updated = await prisma.$transaction(async (tx) => {
    await claimPendingRequest(tx, id, organizationId, {
      status: "REJECTED",
      approverId: approverUserId,
      decidedAt: new Date(),
      decisionNote: note ?? null,
    });
    return tx.leaveRequest.findUniqueOrThrow({ where: { id } });
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

export async function cancelRequest(auth: AuthContext, id: string) {
  const { organizationId, userId: actorId } = auth;
  const request = await prisma.leaveRequest.findUnique({ where: { id, organizationId }, include: { employee: true } });
  if (!request) throw ApiError.notFound("Leave request not found");
  if (request.employee.userId !== actorId && !canManageLeave(auth)) {
    throw ApiError.forbidden("You can only cancel your own leave requests");
  }
  if (request.status === "REJECTED" || request.status === "CANCELED") {
    throw ApiError.badRequest("This leave request is already closed");
  }
  // Cancelling an approved request gives the days back to the balance. The
  // update is conditional on the status read above, so a concurrent decision
  // makes this call fail (409) instead of using a stale status.
  const updated = await prisma.$transaction(async (tx) => {
    const moved = await tx.leaveRequest.updateMany({
      where: { id, organizationId, status: request.status },
      data: { status: "CANCELED" },
    });
    if (moved.count === 0) throw ApiError.conflict("This leave request was modified concurrently, please retry");
    if (request.status === "APPROVED") await adjustBalance(tx, request, request.days.negated());
    return tx.leaveRequest.findUniqueOrThrow({ where: { id } });
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
  query: CalendarQuery
) {
  await assertOrgRefs(organizationId, { department: departmentId });
  const from = query.from ?? new Date();
  const to = query.to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
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
