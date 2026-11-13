import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { SystemRole } from "@prisma/client";

export interface AccessTokenPayload {
  sub: string;
  organizationId: string;
  email: string;
  role: SystemRole;
  sessionId: string;
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  organizationId: string;
  family: string;
  tokenId: string;
  type: "refresh";
}

export function signAccessToken(payload: Omit<AccessTokenPayload, "type">): string {
  return jwt.sign({ ...payload, type: "access" }, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessTtl,
  });
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, "type">): string {
  return jwt.sign({ ...payload, type: "refresh" }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshTtl,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.decode(token) as (AccessTokenPayload & { exp?: number }) | null;
  if (decoded && decoded.type === "access") {
    return jwt.verify(token, env.jwt.accessSecret, {
      ignoreExpiration: false,
    }) as AccessTokenPayload;
  }
  return jwt.verify(token, env.jwt.accessSecret) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.jwt.refreshSecret) as RefreshTokenPayload;
}
