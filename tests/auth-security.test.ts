import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { closeRedis, getRedis } from "../src/lib/redis";
import { closeQueues } from "../src/queues";
import { randomToken, sha256 } from "../src/utils/tokens";

const app = createApp();
const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const password = "Password123!";
const orgIds: string[] = [];

interface Account {
  email: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
}

async function register(label: string): Promise<Account> {
  const email = `${label}-${unique}@test.example`;
  const res = await request(app).post("/api/v1/auth/register").send({
    organizationName: `Auth ${label} ${unique}`,
    email,
    password,
    firstName: "Auth",
    lastName: label,
  });
  expect(res.status).toBe(201);
  orgIds.push(res.body.data.organization.id);
  return {
    email,
    userId: res.body.data.user.id,
    accessToken: res.body.data.tokens.accessToken,
    refreshToken: res.body.data.tokens.refreshToken,
  };
}

async function login(email: string, pwd = password) {
  return request(app).post("/api/v1/auth/login").send({ email, password: pwd });
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("auth security", () => {
  beforeAll(async () => {
    await prisma.$connect();
    // Auth endpoints are rate limited per IP + email; start from a clean slate.
    const keys = await getRedis().keys("rl:*");
    if (keys.length > 0) await getRedis().del(...keys);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await closeQueues().catch(() => undefined);
    await prisma.$disconnect();
    await closeRedis().catch(() => undefined);
  });

  describe("forgot password", () => {
    it("never returns the reset token, and answers the same for unknown emails", async () => {
      const account = await register("forgot");
      const known = await request(app).post("/api/v1/auth/forgot-password").send({ email: account.email });
      const unknown = await request(app)
        .post("/api/v1/auth/forgot-password")
        .send({ email: `nobody-${unique}@test.example` });
      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(known.body).toEqual(unknown.body);
      expect(JSON.stringify(known.body)).not.toMatch(/token/i);
    });
  });

  describe("reset & verification tokens", () => {
    it("stores only a hash of the reset token", async () => {
      const account = await register("hash");
      await request(app).post("/api/v1/auth/forgot-password").send({ email: account.email });
      const rows = await prisma.passwordResetToken.findMany({ where: { userId: account.userId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("accepts the raw token sent by email, only once", async () => {
      const account = await register("reset");
      const raw = randomToken(24);
      await prisma.passwordResetToken.create({
        data: { userId: account.userId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 60_000) },
      });
      const first = await request(app).post("/api/v1/auth/reset-password").send({ token: raw, password: "NewPassword123!" });
      expect(first.status).toBe(200);
      const replay = await request(app).post("/api/v1/auth/reset-password").send({ token: raw, password: "Other123456!" });
      expect(replay.status).toBe(400);
      // The hash itself is not a valid token.
      const byHash = await request(app)
        .post("/api/v1/auth/reset-password")
        .send({ token: sha256(raw), password: "Other123456!" });
      expect(byHash.status).toBe(400);
    });

    it("verifies emails with the raw token", async () => {
      const account = await register("verify");
      const raw = randomToken(24);
      await prisma.emailVerificationToken.create({
        data: { userId: account.userId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 60_000) },
      });
      const res = await request(app).post("/api/v1/auth/verify-email").send({ token: raw });
      expect(res.status).toBe(200);
      expect((await prisma.user.findUnique({ where: { id: account.userId } }))?.emailVerified).toBe(true);
    });
  });
});
