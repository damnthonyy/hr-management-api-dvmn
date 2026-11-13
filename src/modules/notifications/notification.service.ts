import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/apiError";
import { parsePagination, buildMeta } from "../../utils/pagination";
import { enqueueInvitation } from "../../queues";

export async function listForUser(userId: string, query: Record<string, unknown>) {
  const params = parsePagination(query);
  const where: Record<string, unknown> = { userId };
  if (query.status === "UNREAD" || query.status === "READ") where.status = query.status;
  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      skip: params.skip,
      take: params.take,
      orderBy: { createdAt: "desc" },
    }),
    prisma.notification.count({ where }),
  ]);
  return { items, meta: buildMeta(params, total) };
}

export async function unreadCount(userId: string) {
  const count = await prisma.notification.count({ where: { userId, status: "UNREAD" } });
  return { count };
}

export async function markRead(id: string, userId: string) {
  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification) throw ApiError.notFound("Notification not found");
  return prisma.notification.update({
    where: { id },
    data: { status: "READ", readAt: new Date() },
  });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({
    where: { userId, status: "UNREAD" },
    data: { status: "READ", readAt: new Date() },
  });
  return { ok: true };
}

export async function invite(organizationId: string, data: { email: string; role: string }, invitedBy: string) {
  await enqueueInvitation({ organizationId, email: data.email, invitedBy, role: data.role });
  return { queued: true };
}
