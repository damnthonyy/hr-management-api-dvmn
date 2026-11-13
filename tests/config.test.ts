import { describe, it, expect, vi } from "vitest";

const loadEnvWith = async (vars: Record<string, string | undefined>) => {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  try {
    return await import("../src/config/env");
  } finally {
    process.env = saved;
    vi.resetModules();
  }
};

describe("environment validation", () => {
  it.each([
    [{ PORT: "abc" }, /PORT/],
    [{ PORT: "70000" }, /PORT/],
    [{ DATABASE_URL: undefined }, /DATABASE_URL/],
    [{ DATABASE_URL: "mysql://localhost/db" }, /DATABASE_URL/],
    [{ REDIS_URL: "localhost:6379" }, /REDIS_URL/],
    [{ NODE_ENV: "staging" }, /NODE_ENV/],
    [{ JWT_ACCESS_TTL: "-1" }, /JWT_ACCESS_TTL/],
    [{ MAX_UPLOAD_BYTES: "lots" }, /MAX_UPLOAD_BYTES/],
    [{ CORS_ORIGIN: "not an origin" }, /CORS_ORIGIN/],
    [{ SMTP_FROM: "nope" }, /SMTP_FROM/],
    [{ RATE_LIMIT_ENABLED: "yes" }, /RATE_LIMIT_ENABLED/],
  ])("refuses to start with %o", async (vars, message) => {
    await expect(loadEnvWith(vars)).rejects.toThrow(message);
  });

  it("reports every problem at once, without echoing values", async () => {
    const error = await loadEnvWith({ PORT: "abc", REDIS_URL: "s3cr3t-value" }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/PORT/);
    expect((error as Error).message).toMatch(/REDIS_URL/);
    expect((error as Error).message).not.toContain("s3cr3t-value");
  });

  it("refuses to disable rate limiting in production", async () => {
    await expect(
      loadEnvWith({
        NODE_ENV: "production",
        JWT_ACCESS_SECRET: "a".repeat(40),
        JWT_REFRESH_SECRET: "b".repeat(40),
        RATE_LIMIT_ENABLED: "false",
      })
    ).rejects.toThrow(/rate limiting/);
  });

  it("applies defaults and treats empty values as unset", async () => {
    const { env } = await loadEnvWith({ PORT: "", JWT_ACCESS_TTL: undefined, NODE_ENV: "development" });
    expect(env.port).toBe(4000);
    expect(env.jwt.accessTtl).toBe(900);
    expect(env.corsOrigins).toBe("*");
  });
});
