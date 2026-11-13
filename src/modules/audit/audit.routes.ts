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

const router = Router();

router.use(authenticate);

router.get(
  "/",
  requirePermission(PERMISSIONS.AUDIT_VIEW),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.auth) throw ApiError.unauthorized();
    const params = parsePagination(req.query as Record<string, unknown>);
    const where: Record<string, unknown> = { organizationId: req.auth.organizationId };
    if (typeof req.query.action === "string") where.action = req.query.action;
    if (typeof req.query.entityType === "string") where.entityType = req.query.entityType;
    if (typeof req.query.userId === "string") where.userId = req.query.userId;

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
