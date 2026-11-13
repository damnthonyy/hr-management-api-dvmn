import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/apiError";
import { recordAudit } from "../../services/audit.service";

export async function listCycles(organizationId: string) {
  return prisma.performanceCycle.findMany({
    where: { organizationId },
    orderBy: { startDate: "desc" },
    include: { _count: { select: { reviews: true } } },
  });
}

export async function createCycle(organizationId: string, data: {
  name: string;
  startDate: string;
  endDate: string;
}) {
  return prisma.performanceCycle.create({
    data: {
      organizationId,
      name: data.name,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
    },
  });
}

export async function listReviews(organizationId: string, query: Record<string, unknown>) {
  const where: Record<string, unknown> = { employee: { organizationId } };
  if (typeof query.cycleId === "string") where.cycleId = query.cycleId;
  if (typeof query.employeeId === "string") where.employeeId = query.employeeId;
  return prisma.performanceReview.findMany({
    where,
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, jobTitle: true } },
      cycle: { select: { id: true, name: true } },
      author: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createReview(data: {
  cycleId: string;
  employeeId: string;
  score?: number;
  summary?: string;
  feedback?: string;
}, authorId: string, organizationId: string) {
  const review = await prisma.performanceReview.create({
    data: {
      cycleId: data.cycleId,
      employeeId: data.employeeId,
      authorId,
      score: data.score ?? null,
      summary: data.summary ?? null,
      feedback: data.feedback ?? null,
      status: "DRAFT",
    },
  });
  await recordAudit({
    organizationId,
    userId: authorId,
    action: "performance.review_created",
    entityType: "PerformanceReview",
    entityId: review.id,
  });
  return review;
}

export async function updateReview(id: string, data: Record<string, unknown>) {
  const existing = await prisma.performanceReview.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Review not found");
  const payload: Record<string, unknown> = { ...data };
  if (data.status === "SUBMITTED") payload.submittedAt = new Date();
  return prisma.performanceReview.update({ where: { id }, data: payload });
}

export async function getReview(id: string) {
  const review = await prisma.performanceReview.findUnique({
    where: { id },
    include: { employee: true, cycle: true, author: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (!review) throw ApiError.notFound("Review not found");
  return review;
}

export async function listObjectives(employeeId: string) {
  return prisma.objective.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } });
}

export async function createObjective(data: {
  employeeId: string;
  title: string;
  description?: string;
  weight?: number;
  dueDate?: string;
}) {
  return prisma.objective.create({
    data: {
      employeeId: data.employeeId,
      title: data.title,
      description: data.description ?? null,
      weight: data.weight ?? 0,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
    },
  });
}

export async function updateObjective(id: string, data: Record<string, unknown>) {
  return prisma.objective.update({ where: { id }, data });
}

export async function deleteObjective(id: string) {
  await prisma.objective.delete({ where: { id } });
  return { ok: true };
}
