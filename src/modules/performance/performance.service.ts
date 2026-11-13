import { type Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/apiError";
import { recordAudit } from "../../services/audit.service";
import { assertOrgRefs } from "../../utils/tenant";
import { buildMeta, parsePagination } from "../../utils/pagination";
import type { ListReviewsQuery, UpdateObjectiveInput, UpdateReviewInput } from "./performance.validation";

/** Reviews and objectives have no organizationId column: scope through the employee. */
async function assertReviewInOrg(organizationId: string, id: string): Promise<void> {
  const count = await prisma.performanceReview.count({ where: { id, employee: { organizationId } } });
  if (count === 0) throw ApiError.notFound("Review not found");
}

async function assertObjectiveInOrg(organizationId: string, id: string): Promise<void> {
  const count = await prisma.objective.count({ where: { id, employee: { organizationId } } });
  if (count === 0) throw ApiError.notFound("Objective not found");
}

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

export async function listReviews(organizationId: string, query: ListReviewsQuery) {
  const where: Prisma.PerformanceReviewWhereInput = { employee: { organizationId } };
  if (query.cycleId) where.cycleId = query.cycleId;
  if (query.employeeId) where.employeeId = query.employeeId;
  const params = parsePagination(query);
  const [items, total] = await Promise.all([
    prisma.performanceReview.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, jobTitle: true } },
        cycle: { select: { id: true, name: true } },
        author: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: params.skip,
      take: params.take,
    }),
    prisma.performanceReview.count({ where }),
  ]);
  return { items, meta: buildMeta(params, total) };
}

export async function createReview(organizationId: string, data: {
  cycleId: string;
  employeeId: string;
  score?: number;
  summary?: string;
  feedback?: string;
}, authorId: string) {
  await assertOrgRefs(organizationId, { performanceCycle: data.cycleId, employee: data.employeeId });
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

export async function updateReview(organizationId: string, id: string, data: UpdateReviewInput) {
  await assertReviewInOrg(organizationId, id);
  const payload: Prisma.PerformanceReviewUpdateInput = { ...data };
  if (data.status === "SUBMITTED") payload.submittedAt = new Date();
  return prisma.performanceReview.update({ where: { id }, data: payload });
}

export async function getReview(organizationId: string, id: string) {
  const review = await prisma.performanceReview.findUnique({
    where: { id, employee: { organizationId } },
    include: { employee: true, cycle: true, author: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (!review) throw ApiError.notFound("Review not found");
  return review;
}

export async function listObjectives(organizationId: string, employeeId: string) {
  await assertOrgRefs(organizationId, { employee: employeeId });
  return prisma.objective.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } });
}

export async function createObjective(organizationId: string, data: {
  employeeId: string;
  title: string;
  description?: string;
  weight?: number;
  dueDate?: string;
}) {
  await assertOrgRefs(organizationId, { employee: data.employeeId });
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

export async function updateObjective(organizationId: string, id: string, data: UpdateObjectiveInput) {
  await assertObjectiveInOrg(organizationId, id);
  return prisma.objective.update({ where: { id }, data });
}

export async function deleteObjective(organizationId: string, id: string) {
  await assertObjectiveInOrg(organizationId, id);
  await prisma.objective.delete({ where: { id } });
  return { ok: true };
}
