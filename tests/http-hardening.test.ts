import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { closeRedis, getRedis } from "../src/lib/redis";
import { env } from "../src/config/env";
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

  describe("error responses", () => {
    const leaks = (body: unknown) => {
      const text = JSON.stringify(body);
      expect(text).not.toMatch(/stack|prisma|invocation|\.ts:|node_modules|Unique constraint|organizationId_code/i);
    };

    it("answers 400 to a malformed JSON body, without stack trace", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("Content-Type", "application/json")
        .send('{"email": ');
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe("Malformed request body");
      leaks(res.body);
    });

    it("answers 400 to invalid query values that reach the database, without the Prisma message", async () => {
      const res = await request(app)
        .get("/api/v1/employees?status=NOT_A_STATUS")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.requestId).toBeTruthy();
      leaks(res.body);
    });

    it("answers 409 to unique-constraint violations without exposing the constraint", async () => {
      const create = () =>
        request(app)
          .post("/api/v1/departments")
          .set("Authorization", `Bearer ${token}`)
          .send({ name: `Dup ${Math.random()}`, code: "DUP" });
      expect((await create()).status).toBe(201);
      const res = await create();
      expect(res.status).toBe(409);
      expect(res.body.error.details).toBeUndefined();
      leaks(res.body);
    });
  });

  describe("rate limiting", () => {
    const clearCounters = async () => {
      const redis = getRedis();
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", "rl:*", "COUNT", 100);
        if (keys.length > 0) await redis.del(...keys);
        cursor = next;
      } while (cursor !== "0");
    };

    beforeEach(async () => {
      env.rateLimit.enabled = true;
      await clearCounters();
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      env.rateLimit.enabled = false;
      await clearCounters();
    });

    it("limits password reset emails per account, with Retry-After", async () => {
      const target = `victim-${unique}@test.example`;
      for (let i = 0; i < 5; i += 1) {
        const res = await request(app).post("/api/v1/auth/forgot-password").send({ email: target });
        expect(res.status).toBe(200);
      }
      const blocked = await request(app).post("/api/v1/auth/forgot-password").send({ email: ` ${target.toUpperCase()} ` });
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
      // Other accounts are not affected.
      const other = await request(app).post("/api/v1/auth/forgot-password").send({ email: `other-${unique}@test.example` });
      expect(other.status).toBe(200);
    });

    it("cannot be bypassed by rotating X-Forwarded-For", async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        const res = await request(app)
          .post("/api/v1/auth/register")
          .set("X-Forwarded-For", `203.0.113.${i}`)
          .send({});
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
      expect(statuses[10]).toBe(429);
    });

    it("limits refresh and login per account", async () => {
      for (let i = 0; i < 10; i += 1) {
        await request(app).post("/api/v1/auth/login").send({ email: `nobody-${unique}@test.example`, password: "wrong" });
      }
      const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: `nobody-${unique}@test.example`, password: "wrong" });
      expect(login.status).toBe(429);

      const refresh = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: "x" });
      expect(refresh.headers["x-ratelimit-limit"]).toBe("100");
    });

    it("always sets an expiry on counters, and repairs counters left without one", async () => {
      const redis = getRedis();
      const key = "rl:global:::ffff:127.0.0.1";
      await redis.set(key, "1"); // what the old INCR-then-EXPIRE code could leave behind
      expect(await redis.ttl(key)).toBe(-1);
      await request(app).get("/health");
      expect(await redis.ttl(key)).toBeGreaterThan(0);
    });

    it("fails open quickly when Redis does not answer", async () => {
      vi.spyOn(getRedis(), "eval").mockReturnValue(new Promise(() => undefined) as never);
      const started = Date.now();
      const res = await request(app).post("/api/v1/auth/forgot-password").send({ email: `slow-${unique}@test.example` });
      expect(res.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(5000);
    });
  });
});
