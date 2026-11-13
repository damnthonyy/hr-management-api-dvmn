import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { closeRedis } from "../src/lib/redis";
import { closeQueues } from "../src/queues";

const app = createApp();
const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const password = "Password123!";
let orgId = "";
let email = "";
let token = "";

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
const strong = { JWT_ACCESS_SECRET: "a".repeat(40), JWT_REFRESH_SECRET: "b".repeat(40) };

describe("HTTP hardening", () => {
  beforeAll(async () => {
    email = `http-${unique}@test.example`;
    const res = await request(app).post("/api/v1/auth/register").send({
      organizationName: `Http ${unique}`,
      email,
      password,
      firstName: "Http",
      lastName: "Admin",
    });
    expect(res.status).toBe(201);
    orgId = res.body.data.organization.id;
    token = res.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await closeQueues().catch(() => undefined);
    await prisma.$disconnect();
    await closeRedis().catch(() => undefined);
  });

  describe("trust proxy", () => {
    it("ignores X-Forwarded-For by default, so clients cannot choose their IP", async () => {
      const login = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", "6.6.6.6")
        .send({ email, password });
      expect(login.status).toBe(200);
      const entry = await prisma.loginHistory.findFirst({
        where: { user: { email }, success: true },
        orderBy: { createdAt: "desc" },
      });
      expect(entry?.ipAddress).toBeTruthy();
      expect(entry?.ipAddress).not.toBe("6.6.6.6");
    });

    it("refuses TRUST_PROXY=true and parses hop counts and address lists", async () => {
      await expect(loadEnvWith({ TRUST_PROXY: "true" })).rejects.toThrow(/TRUST_PROXY/);
      expect((await loadEnvWith({ TRUST_PROXY: undefined })).env.trustProxy).toBe(false);
      expect((await loadEnvWith({ TRUST_PROXY: "1" })).env.trustProxy).toBe(1);
      expect((await loadEnvWith({ TRUST_PROXY: "loopback, 10.0.0.0/8" })).env.trustProxy).toEqual([
        "loopback",
        "10.0.0.0/8",
      ]);
    });
  });

  describe("CORS", () => {
    it("never allows credentials cross-origin", async () => {
      const res = await request(app).options("/api/v1/auth/login").set("Origin", "https://evil.example");
      expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
      expect(res.headers["access-control-allow-origin"]).not.toBe("https://evil.example");
    });

    it("defaults to no cross-origin access in production, and honours an explicit list", async () => {
      const prod = await loadEnvWith({ NODE_ENV: "production", CORS_ORIGIN: undefined, ...strong });
      expect(prod.env.corsOrigins).toEqual([]);
      const list = await loadEnvWith({ CORS_ORIGIN: "https://app.example/, https://admin.example" });
      expect(list.env.corsOrigins).toEqual(["https://app.example", "https://admin.example"]);
    });
  });
});
