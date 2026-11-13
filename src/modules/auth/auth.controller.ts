import { Request, Response } from "express";
import * as authService from "./auth.service";
import { sendSuccess, sendCreated } from "../../utils/response";
import { ApiError } from "../../utils/apiError";

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.header("user-agent") ?? undefined };
}

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(req.body, meta(req));
  sendCreated(res, result);
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body, meta(req));
  sendSuccess(res, result);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const result = await authService.refresh(req.body, meta(req));
  sendSuccess(res, result);
}

export async function logout(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  await authService.logout(req.auth.userId, req.auth.sessionId, req.body?.refreshToken);
  sendSuccess(res, { ok: true });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const result = await authService.forgotPassword(req.body.email);
  sendSuccess(res, {
    message: "If an account exists, a reset link has been sent",
    ...(result.token ? { debugToken: result.token } : {}),
  });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const result = await authService.resetPassword(req.body.token, req.body.password);
  sendSuccess(res, result);
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const result = await authService.changePassword(
    req.auth.userId,
    req.body.currentPassword,
    req.body.newPassword
  );
  sendSuccess(res, result);
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const token = (req.body?.token ?? req.query.token) as string;
  const result = await authService.verifyEmail(token);
  sendSuccess(res, result);
}

export async function profile(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const result = await authService.getProfile(req.auth.userId);
  sendSuccess(res, result);
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const result = await authService.updateProfile(req.auth.userId, req.body);
  sendSuccess(res, result);
}

export async function sessions(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const result = await authService.listSessions(req.auth.userId);
  sendSuccess(res, result);
}

export async function revokeSession(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const result = await authService.revokeSession(req.auth.userId, req.params.sessionId);
  sendSuccess(res, result);
}

export async function history(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const result = await authService.loginHistory(req.auth.userId);
  sendSuccess(res, result);
}
