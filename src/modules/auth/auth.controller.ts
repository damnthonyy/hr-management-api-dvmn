import { Request, Response } from "express";
import * as authService from "./auth.service";
import { sendSuccess, sendCreated } from "../../utils/response";
import { ApiError } from "../../utils/apiError";
import { parseQuery } from "../../middleware/validate";
import { verifyEmailSchema } from "./auth.validation";

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
  await authService.logout(req.auth.userId, req.auth.sessionId);
  sendSuccess(res, { ok: true });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  // Same response whether or not the account exists, and the token is
  // only ever sent by email.
  await authService.forgotPassword(req.body.email);
  sendSuccess(res, { message: "If an account exists, a reset link has been sent" });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const result = await authService.resetPassword(req.body.token, req.body.password);
  sendSuccess(res, result);
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const result = await authService.changePassword(
    req.auth.userId,
    req.auth.sessionId,
    req.body.currentPassword,
    req.body.newPassword
  );
  sendSuccess(res, result);
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  // POST: body already validated by the route; GET (link in the email): query.
  const { token } = req.method === "GET" ? parseQuery(req, verifyEmailSchema) : (req.body as { token: string });
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
