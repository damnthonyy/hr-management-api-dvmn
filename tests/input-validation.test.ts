import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { closeRedis } from "../src/lib/redis";
import { closeQueues } from "../src/queues";

const app = createApp();
const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let orgId = "";
let token = "";
const auth = () => ({ Authorization: `Bearer ${token}` });

describe("input validation", () => {
  beforeAll(async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      organizationName: `Validation ${unique}`,
      email: `validation-${unique}@test.example`,
      password: "Password123!",
      firstName: "Val",
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

  describe("route ids", () => {
    it.each([
      ["GET", "/api/v1/employees/not-a-uuid"],
      ["GET", "/api/v1/employees/1%20OR%201=1/salary-history"],
      ["GET", "/api/v1/organizations/abc/stats"],
      ["PATCH", "/api/v1/departments/teams/123"],
      ["GET", "/api/v1/leave/balances/xyz"],
      ["POST", "/api/v1/payroll/periods/xyz/submit"],
      ["DELETE", "/api/v1/auth/sessions/xyz"],
      ["PUT", "/api/v1/roles/users/xyz/system-role"],
    ])("%s %s answers 400", async (method, url) => {
      const res = await request(app)[method.toLowerCase() as "get"](url).set(auth()).send({});
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/expected a UUID/);
    });

    it("still answers 404 for a well-formed unknown id", async () => {
      const res = await request(app).get("/api/v1/employees/00000000-0000-4000-8000-000000000000").set(auth());
      expect(res.status).toBe(404);
    });
  });
});
