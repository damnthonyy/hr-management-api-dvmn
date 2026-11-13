import { Router } from "express";
import * as controller from "./document.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { validateIdParams } from "../../middleware/validate";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/authorize";
import { PERMISSIONS } from "../../config/permissions";
import { upload } from "./upload";

const router = validateIdParams(Router());

router.use(authenticate);

router.get("/categories", requirePermission(PERMISSIONS.DOCUMENT_VIEW), asyncHandler(controller.listCategories));
router.post("/categories", requirePermission(PERMISSIONS.DOCUMENT_MANAGE), asyncHandler(controller.createCategory));

router.get("/", requirePermission(PERMISSIONS.DOCUMENT_VIEW), asyncHandler(controller.list));
router.post("/upload", requirePermission(PERMISSIONS.DOCUMENT_MANAGE), upload.single("file"), asyncHandler(controller.uploadDocument));
router.post("/import-from-url", requirePermission(PERMISSIONS.DOCUMENT_MANAGE), asyncHandler(controller.importFromUrl));
router.get("/:id", requirePermission(PERMISSIONS.DOCUMENT_VIEW), asyncHandler(controller.getOne));
router.get("/:id/download", requirePermission(PERMISSIONS.DOCUMENT_VIEW), asyncHandler(controller.download));
router.delete("/:id", requirePermission(PERMISSIONS.DOCUMENT_MANAGE), asyncHandler(controller.remove));

export default router;
