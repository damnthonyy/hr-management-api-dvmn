import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { SystemRole } from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { closeRedis } from "../src/lib/redis";
import { closeQueues } from "../src/queues";
import { hashPassword } from "../src/utils/password";

/**
 * Salary data requires salary:view / salary:manage, even through employee
 * and report endpoints that only require employee:* / report:view.
 */
const app = createApp();
const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const password = "Password123!";
let orgId = "";
let employeeId = "";
const tokens: Record<string, string> = {};
const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

async function createUser(label: string, systemRole: SystemRole) {
  const email = `${label}-${unique}@test.example`;
  await prisma.user.create({
    data: {
      organizationId: orgId,
      email,
      passwordHash: await hashPassword(password),
      firstName: label,
      lastName: "User",
      systemRole,
      emailVerified: true,
    },
  });
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  tokens[label] = res.body.data.tokens.accessToken;
}

describe("salary visibility", () => {
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({
        organizationName: `Salary ${unique}`,
        email: `salary-admin-${unique}@test.example`,
        password,
        firstName: "Salary",
        lastName: "Admin",
      });
    expect(res.status).toBe(201);
    orgId = res.body.data.organization.id;
    tokens.admin = res.body.data.tokens.accessToken;
    await createUser("hr", SystemRole.HR_MANAGER);
    await createUser("manager", SystemRole.DEPARTMENT_MANAGER);
    await createUser("finance", SystemRole.FINANCE_MANAGER);

    const employee = await request(app)
      .post("/api/v1/employees")
      .set(as("admin"))
      .send({
        firstName: "Paid",
        lastName: "Person",
        email: `paid-${unique}@test.example`,
        jobTitle: "Engineer",
        startDate: "2026-01-05T00:00:00.000Z",
        baseSalary: 85000,
        currency: "EUR",
      });
    expect(employee.status).toBe(201);
    employeeId = employee.body.data.id;
    const contract = await request(app)
      .post(`/api/v1/employees/${employeeId}/contracts`)
      .set(as("admin"))
      .send({ contractType: "FULL_TIME", title: "Engineer", startDate: "2026-01-05T00:00:00.000Z", salary: 85000 });
    expect(contract.status).toBe(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await closeQueues().catch(() => undefined);
    await prisma.$disconnect();
    await closeRedis().catch(() => undefined);
  });

  it("cannot change a salary through PATCH /employees/:id", async () => {
    const res = await request(app)
      .patch(`/api/v1/employees/${employeeId}`)
      .set(as("hr"))
      .send({ baseSalary: 999999, currency: "XXX", jobTitle: "Senior Engineer" });
    expect(res.status).toBe(200);
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    expect(Number(employee?.baseSalary)).toBe(85000);
    expect(employee?.currency).toBe("EUR");
    expect(employee?.jobTitle).toBe("Senior Engineer");
  });

  it("requires salary:manage to set a salary at creation", async () => {
    const res = await request(app)
      .post("/api/v1/employees")
      .set(as("hr"))
      .send({
        firstName: "Other",
        lastName: "Person",
        email: `other-${unique}@test.example`,
        jobTitle: "Engineer",
        startDate: "2026-01-05T00:00:00.000Z",
        baseSalary: 1,
      });
    expect(res.status).toBe(403);
  });

  it.each(["hr", "manager"])("hides salary fields from %s (no salary:view)", async (who) => {
    const one = await request(app).get(`/api/v1/employees/${employeeId}`).set(as(who));
    expect(one.status).toBe(200);
    expect(one.body.data.baseSalary).toBeUndefined();
    expect(one.body.data.salaryHistory).toBeUndefined();
    expect(one.body.data.contracts[0].salary).toBeUndefined();
    expect(one.body.data.firstName).toBe("Paid");

    const list = await request(app).get("/api/v1/employees").set(as(who));
    expect(list.body.data.every((e: Record<string, unknown>) => e.baseSalary === undefined)).toBe(true);

    const contracts = await request(app).get(`/api/v1/employees/${employeeId}/contracts`).set(as(who));
    expect(contracts.status).toBe(200);
    expect(contracts.body.data[0].salary).toBeUndefined();

    expect(JSON.stringify([one.body, list.body, contracts.body])).not.toContain("85000");
  });

  it("still shows salaries to roles with salary:view", async () => {
    const one = await request(app).get(`/api/v1/employees/${employeeId}`).set(as("finance"));
    expect(Number(one.body.data.baseSalary)).toBe(85000);
    expect(Number(one.body.data.contracts[0].salary)).toBe(85000);
  });

  it("leaves the salary summary out of the dashboard without salary:view", async () => {
    const hr = await request(app).get("/api/v1/reports/dashboard").set(as("hr"));
    expect(hr.status).toBe(200);
    expect(hr.body.data.salary).toBeUndefined();
    const finance = await request(app).get("/api/v1/reports/dashboard").set(as("finance"));
    expect(finance.body.data.salary.headcount).toBeGreaterThan(0);
  });

  it("refuses to export the salary report without salary:view", async () => {
    const res = await request(app).post("/api/v1/reports/export").set(as("hr")).send({ reportType: "salary-summary" });
    expect(res.status).toBe(403);
    const unknown = await request(app).post("/api/v1/reports/export").set(as("hr")).send({ reportType: "everything" });
    expect(unknown.status).toBe(400);
  });
});
