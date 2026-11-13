import jwt, { type SignOptions, type VerifyOptions } from "jsonwebtoken";
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

const ISSUER = "hr-management-api";

// Pin the algorithm: never let the token header choose it.
const SIGN_OPTIONS: SignOptions = { algorithm: "HS256", issuer: ISSUER };
const VERIFY_OPTIONS: VerifyOptions & { complete?: false } = { algorithms: ["HS256"], issuer: ISSUER };

function decode(token: string, secret: string): Record<string, unknown> {
  const payload = jwt.verify(token, secret, VERIFY_OPTIONS);
  if (typeof payload !== "object" || payload === null) {
    throw new jwt.JsonWebTokenError("invalid token payload");
  }
  return payload as Record<string, unknown>;
}

function hasStrings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => typeof value[key] === "string" && (value[key] as string).length > 0);
}

export function signAccessToken(payload: Omit<AccessTokenPayload, "type">): string {
  return jwt.sign({ ...payload, type: "access" }, env.jwt.accessSecret, {
    ...SIGN_OPTIONS,
    expiresIn: env.jwt.accessTtl,
  });
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, "type">): string {
  return jwt.sign({ ...payload, type: "refresh" }, env.jwt.refreshSecret, {
    ...SIGN_OPTIONS,
    expiresIn: env.jwt.refreshTtl,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = decode(token, env.jwt.accessSecret);
  if (
    payload.type !== "access" ||
    !hasStrings(payload, ["sub", "organizationId", "sessionId"])
  ) {
    throw new jwt.JsonWebTokenError("invalid access token");
  }
  return payload as unknown as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = decode(token, env.jwt.refreshSecret);
  if (
    payload.type !== "refresh" ||
    !hasStrings(payload, ["sub", "family", "tokenId"])
  ) {
    throw new jwt.JsonWebTokenError("invalid refresh token");
  }
  return payload as unknown as RefreshTokenPayload;
}
