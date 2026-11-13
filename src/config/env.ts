import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function asInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const isProduction = process.env.NODE_ENV === "production";

/**
 * JWT secrets: the development fallbacks are public (they are in the
 * repository), so production refuses to start without strong, distinct
 * secrets.
 */
function jwtSecret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (!isProduction) return value || devFallback;
  if (!value || value.length < 32) {
    throw new Error(`${name} must be set to a random string of at least 32 characters in production`);
  }
  return value;
}

const accessSecret = jwtSecret("JWT_ACCESS_SECRET", "dev-access-secret-change-me");
const refreshSecret = jwtSecret("JWT_REFRESH_SECRET", "dev-refresh-secret-change-me");
if (accessSecret === refreshSecret) {
  throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different");
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction,
  port: asInt("PORT", 4000),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  jwt: {
    accessSecret,
    refreshSecret,
    accessTtl: asInt("JWT_ACCESS_TTL", 900),
    refreshTtl: asInt("JWT_REFRESH_TTL", 1209600),
  },
  passwordResetTtl: asInt("PASSWORD_RESET_TTL", 3600),
  emailVerificationTtl: asInt("EMAIL_VERIFICATION_TTL", 86400),
  storageDir: process.env.STORAGE_DIR ?? "storage",
  maxUploadBytes: asInt("MAX_UPLOAD_BYTES", 15728640),
  rateLimit: {
    window: asInt("RATE_LIMIT_WINDOW", 60),
    max: asInt("RATE_LIMIT_MAX", 300),
  },
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  smtpFrom: process.env.SMTP_FROM ?? "no-reply@hrvantage.example",
  appPublicUrl: process.env.APP_PUBLIC_URL ?? "http://localhost:4000",
};
