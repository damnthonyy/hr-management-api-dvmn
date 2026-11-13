import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { closeRedis } from "../src/lib/redis";
import { closeQueues } from "../src/queues";

/**
 * Two organizations, A (attacker) and B (victim). Every request below is
 * made with A's admin token against B's resources and must fail without
 * leaking or mutating anything.
 */
const app = createApp();
const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const password = "Password123!";

interface Tenant {
  orgId: string;
  userId: string;
  token: string;
  name: string;
}

async function registerTenant(label: string): Promise<Tenant> {
  const name = `Tenant ${label} ${unique}`;
  const res = await request(app).post("/api/v1/auth/register").send({
    organizationName: name,
    email: `admin-${label}-${unique}@test.example`,
    password,
    firstName: "Admin",
    lastName: label,
  });
  expect(res.status).toBe(201);
  return {
    orgId: res.body.data.organization.id,
    userId: res.body.data.user.id,
    token: res.body.data.tokens.accessToken,
    name,
  };
}

let a: Tenant;
let b: Tenant;
const victim: Record<string, string> = {};

const asA = () => ({ Authorization: `Bearer ${a.token}` });

describe("multi-tenant isolation", () => {
  beforeAll(async () => {
    await prisma.$connect();
    a = await registerTenant("a");
    b = await registerTenant("b");

    const employee = await prisma.employee.create({
      data: {
        organizationId: b.orgId,
        employeeNumber: `EMP-B-${unique}`,
        firstName: "Victim",
        lastName: "Employee",
        email: `victim-${unique}@test.example`,
        jobTitle: "Engineer",
        startDate: new Date(),
        baseSalary: 123456,
      },
    });
    victim.employeeId = employee.id;

    const department = await prisma.department.create({
      data: { organizationId: b.orgId, name: "Victim Dept", code: `VD${unique}`.slice(0, 20) },
    });
    victim.departmentId = department.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [a?.orgId, b?.orgId].filter(Boolean) } } });
    await closeQueues().catch(() => undefined);
    await prisma.$disconnect();
    await closeRedis().catch(() => undefined);
  });

  describe("employees", () => {
    it("ignores the x-organization-id header", async () => {
      const res = await request(app).get("/api/v1/employees").set(asA()).set("x-organization-id", b.orgId);
      expect(res.status).toBe(200);
      expect(res.body.data.map((e: { id: string }) => e.id)).not.toContain(victim.employeeId);
    });

    it("cannot create an employee in another org via the header", async () => {
      const res = await request(app)
        .post("/api/v1/employees")
        .set(asA())
        .set("x-organization-id", b.orgId)
        .send({
          firstName: "Injected",
          lastName: "Employee",
          email: `injected-${unique}@test.example`,
          jobTitle: "Spy",
          startDate: new Date().toISOString(),
        });
      expect(res.status).toBe(201);
      expect(res.body.data.organizationId).toBe(a.orgId);
    });

    it.each([
      ["GET", ""],
      ["PATCH", ""],
      ["POST", "/deactivate"],
      ["DELETE", ""],
      ["GET", "/emergency-contacts"],
      ["POST", "/emergency-contacts"],
      ["GET", "/contracts"],
      ["POST", "/contracts"],
      ["GET", "/salary-history"],
      ["POST", "/salary"],
      ["GET", "/reports"],
    ])("%s /employees/:id%s returns 404", async (method, suffix) => {
      const url = `/api/v1/employees/${victim.employeeId}${suffix}`;
      const bodies: Record<string, unknown> = {
        "": { jobTitle: "Hacked" },
        "/emergency-contacts": { name: "x", relationship: "x", phone: "12345" },
        "/contracts": { contractType: "FULL_TIME", title: "x", startDate: new Date().toISOString(), salary: 1 },
        "/salary": { newSalary: 1 },
      };
      const req = request(app)[method.toLowerCase() as "get" | "post" | "patch" | "delete"](url).set(asA());
      const res = await (method === "GET" || method === "DELETE" ? req : req.send(bodies[suffix] ?? {}));
      expect(res.status).toBe(404);
    });

    it("rejects references to another org's department", async () => {
      const res = await request(app)
        .post("/api/v1/employees")
        .set(asA())
        .send({
          firstName: "Ref",
          lastName: "Check",
          email: `ref-${unique}@test.example`,
          jobTitle: "x",
          startDate: new Date().toISOString(),
          departmentId: victim.departmentId,
        });
      expect(res.status).toBe(404);
    });

    it("left the victim untouched", async () => {
      const employee = await prisma.employee.findUnique({ where: { id: victim.employeeId } });
      expect(employee?.jobTitle).toBe("Engineer");
      expect(employee?.status).toBe("ACTIVE");
      expect(employee?.baseSalary.toString()).toBe("123456");
    });
  });
});
