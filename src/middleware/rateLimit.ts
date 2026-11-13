import { NextFunction, Request, Response } from "express";
import { getRedis } from "../lib/redis";
import { env } from "../config/env";
import { ApiError } from "../utils/apiError";

interface RateLimitOptions {
  windowSeconds?: number;
  max?: number;
  keyPrefix?: string;
  identifier?: (req: Request) => string;
}

export function rateLimit(options: RateLimitOptions = {}) {
  const windowSeconds = options.windowSeconds ?? env.rateLimit.window;
  const max = options.max ?? env.rateLimit.max;
  const prefix = options.keyPrefix ?? "rl:global";

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = options.identifier ? options.identifier(req) : req.ip ?? "anonymous";
      const key = `${prefix}:${id}`;
      const redis = getRedis();
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSeconds);
      }
      const remaining = Math.max(0, max - count);
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(remaining));
      if (count > max) {
        next(ApiError.tooMany());
        return;
      }
      next();
    } catch {
      next();
    }
  };
}

export const authRateLimit = rateLimit({
  windowSeconds: 60,
  max: 20,
  keyPrefix: "rl:auth",
  identifier: (req) => `${req.ip}:${String((req.body as { email?: string } | undefined)?.email ?? "")}`,
});
