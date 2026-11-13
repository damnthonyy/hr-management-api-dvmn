import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { SystemRole } from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { closeRedis } from "../src/lib/redis";
import { closeQueues } from "../src/queues";
import { ALL_PERMISSIONS, PERMISSIONS } from "../src/config/permissions";
import { hashPassword } from "../src/utils/password";

/**
 * Privilege checks inside a single organization: nobody can hand out more
 * than they hold, and only a SUPER_ADMIN can create another SUPER_ADMIN.
 */
const app = createApp();
const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const password = "Password123!";

let orgId = "";
let admin = { id: "", token: "" };
const users: Record<string, { id: string; token: string; email: string }> = {};

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string): Promise<string> {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.tokens.accessToken;
}

async function createUser(label: string, systemRole: SystemRole) {
  const email = `${label}-${unique}@test.example`;
  const user = await prisma.user.create({
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
  users[label] = { id: user.id, email, token: await login(email) };
  return users[label];
}

async function createCustomRole(name: string, keys: string[]) {
  const permissions = await prisma.permission.findMany({ where: { key: { in: keys } } });
  return prisma.role.create({
    data: {
      organizationId: orgId,
      name: `${name} ${unique}`,
      permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
    },
  });
}

describe("privilege escalation", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.permission.createMany({
      data: ALL_PERMISSIONS.map((key) => ({ key, description: key })),
      skipDuplicates: true,
    });

    const res = await request(app).post("/api/v1/auth/register").send({
      organizationName: `Priv Org ${unique}`,
      email: `owner-${unique}@test.example`,
      password,
      firstName: "Owner",
      lastName: "Admin",
    });
    expect(res.status).toBe(201);
    orgId = res.body.data.organization.id;
    admin = { id: res.body.data.user.id, token: res.body.data.tokens.accessToken };

    await createUser("hr", SystemRole.HR_MANAGER);
    await createUser("peer", SystemRole.EMPLOYEE);

    // An employee who was delegated role:manage only, through a custom role.
    const delegate = await createUser("delegate", SystemRole.EMPLOYEE);
    const roleManager = await createCustomRole("Role manager", [PERMISSIONS.ROLE_MANAGE]);
    await prisma.userRole.create({ data: { userId: delegate.id, roleId: roleManager.id } });
  });

  afterAll(async () => {
    if (orgId) await prisma.organization.deleteMany({ where: { id: orgId } });
    await closeQueues().catch(() => undefined);
    await prisma.$disconnect();
    await closeRedis().catch(() => undefined);
  });

  describe("system roles", () => {
    it("an org admin cannot promote themselves to SUPER_ADMIN", async () => {
      const res = await request(app)
        .put(`/api/v1/roles/users/${admin.id}/system-role`)
        .set(bearer(admin.token))
        .send({ systemRole: "SUPER_ADMIN" });
      expect(res.status).toBe(403);
    });

    it("an org admin cannot promote another user to SUPER_ADMIN", async () => {
      const res = await request(app)
        .put(`/api/v1/roles/users/${users.hr.id}/system-role`)
        .set(bearer(admin.token))
        .send({ systemRole: "SUPER_ADMIN" });
      expect(res.status).toBe(403);
    });

    it("an org admin can still assign a role within their privileges", async () => {
      const res = await request(app)
        .put(`/api/v1/roles/users/${users.peer.id}/system-role`)
        .set(bearer(admin.token))
        .send({ systemRole: "FINANCE_MANAGER" });
      expect(res.status).toBe(200);
      expect(res.body.data.systemRole).toBe("FINANCE_MANAGER");
    });

    it("a delegated role manager cannot promote anyone to ORGANIZATION_ADMIN", async () => {
      const res = await request(app)
        .put(`/api/v1/roles/users/${users.delegate.id}/system-role`)
        .set(bearer(users.delegate.token))
        .send({ systemRole: "ORGANIZATION_ADMIN" });
      expect(res.status).toBe(403);
      const other = await request(app)
        .put(`/api/v1/roles/users/${users.hr.id}/system-role`)
        .set(bearer(users.delegate.token))
        .send({ systemRole: "ORGANIZATION_ADMIN" });
      expect(other.status).toBe(403);
    });

    it("a delegated role manager cannot demote the org admin", async () => {
      const res = await request(app)
        .put(`/api/v1/roles/users/${admin.id}/system-role`)
        .set(bearer(users.delegate.token))
        .send({ systemRole: "EMPLOYEE" });
      expect(res.status).toBe(403);
    });

    it("a demotion takes effect immediately, without waiting for token expiry", async () => {
      const before = await request(app).get("/api/v1/employees").set(bearer(users.hr.token));
      expect(before.status).toBe(200);
      const res = await request(app)
        .put(`/api/v1/roles/users/${users.hr.id}/system-role`)
        .set(bearer(admin.token))
        .send({ systemRole: "EMPLOYEE" });
      expect(res.status).toBe(200);
      const after = await request(app).get("/api/v1/employees").set(bearer(users.hr.token));
      expect(after.status).toBe(403);
    });
  });

  describe("custom roles", () => {
    it("rejects unknown permission keys", async () => {
      const res = await request(app)
        .post("/api/v1/roles")
        .set(bearer(admin.token))
        .send({ name: `Bogus ${unique}`, permissions: ["everything:all"] });
      expect(res.status).toBe(400);
    });

    it("a delegated role manager cannot create a role with permissions they lack", async () => {
      const res = await request(app)
        .post("/api/v1/roles")
        .set(bearer(users.delegate.token))
        .send({ name: `Payroll god ${unique}`, permissions: [PERMISSIONS.PAYROLL_MANAGE, PERMISSIONS.SALARY_VIEW] });
      expect(res.status).toBe(403);
    });

    it("a delegated role manager cannot add permissions to an existing role", async () => {
      const own = await createCustomRole("Empty", []);
      const res = await request(app)
        .patch(`/api/v1/roles/${own.id}`)
        .set(bearer(users.delegate.token))
        .send({ permissions: [PERMISSIONS.USER_MANAGE] });
      expect(res.status).toBe(403);
    });

    it("a delegated role manager cannot assign a more powerful role to themselves", async () => {
      const powerful = await createCustomRole("Powerful", [PERMISSIONS.PAYROLL_MANAGE, PERMISSIONS.ROLE_MANAGE]);
      const res = await request(app)
        .post("/api/v1/roles/assignments")
        .set(bearer(users.delegate.token))
        .send({ userId: users.delegate.id, roleId: powerful.id });
      expect(res.status).toBe(403);
    });

    it("an org admin can create and assign a role within their privileges", async () => {
      const created = await request(app)
        .post("/api/v1/roles")
        .set(bearer(admin.token))
        .send({ name: `Payroll clerk ${unique}`, permissions: [PERMISSIONS.PAYROLL_VIEW] });
      expect(created.status).toBe(201);
      const assigned = await request(app)
        .post("/api/v1/roles/assignments")
        .set(bearer(admin.token))
        .send({ userId: users.peer.id, roleId: created.body.data.id });
      expect(assigned.status).toBe(201);
    });
  });
});
