import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { SystemRole } from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { closeRedis } from "../src/lib/redis";
import { closeQueues } from "../src/queues";
import { hashPassword } from "../src/utils/password";

/** State transitions and concurrent updates on leave and payroll. */
const app = createApp();
const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const password = "Password123!";
let orgId = "";
let token = "";
let employeeId = "";
let leaveTypeId = "";
const auth = () => ({ Authorization: `Bearer ${token}` });
const year = 2027;

async function createLeaveRequest(startDay: number) {
  const day = String(startDay).padStart(2, "0");
  const res = await request(app)
    .post("/api/v1/leave/requests")
    .set(auth())
    .send({
      employeeId,
      leaveTypeId,
      startDate: `${year}-03-${day}T00:00:00.000Z`,
      endDate: `${year}-03-${String(startDay + 1).padStart(2, "0")}T00:00:00.000Z`,
    });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; days: string };
}

const usedDays = async () =>
  Number(
    (await prisma.leaveBalance.findFirstOrThrow({ where: { employeeId, leaveTypeId, year } })).usedDays
  );

describe("business integrity", () => {
  beforeAll(async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      organizationName: `Integrity ${unique}`,
      email: `integrity-${unique}@test.example`,
      password,
      firstName: "Integrity",
      lastName: "Admin",
    });
    expect(res.status).toBe(201);
    orgId = res.body.data.organization.id;
    token = res.body.data.tokens.accessToken;

    // The employee is linked to another user, so the admin can approve.
    const employeeUser = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: `integrity-employee-${unique}@test.example`,
        passwordHash: await hashPassword(password),
        firstName: "Emp",
        lastName: "Loyee",
        systemRole: SystemRole.EMPLOYEE,
      },
    });
    const employee = await request(app).post("/api/v1/employees").set(auth()).send({
      firstName: "Emp",
      lastName: "Loyee",
      email: `integrity-employee-${unique}@test.example`,
      jobTitle: "Engineer",
      startDate: "2026-01-05T00:00:00.000Z",
      baseSalary: 60000,
    });
    expect(employee.status).toBe(201);
    employeeId = employee.body.data.id;
    await prisma.employee.update({ where: { id: employeeId }, data: { userId: employeeUser.id } });

    const type = await request(app).post("/api/v1/leave/types").set(auth()).send({ name: "Vacation", code: "VAC" });
    expect(type.status).toBe(201);
    leaveTypeId = type.body.data.id;
    const balance = await request(app)
      .put("/api/v1/leave/balances")
      .set(auth())
      .send({ employeeId, leaveTypeId, year, entitledDays: 25 });
    expect(balance.status).toBe(200);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await closeQueues().catch(() => undefined);
    await prisma.$disconnect();
    await closeRedis().catch(() => undefined);
  });

  describe("leave", () => {
    it("debits the balance once under concurrent approvals", async () => {
      const leave = await createLeaveRequest(2);
      const before = await usedDays();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => request(app).post(`/api/v1/leave/requests/${leave.id}/approve`).set(auth()).send({}))
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.every((s) => s === 200 || s === 409 || s === 400)).toBe(true);
      expect(await usedDays()).toBe(before + Number(leave.days));
    });

    it("gives the days back when an approved request is cancelled", async () => {
      const leave = await createLeaveRequest(9);
      const before = await usedDays();
      expect((await request(app).post(`/api/v1/leave/requests/${leave.id}/approve`).set(auth()).send({})).status).toBe(200);
      expect(await usedDays()).toBe(before + Number(leave.days));
      expect((await request(app).post(`/api/v1/leave/requests/${leave.id}/cancel`).set(auth())).status).toBe(200);
      expect(await usedDays()).toBe(before);
    });

    it("does not touch the balance when a pending request is cancelled", async () => {
      const leave = await createLeaveRequest(16);
      const before = await usedDays();
      expect((await request(app).post(`/api/v1/leave/requests/${leave.id}/cancel`).set(auth())).status).toBe(200);
      expect(await usedDays()).toBe(before);
    });
  });
});
