import { Router } from "express";
import * as controller from "./performance.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { validateIdParams } from "../../middleware/validate";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/authorize";
import { PERMISSIONS } from "../../config/permissions";

const router = validateIdParams(Router());

router.use(authenticate);

router.get("/cycles", requirePermission(PERMISSIONS.PERFORMANCE_VIEW), asyncHandler(controller.listCycles));
router.post("/cycles", requirePermission(PERMISSIONS.PERFORMANCE_MANAGE), asyncHandler(controller.createCycle));

router.get("/reviews", requirePermission(PERMISSIONS.PERFORMANCE_VIEW), asyncHandler(controller.listReviews));
router.post("/reviews", requirePermission(PERMISSIONS.PERFORMANCE_MANAGE), asyncHandler(controller.createReview));
router.get("/reviews/:id", requirePermission(PERMISSIONS.PERFORMANCE_VIEW), asyncHandler(controller.getReview));
router.patch("/reviews/:id", requirePermission(PERMISSIONS.PERFORMANCE_MANAGE), asyncHandler(controller.updateReview));

router.get("/objectives/:employeeId", requirePermission(PERMISSIONS.PERFORMANCE_VIEW), asyncHandler(controller.listObjectives));
router.post("/objectives", requirePermission(PERMISSIONS.PERFORMANCE_MANAGE), asyncHandler(controller.createObjective));
router.patch("/objectives/:id", requirePermission(PERMISSIONS.PERFORMANCE_MANAGE), asyncHandler(controller.updateObjective));
router.delete("/objectives/:id", requirePermission(PERMISSIONS.PERFORMANCE_MANAGE), asyncHandler(controller.deleteObjective));

export default router;
