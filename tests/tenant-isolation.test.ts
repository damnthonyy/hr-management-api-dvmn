import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { closeRedis } from "../src/lib/redis";
import { closeQueues } from "../src/queues";
import fs from "fs";
import path from "path";
import { uploadsDir, ensureStorage } from "../src/lib/storage";

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
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
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

    const team = await prisma.team.create({
      data: { organizationId: b.orgId, departmentId: department.id, name: "Victim Team" },
    });
    victim.teamId = team.id;

    const leaveType = await prisma.leaveType.create({
      data: { organizationId: b.orgId, name: "Victim PTO", code: `PTO${unique}`.slice(0, 20), defaultDays: 25 },
    });
    victim.leaveTypeId = leaveType.id;
    const leaveRequest = await prisma.leaveRequest.create({
      data: {
        organizationId: b.orgId,
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        startDate: new Date(),
        endDate: new Date(),
        days: 1,
        status: "PENDING",
      },
    });
    victim.leaveRequestId = leaveRequest.id;

    const period = await prisma.payrollPeriod.create({
      data: {
        organizationId: b.orgId,
        label: "Victim period",
        periodStart: new Date(),
        periodEnd: new Date(),
        payDate: new Date(),
        status: "DRAFT",
      },
    });
    victim.periodId = period.id;
    const record = await prisma.payrollRecord.create({
      data: {
        periodId: period.id,
        employeeId: employee.id,
        grossSalary: 10000,
        bonusTotal: 0,
        deductionTotal: 0,
        netSalary: 10000,
        currency: "USD",
        status: "DRAFT",
      },
    });
    victim.payrollRecordId = record.id;

    const cycle = await prisma.performanceCycle.create({
      data: { organizationId: b.orgId, name: "Victim cycle", startDate: new Date(), endDate: new Date() },
    });
    victim.cycleId = cycle.id;
    const review = await prisma.performanceReview.create({
      data: {
        cycleId: cycle.id,
        employeeId: employee.id,
        authorId: b.userId,
        summary: "secret review",
        status: "DRAFT",
      },
    });
    victim.reviewId = review.id;
    const objective = await prisma.objective.create({
      data: { employeeId: employee.id, title: "Victim objective" },
    });
    victim.objectiveId = objective.id;

    const role = await prisma.role.create({ data: { organizationId: b.orgId, name: `Victim role ${unique}` } });
    victim.roleId = role.id;
    const assignment = await prisma.userRole.create({ data: { userId: b.userId, roleId: role.id } });
    victim.assignmentId = assignment.id;
    const notification = await prisma.notification.create({
      data: { organizationId: b.orgId, userId: b.userId, type: "test", title: "Victim notification" },
    });
    victim.notificationId = notification.id;

    ensureStorage();
    const fileName = `victim-${unique}.txt`;
    fs.writeFileSync(path.join(uploadsDir(), fileName), "confidential payslip");
    const document = await prisma.document.create({
      data: {
        organizationId: b.orgId,
        employeeId: employee.id,
        uploadedById: b.userId,
        fileName,
        originalName: "payslip.txt",
        mimeType: "text/plain",
        sizeBytes: 20,
        storagePath: path.join("uploads", fileName),
        source: "upload",
      },
    });
    victim.documentId = document.id;
    victim.documentFile = path.join(uploadsDir(), fileName);
  });

  afterAll(async () => {
    if (victim.documentFile) fs.rmSync(victim.documentFile, { force: true });
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

  describe("documents", () => {
    it.each([
      ["GET", ""],
      ["GET", "/download"],
      ["DELETE", ""],
    ])("%s /documents/:id%s returns 404", async (method, suffix) => {
      const url = `/api/v1/documents/${victim.documentId}${suffix}`;
      const res = await request(app)[method.toLowerCase() as "get" | "delete"](url).set(asA());
      expect(res.status).toBe(404);
      expect(res.text).not.toContain("confidential");
    });

    it("rejects uploads attached to another org's employee", async () => {
      const res = await request(app)
        .post("/api/v1/documents/upload")
        .set(asA())
        .field("employeeId", victim.employeeId)
        .attach("file", Buffer.from("%PDF-1.4 test"), { filename: "x.pdf", contentType: "application/pdf" });
      expect(res.status).toBe(404);
    });

    it("left the victim document and file untouched", async () => {
      expect(await prisma.document.findUnique({ where: { id: victim.documentId } })).not.toBeNull();
      expect(fs.existsSync(victim.documentFile)).toBe(true);
    });
  });

  describe("departments & teams", () => {
    it.each([
      ["GET", (): string => `/api/v1/departments/${victim.departmentId}`, undefined],
      ["PATCH", (): string => `/api/v1/departments/${victim.departmentId}`, { name: "Hacked" }],
      ["DELETE", (): string => `/api/v1/departments/${victim.departmentId}`, undefined],
      [
        "PUT",
        (): string => `/api/v1/departments/${victim.departmentId}/manager`,
        (): object => ({ managerId: victim.employeeId }),
      ],
      [
        "POST",
        (): string => `/api/v1/departments/${victim.departmentId}/employees`,
        (): object => ({ employeeId: victim.employeeId }),
      ],
      [
        "POST",
        (): string => "/api/v1/departments/transfer",
        (): object => ({ employeeId: victim.employeeId, targetDepartmentId: victim.departmentId }),
      ],
      ["PATCH", (): string => `/api/v1/departments/teams/${victim.teamId}`, { name: "Hacked" }],
      ["DELETE", (): string => `/api/v1/departments/teams/${victim.teamId}`, undefined],
      [
        "POST",
        (): string => `/api/v1/departments/teams/${victim.teamId}/members`,
        (): object => ({ employeeId: victim.employeeId }),
      ],
      ["DELETE", (): string => `/api/v1/departments/teams/members/${victim.employeeId}`, undefined],
    ] as const)("%s %s returns 404", async (method, url, body) => {
      const req = request(app)[method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete"](url()).set(asA());
      const payload = typeof body === "function" ? body() : body;
      const res = await (payload ? req.send(payload) : req);
      expect(res.status).toBe(404);
    });

    it("cannot create a team under another org's department", async () => {
      const res = await request(app)
        .post("/api/v1/departments/teams")
        .set(asA())
        .send({ name: "Intruders", departmentId: victim.departmentId });
      expect(res.status).toBe(404);
    });

    it("left the victim department and team untouched", async () => {
      const department = await prisma.department.findUnique({ where: { id: victim.departmentId } });
      expect(department?.name).toBe("Victim Dept");
      expect(department?.managerId).toBeNull();
      const team = await prisma.team.findUnique({ where: { id: victim.teamId } });
      expect(team?.name).toBe("Victim Team");
    });
  });

  describe("leave", () => {
    const today = () => new Date().toISOString();
    it.each([
      ["POST", (): string => `/api/v1/leave/requests/${victim.leaveRequestId}/approve`, {}],
      ["POST", (): string => `/api/v1/leave/requests/${victim.leaveRequestId}/reject`, {}],
      ["POST", (): string => `/api/v1/leave/requests/${victim.leaveRequestId}/cancel`, {}],
      ["GET", (): string => `/api/v1/leave/balances/${victim.employeeId}`, undefined],
      ["GET", (): string => `/api/v1/leave/history/${victim.employeeId}`, undefined],
      ["GET", (): string => `/api/v1/leave/calendar/${victim.departmentId}`, undefined],
      [
        "PUT",
        (): string => "/api/v1/leave/balances",
        (): object => ({
          employeeId: victim.employeeId,
          leaveTypeId: victim.leaveTypeId,
          year: 2026,
          entitledDays: 999,
        }),
      ],
      [
        "POST",
        (): string => "/api/v1/leave/requests",
        (): object => ({
          employeeId: victim.employeeId,
          leaveTypeId: victim.leaveTypeId,
          startDate: today(),
          endDate: today(),
        }),
      ],
    ] as const)("%s %s returns 404", async (method, url, body) => {
      const req = request(app)[method.toLowerCase() as "get" | "post" | "put"](url()).set(asA());
      const payload = typeof body === "function" ? body() : body;
      const res = await (payload ? req.send(payload) : req);
      expect(res.status).toBe(404);
    });

    it("left the victim leave request untouched", async () => {
      const leave = await prisma.leaveRequest.findUnique({ where: { id: victim.leaveRequestId } });
      expect(leave?.status).toBe("PENDING");
      expect(await prisma.leaveBalance.count({ where: { employeeId: victim.employeeId } })).toBe(0);
      expect(await prisma.leaveRequest.count({ where: { employeeId: victim.employeeId } })).toBe(1);
    });
  });

  describe("payroll", () => {
    it.each([
      ["POST", (): string => `/api/v1/payroll/periods/${victim.periodId}/generate`, {}],
      ["GET", (): string => `/api/v1/payroll/periods/${victim.periodId}/records`, undefined],
      ["GET", (): string => `/api/v1/payroll/periods/${victim.periodId}/report`, undefined],
      ["POST", (): string => `/api/v1/payroll/periods/${victim.periodId}/submit`, {}],
      ["POST", (): string => `/api/v1/payroll/periods/${victim.periodId}/approve`, {}],
      ["POST", (): string => `/api/v1/payroll/periods/${victim.periodId}/pay`, {}],
      ["GET", (): string => `/api/v1/payroll/records/${victim.payrollRecordId}`, undefined],
      [
        "POST",
        (): string => `/api/v1/payroll/records/${victim.payrollRecordId}/bonuses`,
        { label: "x", amount: 1000000 },
      ],
      [
        "POST",
        (): string => `/api/v1/payroll/records/${victim.payrollRecordId}/deductions`,
        { label: "x", amount: 1000000 },
      ],
    ] as const)("%s %s returns 404", async (method, url, body) => {
      const req = request(app)[method.toLowerCase() as "get" | "post"](url()).set(asA());
      const res = await (body ? req.send(body) : req);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain("10000");
    });

    it("left the victim payroll untouched", async () => {
      const period = await prisma.payrollPeriod.findUnique({ where: { id: victim.periodId } });
      expect(period?.status).toBe("DRAFT");
      const record = await prisma.payrollRecord.findUnique({
        where: { id: victim.payrollRecordId },
        include: { bonuses: true, deductions: true },
      });
      expect(record?.bonuses).toHaveLength(0);
      expect(record?.deductions).toHaveLength(0);
      expect(record?.netSalary.toString()).toBe("10000");
    });
  });

  describe("performance", () => {
    it.each([
      ["GET", (): string => `/api/v1/performance/reviews/${victim.reviewId}`, undefined],
      ["PATCH", (): string => `/api/v1/performance/reviews/${victim.reviewId}`, (): object => ({ summary: "Hacked" })],
      [
        "POST",
        (): string => "/api/v1/performance/reviews",
        (): object => ({ cycleId: victim.cycleId, employeeId: victim.employeeId }),
      ],
      ["GET", (): string => `/api/v1/performance/objectives/${victim.employeeId}`, undefined],
      [
        "POST",
        (): string => "/api/v1/performance/objectives",
        (): object => ({ employeeId: victim.employeeId, title: "Injected" }),
      ],
      [
        "PATCH",
        (): string => `/api/v1/performance/objectives/${victim.objectiveId}`,
        (): object => ({ title: "Hacked" }),
      ],
      ["DELETE", (): string => `/api/v1/performance/objectives/${victim.objectiveId}`, undefined],
    ] as const)("%s %s returns 404", async (method, url, body) => {
      const req = request(app)[method.toLowerCase() as "get" | "post" | "patch" | "delete"](url()).set(asA());
      const payload = typeof body === "function" ? body() : body;
      const res = await (payload ? req.send(payload) : req);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain("secret review");
    });

    it("does not list another org's reviews when filtering by its employee", async () => {
      const res = await request(app).get(`/api/v1/performance/reviews?employeeId=${victim.employeeId}`).set(asA());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it("left the victim review and objective untouched", async () => {
      const review = await prisma.performanceReview.findUnique({ where: { id: victim.reviewId } });
      expect(review?.summary).toBe("secret review");
      const objective = await prisma.objective.findUnique({ where: { id: victim.objectiveId } });
      expect(objective?.title).toBe("Victim objective");
      expect(await prisma.objective.count({ where: { employeeId: victim.employeeId } })).toBe(1);
    });
  });

  describe("roles", () => {
    it.each([
      ["PATCH", (): string => `/api/v1/roles/${victim.roleId}`, (): object => ({ name: "Hacked" })],
      ["DELETE", (): string => `/api/v1/roles/${victim.roleId}`, undefined],
      ["DELETE", (): string => `/api/v1/roles/assignments/${victim.assignmentId}`, undefined],
      ["POST", (): string => "/api/v1/roles/assignments", (): object => ({ userId: b.userId, roleId: victim.roleId })],
      ["PUT", (): string => `/api/v1/roles/users/${b.userId}/system-role`, (): object => ({ systemRole: "EMPLOYEE" })],
    ] as const)("%s %s returns 404", async (method, url, body) => {
      const req = request(app)[method.toLowerCase() as "post" | "put" | "patch" | "delete"](url()).set(asA());
      const payload = typeof body === "function" ? body() : body;
      const res = await (payload ? req.send(payload) : req);
      expect(res.status).toBe(404);
    });

    it("cannot assign one of its own roles to another org's user", async () => {
      const own = await prisma.role.create({ data: { organizationId: a.orgId, name: `Own role ${unique}` } });
      const res = await request(app)
        .post("/api/v1/roles/assignments")
        .set(asA())
        .send({ userId: b.userId, roleId: own.id });
      expect(res.status).toBe(404);
    });

    it("left the victim roles untouched", async () => {
      expect((await prisma.role.findUnique({ where: { id: victim.roleId } }))?.name).toBe(`Victim role ${unique}`);
      expect(await prisma.userRole.findUnique({ where: { id: victim.assignmentId } })).not.toBeNull();
      expect(await prisma.userRole.count({ where: { userId: b.userId } })).toBe(1);
      expect((await prisma.user.findUnique({ where: { id: b.userId } }))?.systemRole).toBe("ORGANIZATION_ADMIN");
    });
  });

  describe("notifications", () => {
    it("cannot mark another user's notification as read", async () => {
      const res = await request(app).post(`/api/v1/notifications/${victim.notificationId}/read`).set(asA());
      expect(res.status).toBe(404);
      const notification = await prisma.notification.findUnique({ where: { id: victim.notificationId } });
      expect(notification?.status).toBe("UNREAD");
    });
  });

  describe("organizations", () => {
    it.each([
      ["GET", "", undefined],
      ["GET", "/stats", undefined],
      ["PATCH", "", { name: "Hacked" }],
      ["PUT", "/settings", { settings: { hacked: true } }],
      ["PUT", "/subscription", { plan: "ENTERPRISE", seats: 100000 }],
      ["GET", "/admins", undefined],
      ["POST", "/admins", { email: `backdoor-${unique}@test.example`, password, firstName: "Back", lastName: "Door" }],
    ] as const)("%s /organizations/:id%s returns 404", async (method, suffix, body) => {
      const req = request(app)
        [method.toLowerCase() as "get" | "post" | "put" | "patch"](`/api/v1/organizations/${b.orgId}${suffix}`)
        .set(asA());
      const res = await (body ? req.send(body) : req);
      expect(res.status).toBe(404);
    });

    it("still lets an admin read its own organization", async () => {
      const res = await request(app).get(`/api/v1/organizations/${a.orgId}`).set(asA());
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(a.orgId);
    });

    it("left the victim organization untouched", async () => {
      const org = await prisma.organization.findUnique({ where: { id: b.orgId }, include: { subscription: true } });
      expect(org?.name).toBe(b.name);
      expect(org?.subscription?.plan).toBe("FREE");
      expect(await prisma.user.count({ where: { organizationId: b.orgId } })).toBe(1);
    });
  });
});
