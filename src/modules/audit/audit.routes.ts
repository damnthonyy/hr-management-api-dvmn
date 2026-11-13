import { Prisma } from "@prisma/client";
import { z } from "zod";
import { paginationQuery, uuidFilter } from "../../utils/query";
import { parseQuery, validateIdParams } from "../../middleware/validate";
import { Router } from "express";
import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/authorize";
import { PERMISSIONS } from "../../config/permissions";
import { parsePagination, buildMeta } from "../../utils/pagination";
import { sendPaginated } from "../../utils/response";
import { ApiError } from "../../utils/apiError";

const listAuditLogsQuery = z.object({
  ...paginationQuery,
  action: z.string().max(100).optional(),
  entityType: z.string().max(100).optional(),
  userId: uuidFilter,
});

const router = validateIdParams(Router());

router.use(authenticate);

router.get(
  "/",
  requirePermission(PERMISSIONS.AUDIT_VIEW),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw ApiError.unauthorized();
    const query = parseQuery(req, listAuditLogsQuery);
    const params = parsePagination(query);
    const where: Prisma.AuditLogWhereInput = { organizationId: req.auth.organizationId };
    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;
    if (query.userId) where.userId = query.userId;

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    sendPaginated(res, items, buildMeta(params, total));
  })
);

export default router;
