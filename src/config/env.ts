import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

/**
 * Environment, validated once at startup. Any invalid value stops the
 * process with the list of problems, instead of silently falling back to a
 * default (PORT=abc used to mean 4000) or failing later at first use.
 */

const isProduction = process.env.NODE_ENV === "production";

/** Empty strings are treated as unset (docker-compose passes `VAR: ${VAR:-}`). */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const integer = (fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) =>
  optional(z.coerce.number().int().min(min).max(max)).transform((value) => value ?? fallback);

const DEV_ACCESS_SECRET = "dev-access-secret-change-me";
const DEV_REFRESH_SECRET = "dev-refresh-secret-change-me";

/**
 * JWT secrets: the development fallbacks are public (they are in the
 * repository), so production refuses to start without strong, distinct
 * secrets.
 */
const jwtSecret = (name: string, devFallback: string) =>
  optional(z.string()).transform((value, ctx) => {
    if (!isProduction) return value || devFallback;
    if (!value || value.length < 32) {
      ctx.addIssue({
        code: "custom",
        message: `${name} must be set to a random string of at least 32 characters in production`,
      });
      return z.NEVER;
    }
    return value;
  });

/**
 * TRUST_PROXY: number of reverse proxies in front of the app (e.g. 1), or a
 * comma-separated list of trusted proxy addresses/subnets. Unset means the
 * app is reached directly and X-Forwarded-* headers are ignored. "true" is
 * refused: it trusts any client-supplied X-Forwarded-For, which lets anyone
 * pick their own IP (rate limits, audit logs).
 */
const trustProxy = optional(z.string().trim()).transform((raw, ctx): false | number | string[] => {
  if (!raw || raw === "false" || raw === "0") return false;
  if (raw === "true") {
    ctx.addIssue({
      code: "custom",
      message: "TRUST_PROXY=true trusts spoofable headers; set the number of proxies (e.g. 1) or their addresses",
    });
    return z.NEVER;
  }
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
});

/**
 * CORS_ORIGIN: comma-separated list of allowed origins, or "*". Unset means
 * "*" in development and no cross-origin access in production. The API
 * authenticates with bearer tokens, never cookies, so credentials are never
 * allowed cross-origin.
 */
const corsOrigins = optional(z.string().trim()).transform((raw, ctx): "*" | string[] => {
  if (!raw) return isProduction ? [] : "*";
  if (raw === "*") return "*";
  const origins = raw.split(",").map((entry) => entry.trim().replace(/\/$/, "")).filter(Boolean);
  for (const origin of origins) {
    if (!z.url({ protocol: /^https?$/ }).safeParse(origin).success) {
      ctx.addIssue({ code: "custom", message: `CORS_ORIGIN contains an invalid origin: ${origin}` });
    }
  }
  return origins;
});

const connectionUrl = (protocols: RegExp) => z.string().regex(protocols, "unsupported URL scheme");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: integer(4000, 1, 65535),
    DATABASE_URL: connectionUrl(/^postgres(ql)?:\/\//),
    REDIS_URL: connectionUrl(/^rediss?:\/\//),
    JWT_ACCESS_SECRET: jwtSecret("JWT_ACCESS_SECRET", DEV_ACCESS_SECRET),
    JWT_REFRESH_SECRET: jwtSecret("JWT_REFRESH_SECRET", DEV_REFRESH_SECRET),
    JWT_ACCESS_TTL: integer(900, 60, 24 * 3600),
    JWT_REFRESH_TTL: integer(1209600, 3600),
    PASSWORD_RESET_TTL: integer(3600, 300),
    EMAIL_VERIFICATION_TTL: integer(86400, 300),
    STORAGE_DIR: optional(z.string()).transform((value) => value ?? "storage"),
    MAX_UPLOAD_BYTES: integer(15728640, 1),
    RATE_LIMIT_ENABLED: optional(z.enum(["true", "false"])).transform((value) => value !== "false"),
    RATE_LIMIT_WINDOW: integer(60, 1),
    RATE_LIMIT_MAX: integer(300, 1),
    TRUST_PROXY: trustProxy,
    CORS_ORIGIN: corsOrigins,
    SMTP_FROM: optional(z.email()).transform((value) => value ?? "no-reply@hrvantage.example"),
    APP_PUBLIC_URL: optional(z.url({ protocol: /^https?$/ })).transform((value) => value ?? "http://localhost:4000"),
  })
  .superRefine((value, ctx) => {
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_REFRESH_SECRET"],
        message: "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different",
      });
    }
    if (value.NODE_ENV === "production" && value.RATE_LIMIT_ENABLED === false) {
      ctx.addIssue({ code: "custom", path: ["RATE_LIMIT_ENABLED"], message: "rate limiting cannot be disabled in production" });
    }
  });

export class InvalidEnvironmentError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "InvalidEnvironmentError";
  }
}

function parse() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    // Values are never echoed: they may be secrets.
    throw new InvalidEnvironmentError(
      result.error.issues.map((issue) => {
        const name = issue.path.join(".");
        return issue.code === "custom" || !name ? issue.message : `${name}: ${issue.message}`;
      })
    );
  }
  return result.data;
}

const raw = parse();

export const env = {
  nodeEnv: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === "production",
  port: raw.PORT,
  databaseUrl: raw.DATABASE_URL,
  redisUrl: raw.REDIS_URL,
  jwt: {
    accessSecret: raw.JWT_ACCESS_SECRET,
    refreshSecret: raw.JWT_REFRESH_SECRET,
    accessTtl: raw.JWT_ACCESS_TTL,
    refreshTtl: raw.JWT_REFRESH_TTL,
  },
  passwordResetTtl: raw.PASSWORD_RESET_TTL,
  emailVerificationTtl: raw.EMAIL_VERIFICATION_TTL,
  storageDir: raw.STORAGE_DIR,
  maxUploadBytes: raw.MAX_UPLOAD_BYTES,
  rateLimit: {
    // Only meant to be disabled in tests.
    enabled: raw.RATE_LIMIT_ENABLED,
    window: raw.RATE_LIMIT_WINDOW,
    max: raw.RATE_LIMIT_MAX,
  },
  trustProxy: raw.TRUST_PROXY,
  corsOrigins: raw.CORS_ORIGIN,
  smtpFrom: raw.SMTP_FROM,
  appPublicUrl: raw.APP_PUBLIC_URL,
};
