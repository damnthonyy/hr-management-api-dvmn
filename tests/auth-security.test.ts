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

  describe("sessions & refresh tokens", () => {
    const refresh = (token: string) => request(app).post("/api/v1/auth/refresh").send({ refreshToken: token });

    it("rotates the refresh token and keeps the session", async () => {
      const account = await register("rotate");
      const res = await refresh(account.refreshToken);
      expect(res.status).toBe(200);
      expect(res.body.data.refreshToken).not.toBe(account.refreshToken);
      const me = await request(app).get("/api/v1/auth/me").set(bearer(res.body.data.accessToken));
      expect(me.status).toBe(200);
      expect(await prisma.session.count({ where: { userId: account.userId } })).toBe(1);
    });

    it("detects reuse of a rotated token and revokes the whole session", async () => {
      const account = await register("reuse");
      const rotated = await refresh(account.refreshToken);
      expect(rotated.status).toBe(200);

      // Replaying the old token (e.g. stolen) fails...
      const replay = await refresh(account.refreshToken);
      expect(replay.status).toBe(401);
      // ...and also kills the legitimate token and access token of that session.
      expect((await refresh(rotated.body.data.refreshToken)).status).toBe(401);
      const me = await request(app).get("/api/v1/auth/me").set(bearer(rotated.body.data.accessToken));
      expect(me.status).toBe(401);
    });

    it("lets only one of two concurrent refreshes with the same token succeed", async () => {
      const account = await register("race");
      const [first, second] = await Promise.all([refresh(account.refreshToken), refresh(account.refreshToken)]);
      expect([first.status, second.status].filter((status) => status === 200)).toHaveLength(1);
    });

    it("rejects a refresh token whose stored hash does not match", async () => {
      const account = await register("tamper");
      await prisma.refreshToken.updateMany({ where: { userId: account.userId }, data: { tokenHash: sha256("other") } });
      expect((await refresh(account.refreshToken)).status).toBe(401);
    });

    it("logout invalidates the access token and the refresh token", async () => {
      const account = await register("logout");
      const out = await request(app).post("/api/v1/auth/logout").set(bearer(account.accessToken)).send({});
      expect(out.status).toBe(200);
      expect((await request(app).get("/api/v1/auth/me").set(bearer(account.accessToken))).status).toBe(401);
      expect((await refresh(account.refreshToken)).status).toBe(401);
    });

    it("revoking a session from another device invalidates it immediately", async () => {
      const account = await register("revoke");
      const other = await login(account.email);
      expect(other.status).toBe(200);
      const sessions = await request(app).get("/api/v1/auth/sessions").set(bearer(account.accessToken));
      const target = sessions.body.data.find((session: { id: string }) =>
        session.id !== JSON.parse(Buffer.from(account.accessToken.split(".")[1], "base64url").toString()).sessionId
      );
      const res = await request(app).delete(`/api/v1/auth/sessions/${target.id}`).set(bearer(account.accessToken));
      expect(res.status).toBe(200);
      expect((await request(app).get("/api/v1/auth/me").set(bearer(other.body.data.tokens.accessToken))).status).toBe(401);
      expect((await refresh(other.body.data.tokens.refreshToken)).status).toBe(401);
      expect((await request(app).get("/api/v1/auth/me").set(bearer(account.accessToken))).status).toBe(200);
    });

    it("cannot revoke another user's session", async () => {
      const victim = await register("victim-session");
      const attacker = await register("attacker-session");
      const victimSession = await prisma.session.findFirstOrThrow({ where: { userId: victim.userId } });
      await request(app).delete(`/api/v1/auth/sessions/${victimSession.id}`).set(bearer(attacker.accessToken));
      expect((await request(app).get("/api/v1/auth/me").set(bearer(victim.accessToken))).status).toBe(200);
    });
  });

  describe("password changes revoke sessions", () => {
    it("a password reset logs out every session", async () => {
      const account = await register("reset-sessions");
      const other = await login(account.email);
      const raw = randomToken(24);
      await prisma.passwordResetToken.create({
        data: { userId: account.userId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 60_000) },
      });
      const res = await request(app).post("/api/v1/auth/reset-password").send({ token: raw, password: "Reset123456!" });
      expect(res.status).toBe(200);
      for (const token of [account.accessToken, other.body.data.tokens.accessToken]) {
        expect((await request(app).get("/api/v1/auth/me").set(bearer(token))).status).toBe(401);
      }
      expect((await request(app).post("/api/v1/auth/refresh").send({ refreshToken: account.refreshToken })).status).toBe(401);
      expect((await login(account.email, "Reset123456!")).status).toBe(200);
    });

    it("a password change keeps the current session and logs out the others", async () => {
      const account = await register("change-sessions");
      const other = await login(account.email);
      const res = await request(app)
        .post("/api/v1/auth/change-password")
        .set(bearer(account.accessToken))
        .send({ currentPassword: password, newPassword: "Changed123456!" });
      expect(res.status).toBe(200);
      expect((await request(app).get("/api/v1/auth/me").set(bearer(account.accessToken))).status).toBe(200);
      expect((await request(app).get("/api/v1/auth/me").set(bearer(other.body.data.tokens.accessToken))).status).toBe(401);
    });
  });
});
