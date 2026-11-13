import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { closeRedis } from "../src/lib/redis";
import { closeQueues } from "../src/queues";

const app = createApp();
const unique = Date.now();
const email = `hr-${unique}@test.example`;
const password = "Password123!";

let token = "";
let employeeId = "";

describe("employee lifecycle", () => {
  beforeAll(async () => {
    await prisma.$connect();
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({
        organizationName: `Emp Org ${unique}`,
        email,
        password,
        firstName: "HR",
        lastName: "Lead",
      });
    token = res.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    await prisma.employee.deleteMany({ where: { email: `jane-${unique}@test.example` } });
    await prisma.user.deleteMany({ where: { email } });
    await prisma.organization.deleteMany({ where: { name: `Emp Org ${unique}` } });
    await closeQueues().catch(() => undefined);
    await prisma.$disconnect();
    await closeRedis().catch(() => undefined);
  });

  it("creates an employee", async () => {
    const res = await request(app)
      .post("/api/v1/employees")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Jane",
        lastName: "Doe",
        email: `jane-${unique}@test.example`,
        jobTitle: "Analyst",
        startDate: new Date().toISOString(),
        baseSalary: 55000,
      });
    expect(res.status).toBe(201);
    employeeId = res.body.data.id;
    expect(employeeId).toBeTruthy();
  });

  it("lists employees with pagination meta", async () => {
    const res = await request(app).get("/api/v1/employees?page=1&pageSize=10").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("fetches a single employee", async () => {
    const res = await request(app).get(`/api/v1/employees/${employeeId}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.firstName).toBe("Jane");
  });
});
