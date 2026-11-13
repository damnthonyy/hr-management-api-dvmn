import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { closeRedis, getRedis } from "../src/lib/redis";
import { closeQueues } from "../src/queues";

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
});
