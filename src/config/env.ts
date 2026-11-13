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

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  port: asInt("PORT", 4000),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  jwt: {
    accessSecret: required("JWT_ACCESS_SECRET", "dev-access-secret-change-me"),
    refreshSecret: required("JWT_REFRESH_SECRET", "dev-refresh-secret-change-me"),
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
