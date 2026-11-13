import { Router } from "express";
import * as controller from "./notification.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { validateIdParams } from "../../middleware/validate";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/authorize";
import { PERMISSIONS } from "../../config/permissions";

const router = validateIdParams(Router());

router.use(authenticate);

router.get("/", asyncHandler(controller.list));
router.get("/unread-count", asyncHandler(controller.unreadCount));
router.post("/:id/read", asyncHandler(controller.markRead));
router.post("/read-all", asyncHandler(controller.markAllRead));
router.post("/invite", requirePermission(PERMISSIONS.USER_MANAGE), asyncHandler(controller.invite));

export default router;
