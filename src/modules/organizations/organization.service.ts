import { Prisma, SystemRole } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/apiError";
import { slugify } from "../../utils/slug";
import { randomToken } from "../../utils/tokens";
import { hashPassword } from "../../utils/password";
import { parsePagination, buildMeta } from "../../utils/pagination";
import { recordAudit } from "../../services/audit.service";
import { cacheGet, cacheSet, cacheDelete } from "../../services/cache";

export async function listOrganizations(query: Record<string, unknown>) {
  const params = parsePagination(query);
  const search = typeof query.search === "string" ? query.search : undefined;
  const where: Prisma.OrganizationWhereInput = search
    ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { slug: { contains: search, mode: "insensitive" } }] }
    : {};
  const [items, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      skip: params.skip,
      take: params.take,
      orderBy: { createdAt: "desc" },
      include: { subscription: true, _count: { select: { users: true, employees: true } } },
    }),
    prisma.organization.count({ where }),
  ]);
  return { items, meta: buildMeta(params, total) };
}

export async function createOrganization(data: {
  name: string;
  legalName?: string;
  domain?: string;
  timezone?: string;
  currency?: string;
  employeeLimit?: number;
}, actorId: string) {
  const slug = `${slugify(data.name)}-${randomToken(3)}`;
  const organization = await prisma.organization.create({
    data: {
      name: data.name,
      slug,
      legalName: data.legalName,
      domain: data.domain,
      timezone: data.timezone ?? "UTC",
      currency: data.currency ?? "USD",
      employeeLimit: data.employeeLimit ?? 50,
      subscription: { create: { plan: "FREE", status: "TRIALING", seats: data.employeeLimit ?? 50 } },
    },
    include: { subscription: true },
  });
  await recordAudit({
    organizationId: organization.id,
    userId: actorId,
    action: "organization.created",
    entityType: "Organization",
    entityId: organization.id,
  });
  return organization;
}

export async function getOrganization(id: string) {
  const cacheKey = `org:${id}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;
  const organization = await prisma.organization.findUnique({
    where: { id },
    include: {
      subscription: true,
      departments: true,
      _count: { select: { users: true, employees: true, departments: true } },
    },
  });
  if (!organization) throw ApiError.notFound("Organization not found");
  await cacheSet(cacheKey, organization, 120);
  return organization;
}

export async function updateOrganization(id: string, data: Prisma.OrganizationUpdateInput, actorId: string) {
  const organization = await prisma.organization.update({ where: { id }, data });
  await cacheDelete(`org:${id}`);
  await recordAudit({
    organizationId: id,
    userId: actorId,
    action: "organization.updated",
    entityType: "Organization",
    entityId: id,
    metadata: data as Prisma.InputJsonValue,
  });
  return organization;
}

export async function updateSettings(id: string, settings: Record<string, unknown>, actorId: string) {
  const organization = await prisma.organization.update({
    where: { id },
    data: { settings: settings as Prisma.InputJsonValue },
  });
  await cacheDelete(`org:${id}`);
  await recordAudit({
    organizationId: id,
    userId: actorId,
    action: "organization.settings_updated",
    entityType: "Organization",
    entityId: id,
  });
  return organization;
}

export async function updateSubscription(id: string, data: {
  plan?: string;
  status?: string;
  seats?: number;
  renewsAt?: string;
}, actorId: string) {
  const subscription = await prisma.subscription.update({
    where: { organizationId: id },
    data: {
      plan: data.plan as never,
      status: data.status as never,
      seats: data.seats,
      renewsAt: data.renewsAt ? new Date(data.renewsAt) : undefined,
    },
  });
  await recordAudit({
    organizationId: id,
    userId: actorId,
    action: "organization.subscription_updated",
    entityType: "Subscription",
    entityId: subscription.id,
  });
  return subscription;
}

export async function listAdmins(id: string) {
  return prisma.user.findMany({
    where: { organizationId: id, systemRole: { in: [SystemRole.ORGANIZATION_ADMIN, SystemRole.SUPER_ADMIN] } },
    select: { id: true, email: true, firstName: true, lastName: true, systemRole: true, isActive: true, lastLoginAt: true },
  });
}

export async function addAdmin(id: string, data: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}, actorId: string) {
  const passwordHash = await hashPassword(data.password);
  const user = await prisma.user.create({
    data: {
      organizationId: id,
      email: data.email,
      passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      systemRole: SystemRole.ORGANIZATION_ADMIN,
      emailVerified: true,
    },
    select: { id: true, email: true, firstName: true, lastName: true, systemRole: true },
  });
  await recordAudit({
    organizationId: id,
    userId: actorId,
    action: "organization.admin_added",
    entityType: "User",
    entityId: user.id,
  });
  return user;
}

export async function organizationStats(id: string) {
  const [employees, departments, activeLeaves, openReviews] = await Promise.all([
    prisma.employee.count({ where: { organizationId: id } }),
    prisma.department.count({ where: { organizationId: id } }),
    prisma.leaveRequest.count({ where: { organizationId: id, status: "PENDING" } }),
    prisma.performanceReview.count({ where: { employee: { organizationId: id }, status: { not: "FINALIZED" } } }),
  ]);
  return { employees, departments, activeLeaves, openReviews };
}
