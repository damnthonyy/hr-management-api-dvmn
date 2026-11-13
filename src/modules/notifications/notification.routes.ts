import { Router } from "express";
import { z } from "zod";
import * as controller from "./notification.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate } from "../../middleware/validate";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/authorize";
import { PERMISSIONS } from "../../config/permissions";

const inviteSchema = z.object({
  email: z.email(),
  role: z.string().min(1),
});

const router = Router();

router.use(authenticate);

router.get("/", asyncHandler(controller.list));
router.get("/unread-count", asyncHandler(controller.unreadCount));
router.post("/:id/read", asyncHandler(controller.markRead));
router.post("/read-all", asyncHandler(controller.markAllRead));
router.post("/invite", requirePermission(PERMISSIONS.USER_MANAGE), validate(inviteSchema), asyncHandler(controller.invite));

export default router;
