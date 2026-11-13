import { type NextFunction, type Request, type Response } from "express";
import { getRedis } from "../lib/redis";
import { logger } from "../lib/logger";
import { env } from "../config/env";
import { ApiError } from "../utils/apiError";
import { sha256 } from "../utils/tokens";

interface RateLimitOptions {
  windowSeconds?: number;
  max?: number;
  keyPrefix?: string;
  /** Returns the key to count on, or null to skip this limiter for the request. */
  identifier?: (req: Request) => string | null;
}

/**
 * Fixed-window counter, atomic: the increment and the expiry are set in one
 * script, so a crash between the two can no longer leave a key without TTL
 * (which blocked the client forever). Also repairs keys left without TTL.
 */
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/**
 * The shared Redis client queues commands while disconnected, so a Redis
 * outage would hang every request. The limiter gives up after this delay and
 * lets the request through (fail-open): availability over throttling. The
 * login lockout is stored in the database and keeps working.
 */
const REDIS_TIMEOUT_MS = 500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("rate limiter timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

/**
 * Client IP. Only trustworthy because "trust proxy" is configured explicitly
 * (TRUST_PROXY): X-Forwarded-For is ignored unless it comes from a known proxy.
 */
const clientIp = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? "unknown";

export function rateLimit(options: RateLimitOptions = {}) {
  const windowSeconds = options.windowSeconds ?? env.rateLimit.window;
  const max = options.max ?? env.rateLimit.max;
  const prefix = options.keyPrefix ?? "rl:global";
  const identifier = options.identifier ?? clientIp;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!env.rateLimit.enabled) {
      next();
      return;
    }
    const id = identifier(req);
    if (id === null) {
      next();
      return;
    }

    let count: number;
    let ttl: number;
    try {
      const result = (await withTimeout(
        getRedis().eval(INCREMENT_SCRIPT, 1, `${prefix}:${id}`, windowSeconds),
        REDIS_TIMEOUT_MS
      )) as [number, number];
      [count, ttl] = result;
    } catch (error) {
      logger.warn({ err: error, prefix, requestId: req.requestId }, "rate limiter unavailable, request allowed");
      next();
      return;
    }

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - count)));
    if (count > max) {
      res.setHeader("Retry-After", String(Math.max(1, ttl)));
      next(ApiError.tooMany());
      return;
    }
    next();
  };
}

/** Normalized email from the (not yet validated) body, hashed so it never lands in Redis in clear. */
function bodyEmail(req: Request): string | null {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof email !== "string" || email.trim() === "") return null;
  return sha256(email.trim().toLowerCase());
}

/** Unauthenticated auth endpoints (login, register, password reset, email verification), per IP. */
export const authRateLimit = rateLimit({ windowSeconds: 15 * 60, max: 50, keyPrefix: "rl:auth" });

/** Token refresh, per IP. Kept separate: clients call it routinely. */
export const refreshRateLimit = rateLimit({ windowSeconds: 15 * 60, max: 100, keyPrefix: "rl:refresh" });

/** Account creation, per IP. */
export const registerRateLimit = rateLimit({ windowSeconds: 60 * 60, max: 10, keyPrefix: "rl:register" });

/**
 * Login attempts per target account, whatever the source IP (credential
 * stuffing from many IPs). Complements the database lockout.
 */
export const loginAccountRateLimit = rateLimit({
  windowSeconds: 15 * 60,
  max: 10,
  keyPrefix: "rl:login-account",
  identifier: bodyEmail,
});

/** Password reset emails per target account (mail bombing). */
export const forgotPasswordAccountRateLimit = rateLimit({
  windowSeconds: 60 * 60,
  max: 5,
  keyPrefix: "rl:forgot-account",
  identifier: bodyEmail,
});
