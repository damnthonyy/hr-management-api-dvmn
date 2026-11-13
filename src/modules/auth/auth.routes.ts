import { Router } from "express";
import * as controller from "./auth.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate, validateIdParams } from "../../middleware/validate";
import { authenticate } from "../../middleware/authenticate";
import {
  authRateLimit,
  forgotPasswordAccountRateLimit,
  loginAccountRateLimit,
  refreshRateLimit,
  registerRateLimit,
} from "../../middleware/rateLimit";
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  verifyEmailSchema,
  updateProfileSchema,
} from "./auth.validation";

const router = validateIdParams(Router());

router.post("/register", authRateLimit, registerRateLimit, validate(registerSchema), asyncHandler(controller.register));
router.post("/login", authRateLimit, loginAccountRateLimit, validate(loginSchema), asyncHandler(controller.login));
router.post("/refresh", refreshRateLimit, validate(refreshSchema), asyncHandler(controller.refresh));
router.post("/logout", authenticate, validate(logoutSchema), asyncHandler(controller.logout));
router.post("/forgot-password", authRateLimit, forgotPasswordAccountRateLimit, validate(forgotPasswordSchema), asyncHandler(controller.forgotPassword));
router.post("/reset-password", authRateLimit, validate(resetPasswordSchema), asyncHandler(controller.resetPassword));
router.post("/change-password", authenticate, validate(changePasswordSchema), asyncHandler(controller.changePassword));
router.post("/verify-email", authRateLimit, validate(verifyEmailSchema), asyncHandler(controller.verifyEmail));
router.get("/verify-email", authRateLimit, asyncHandler(controller.verifyEmail));

router.get("/me", authenticate, asyncHandler(controller.profile));
router.patch("/me", authenticate, validate(updateProfileSchema), asyncHandler(controller.updateProfile));
router.get("/sessions", authenticate, asyncHandler(controller.sessions));
router.delete("/sessions/:sessionId", authenticate, asyncHandler(controller.revokeSession));
router.get("/login-history", authenticate, asyncHandler(controller.history));

export default router;
