import { Router } from "express";
import * as controller from "./auth.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { validateIdParams } from "../../middleware/validate";
import { authenticate } from "../../middleware/authenticate";
import {
  authRateLimit,
  forgotPasswordAccountRateLimit,
  loginAccountRateLimit,
  refreshRateLimit,
  registerRateLimit,
} from "../../middleware/rateLimit";

const router = validateIdParams(Router());

router.post("/register", authRateLimit, registerRateLimit, asyncHandler(controller.register));
router.post("/login", authRateLimit, loginAccountRateLimit, asyncHandler(controller.login));
router.post("/refresh", refreshRateLimit, asyncHandler(controller.refresh));
router.post("/logout", authenticate, asyncHandler(controller.logout));
router.post("/forgot-password", authRateLimit, forgotPasswordAccountRateLimit, asyncHandler(controller.forgotPassword));
router.post("/reset-password", authRateLimit, asyncHandler(controller.resetPassword));
router.post("/change-password", authenticate, asyncHandler(controller.changePassword));
router.post("/verify-email", authRateLimit, asyncHandler(controller.verifyEmail));
router.get("/verify-email", authRateLimit, asyncHandler(controller.verifyEmail));

router.get("/me", authenticate, asyncHandler(controller.profile));
router.patch("/me", authenticate, asyncHandler(controller.updateProfile));
router.get("/sessions", authenticate, asyncHandler(controller.sessions));
router.delete("/sessions/:sessionId", authenticate, asyncHandler(controller.revokeSession));
router.get("/login-history", authenticate, asyncHandler(controller.history));

export default router;
