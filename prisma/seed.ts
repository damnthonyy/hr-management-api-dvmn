import { PrismaClient, SystemRole, Prisma } from "@prisma/client";
import argon2 from "argon2";
import crypto from "crypto";

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = "Password123!";

const PERMISSION_CATALOG: Array<{ key: string; description: string }> = [
  { key: "employee:view", description: "View employees" },
  { key: "employee:create", description: "Create employees" },
  { key: "employee:update", description: "Edit employee information" },
  { key: "employee:delete", description: "Delete employees" },
  { key: "salary:view", description: "View salaries" },
  { key: "salary:manage", description: "Manage salaries" },
  { key: "department:view", description: "View departments" },
  { key: "department:manage", description: "Manage departments" },
  { key: "leave:view", description: "View leave" },
  { key: "leave:approve", description: "Approve leave requests" },
  { key: "leave:manage", description: "Manage leave configuration" },
  { key: "contract:view", description: "View contracts" },
  { key: "payroll:view", description: "View payroll" },
  { key: "payroll:manage", description: "Manage payroll" },
  { key: "performance:view", description: "View performance" },
  { key: "performance:manage", description: "Manage performance" },
  { key: "document:view", description: "View documents" },
  { key: "document:manage", description: "Manage documents" },
  { key: "notification:view", description: "View notifications" },
  { key: "report:view", description: "View reports" },
  { key: "organization:manage", description: "Manage organization settings" },
  { key: "role:manage", description: "Manage roles" },
  { key: "audit:view", description: "View audit logs" },
  { key: "user:manage", description: "Manage users" },
];

interface OrgBlueprint {
  name: string;
  slug: string;
  currency: string;
  departments: string[];
  firstNames: string[];
  lastNames: string[];
  titles: string[];
}

const ORGANIZATIONS: OrgBlueprint[] = [
  {
    name: "Nordwind Logistics",
    slug: "nordwind",
    currency: "EUR",
    departments: ["Operations", "Finance", "People", "Engineering", "Customer Success", "Legal"],
    firstNames: ["Lena", "Omar", "Sofia", "Mateo", "Ingrid", "Tariq", "Nina", "Felix", "Aisha", "Jonas", "Clara", "Ravi", "Elsa", "Noah", "Yuki", "Diego", "Maya", "Paul"],
    lastNames: ["Berg", "Haddad", "Rossi", "Weber", "Lind", "Khan", "Novak", "Meyer", "Okafor", "Holm", "Dubois", "Patel", "Strand", "Keller", "Tanaka", "Moreno", "Singh", "Braun"],
    titles: ["Operations Lead", "Financial Analyst", "People Partner", "Backend Engineer", "Support Specialist", "Legal Counsel", "Logistics Coordinator", "Account Manager", "Data Engineer", "Recruiter"],
  },
  {
    name: "Brightwave Health",
    slug: "brightwave",
    currency: "USD",
    departments: ["Clinical", "Research", "Finance", "Human Resources", "Information Technology", "Marketing"],
    firstNames: ["Grace", "Hassan", "Priya", "Daniel", "Zoe", "Marcus", "Lucia", "Ethan", "Fatima", "Oliver", "Hannah", "Kwame", "Isla", "Leo", "Mei", "Samuel", "Nora", "Ivan"],
    lastNames: ["Bennett", "Ali", "Nair", "Fisher", "Clarke", "Reed", "Marin", "Walsh", "Hassan", "Grant", "Lowe", "Mensah", "Doyle", "Park", "Chen", "Ford", "Hale", "Petrov"],
    titles: ["Clinical Nurse", "Research Associate", "Accountant", "HR Generalist", "Systems Administrator", "Marketing Specialist", "Lab Technician", "Program Manager", "Data Analyst", "Coordinator"],
  },
  {
    name: "Cobalt Studios",
    slug: "cobalt",
    currency: "GBP",
    departments: ["Design", "Engineering", "Production", "Finance", "People Ops", "Business Development"],
    firstNames: ["Amelia", "Idris", "Chloe", "Victor", "Sara", "Theo", "Naomi", "Hugo", "Layla", "Max", "Ruby", "Ade", "Freya", "Gabriel", "Hana", "Louis", "Esther", "Ben"],
    lastNames: ["Wright", "Okoye", "Turner", "Kozlov", "Day", "Brooks", "Cole", "Vega", "Aziz", "Shaw", "Frost", "Bello", "Noble", "Ramos", "Kim", "Faure", "Stone", "Webb"],
    titles: ["Product Designer", "Game Engineer", "Producer", "Finance Partner", "People Ops Lead", "BizDev Manager", "Technical Artist", "QA Engineer", "Animator", "Studio Coordinator"],
  },
];

function pick<T>(items: T[], index: number): T {
  return items[index % items.length];
}

function randomDateWithin(daysBack: number): Date {
  const offset = Math.floor(Math.random() * daysBack);
  return new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (/\/(production|prod)(\?|$)/i.test(url)) {
    throw new Error("Refusing to seed what looks like a production database");
  }

  console.log("Clearing existing data...");
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.bonus.deleteMany(),
    prisma.deduction.deleteMany(),
    prisma.payrollRecord.deleteMany(),
    prisma.payrollPeriod.deleteMany(),
    prisma.objective.deleteMany(),
    prisma.performanceReview.deleteMany(),
    prisma.performanceCycle.deleteMany(),
    prisma.leaveRequest.deleteMany(),
    prisma.leaveBalance.deleteMany(),
    prisma.leaveType.deleteMany(),
    prisma.salaryHistory.deleteMany(),
    prisma.employmentContract.deleteMany(),
    prisma.emergencyContact.deleteMany(),
    prisma.document.deleteMany(),
    prisma.documentCategory.deleteMany(),
  ]);
  await prisma.$transaction([
    prisma.userRole.deleteMany(),
    prisma.rolePermission.deleteMany(),
    prisma.role.deleteMany(),
    prisma.permission.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.session.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.emailVerificationToken.deleteMany(),
    prisma.loginHistory.deleteMany(),
  ]);
  await prisma.team.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.department.deleteMany();
  await prisma.user.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.organization.deleteMany();

  console.log("Seeding permissions...");
  await prisma.permission.createMany({ data: PERMISSION_CATALOG });
  const permissions = await prisma.permission.findMany();

  const passwordHash = await argon2.hash(DEFAULT_PASSWORD, { type: argon2.argon2id });

  const credentials: Array<{ organization: string; role: string; email: string }> = [];

  for (const blueprint of ORGANIZATIONS) {
    console.log(`Seeding organization ${blueprint.name}...`);
    const organization = await prisma.organization.create({
      data: {
        name: blueprint.name,
        slug: blueprint.slug,
        legalName: `${blueprint.name} Ltd`,
        currency: blueprint.currency,
        employeeLimit: 200,
        timezone: "UTC",
        settings: { onboarding: { completed: true }, features: { payroll: true, performance: true } },
        subscription: { create: { plan: "BUSINESS", status: "ACTIVE", seats: 200, renewsAt: new Date(Date.now() + 180 * 86400000) } },
      },
    });

    const departments = [];
    for (const deptName of blueprint.departments) {
      const dept = await prisma.department.create({
        data: {
          organizationId: organization.id,
          name: deptName,
          code: deptName.slice(0, 3).toUpperCase() + Math.floor(Math.random() * 90 + 10),
          description: `${deptName} department at ${blueprint.name}`,
        },
      });
      departments.push(dept);
    }

    const role = await prisma.role.create({
      data: {
        organizationId: organization.id,
        name: "Custom HR Operations",
        description: "Extended HR operations role",
        isSystem: false,
        permissions: {
          create: permissions
            .filter((p) => p.key.startsWith("employee:") || p.key.startsWith("leave:") || p.key.startsWith("document:"))
            .map((p) => ({ permissionId: p.id })),
        },
      },
    });

    const leaveTypes = [];
    for (const [idx, lt] of [
      { name: "Annual Leave", code: "ANNUAL", defaultDays: 25 },
      { name: "Sick Leave", code: "SICK", defaultDays: 10 },
      { name: "Parental Leave", code: "PARENTAL", defaultDays: 90 },
      { name: "Unpaid Leave", code: "UNPAID", defaultDays: 0, paid: false },
    ].entries()) {
      const created = await prisma.leaveType.create({
        data: {
          organizationId: organization.id,
          name: lt.name,
          code: lt.code,
          defaultDays: lt.defaultDays,
          paid: (lt as { paid?: boolean }).paid ?? true,
        },
      });
      leaveTypes.push(created);
      void idx;
    }

    const roleAssignments: Array<{ role: SystemRole; title: string }> = [
      { role: SystemRole.ORGANIZATION_ADMIN, title: "Organization Administrator" },
      { role: SystemRole.HR_MANAGER, title: "HR Manager" },
      { role: SystemRole.HR_MANAGER, title: "Senior HR Manager" },
      { role: SystemRole.FINANCE_MANAGER, title: "Finance Manager" },
      { role: SystemRole.DEPARTMENT_MANAGER, title: "Department Manager" },
      { role: SystemRole.DEPARTMENT_MANAGER, title: "Department Manager" },
    ];

    const employees = [];
    const headcount = 18;
    let managerEmployeeId: string | null = null;

    for (let i = 0; i < headcount; i += 1) {
      const firstName = pick(blueprint.firstNames, i);
      const lastName = pick(blueprint.lastNames, i + 3);
      const department = pick(departments, i);
      const special = roleAssignments[i];
      const systemRole = special ? special.role : SystemRole.EMPLOYEE;
      const jobTitle = special ? special.title : pick(blueprint.titles, i);
      const baseSalary = 38000 + ((i * 2731) % 52000);
      const emailLocal = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, "");
      const email = `${emailLocal}@${blueprint.slug}.example`;

      let userId: string | null = null;
      if (special || i % 3 === 0) {
        const user = await prisma.user.create({
          data: {
            organizationId: organization.id,
            email,
            passwordHash,
            firstName,
            lastName,
            systemRole,
            emailVerified: true,
            lastLoginAt: randomDateWithin(20),
          },
        });
        userId = user.id;
        if (special) {
          credentials.push({ organization: blueprint.name, role: systemRole, email });
          await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
        }
      }

      const employee = await prisma.employee.create({
        data: {
          organizationId: organization.id,
          userId,
          employeeNumber: `${blueprint.slug.toUpperCase()}-${String(1000 + i)}`,
          firstName,
          lastName,
          email,
          phone: `+1-555-${String(1000 + i).padStart(4, "0")}`,
          jobTitle,
          status: i % 11 === 10 ? "TERMINATED" : "ACTIVE",
          departmentId: department.id,
          managerId: managerEmployeeId,
          startDate: randomDateWithin(900),
          terminationDate: i % 11 === 10 ? randomDateWithin(120) : null,
          baseSalary: new Prisma.Decimal(baseSalary),
          currency: blueprint.currency,
          nationalId: `NID-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
          dateOfBirth: new Date(1985 + (i % 15), i % 12, (i % 27) + 1),
          address: `${100 + i} Market Street`,
        },
      });
      employees.push(employee);

      if (i === 0) managerEmployeeId = employee.id;

      await prisma.emergencyContact.create({
        data: {
          employeeId: employee.id,
          name: `${pick(blueprint.firstNames, i + 5)} ${lastName}`,
          relationship: i % 2 === 0 ? "Spouse" : "Sibling",
          phone: `+1-555-${String(2000 + i).padStart(4, "0")}`,
        },
      });

      await prisma.employmentContract.create({
        data: {
          employeeId: employee.id,
          contractType: i % 5 === 0 ? "CONTRACT" : "FULL_TIME",
          title: jobTitle,
          startDate: employee.startDate,
          salary: new Prisma.Decimal(baseSalary),
          currency: blueprint.currency,
        },
      });

      await prisma.salaryHistory.create({
        data: {
          employeeId: employee.id,
          previousSalary: new Prisma.Decimal(baseSalary - 2000),
          newSalary: new Prisma.Decimal(baseSalary),
          currency: blueprint.currency,
          effectiveAt: randomDateWithin(400),
          reason: "Annual review adjustment",
        },
      });

      for (const leaveType of leaveTypes) {
        await prisma.leaveBalance.create({
          data: {
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            year: new Date().getFullYear(),
            entitledDays: new Prisma.Decimal(leaveType.defaultDays),
            usedDays: new Prisma.Decimal((i % 5) * 2),
          },
        });
      }
    }

    // Assign department managers
    for (const [idx, department] of departments.entries()) {
      const manager = employees[(idx % employees.length)];
      await prisma.department.update({ where: { id: department.id }, data: { managerId: manager.id } });
    }

    // Teams
    for (const department of departments.slice(0, 3)) {
      const team = await prisma.team.create({
        data: {
          organizationId: organization.id,
          departmentId: department.id,
          name: `${department.name} Core Team`,
          leadId: employees[0].id,
        },
      });
      await prisma.employee.updateMany({
        where: { departmentId: department.id },
        data: { teamId: team.id },
      });
    }

    // Leave requests in various states
    const statuses: Array<"PENDING" | "APPROVED" | "REJECTED" | "CANCELED"> = ["PENDING", "APPROVED", "REJECTED", "CANCELED"];
    for (let i = 0; i < 12; i += 1) {
      const employee = pick(employees, i);
      const leaveType = pick(leaveTypes, i);
      const start = randomDateWithin(60);
      const end = new Date(start.getTime() + ((i % 4) + 1) * 86400000);
      await prisma.leaveRequest.create({
        data: {
          organizationId: organization.id,
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          startDate: start,
          endDate: end,
          days: new Prisma.Decimal((i % 4) + 1),
          reason: "Personal time",
          status: statuses[i % statuses.length],
          decidedAt: i % statuses.length === 0 ? null : randomDateWithin(30),
        },
      });
    }

    // Performance cycle + reviews
    const cycle = await prisma.performanceCycle.create({
      data: {
        organizationId: organization.id,
        name: `${new Date().getFullYear()} Annual Review`,
        startDate: new Date(new Date().getFullYear(), 0, 1),
        endDate: new Date(new Date().getFullYear(), 11, 31),
      },
    });
    for (let i = 0; i < 10; i += 1) {
      const employee = pick(employees, i);
      await prisma.performanceReview.create({
        data: {
          cycleId: cycle.id,
          employeeId: employee.id,
          score: new Prisma.Decimal((3 + (i % 3) + Math.random()).toFixed(2)),
          summary: "Solid contributions across the review period",
          feedback: "Continue developing leadership and cross-team collaboration",
          status: i % 2 === 0 ? "FINALIZED" : "SUBMITTED",
          submittedAt: randomDateWithin(40),
        },
      });
      await prisma.objective.create({
        data: {
          employeeId: employee.id,
          title: "Improve delivery velocity",
          weight: 40,
          progress: (i * 9) % 100,
          status: i % 3 === 0 ? "COMPLETED" : "IN_PROGRESS",
        },
      });
    }

    // Payroll period + records
    const period = await prisma.payrollPeriod.create({
      data: {
        organizationId: organization.id,
        label: `${new Date().getFullYear()}-M${new Date().getMonth() + 1}`,
        periodStart: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        periodEnd: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        payDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 5),
        status: "APPROVED",
        approvedAt: new Date(),
      },
    });
    for (const employee of employees.slice(0, 15)) {
      const gross = Number(employee.baseSalary) / 12;
      const bonus = gross * 0.05;
      const deduction = gross * 0.18;
      const record = await prisma.payrollRecord.create({
        data: {
          periodId: period.id,
          employeeId: employee.id,
          grossSalary: new Prisma.Decimal(gross.toFixed(2)),
          bonusTotal: new Prisma.Decimal(bonus.toFixed(2)),
          deductionTotal: new Prisma.Decimal(deduction.toFixed(2)),
          netSalary: new Prisma.Decimal((gross + bonus - deduction).toFixed(2)),
          currency: blueprint.currency,
          status: "APPROVED",
        },
      });
      await prisma.bonus.create({ data: { payrollRecordId: record.id, label: "Performance bonus", amount: new Prisma.Decimal(bonus.toFixed(2)) } });
      await prisma.deduction.create({ data: { payrollRecordId: record.id, label: "Tax & benefits", amount: new Prisma.Decimal(deduction.toFixed(2)) } });
    }

    // Document categories + documents
    const docCategory = await prisma.documentCategory.create({
      data: { organizationId: organization.id, name: "Contracts" },
    });
    for (const employee of employees.slice(0, 6)) {
      await prisma.document.create({
        data: {
          organizationId: organization.id,
          employeeId: employee.id,
          categoryId: docCategory.id,
          fileName: `contract-${employee.employeeNumber}.pdf`,
          originalName: `Contract ${employee.lastName}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 125000 + Math.floor(Math.random() * 40000),
          storagePath: `uploads/seed-${employee.id}.pdf`,
          source: "upload",
          checksum: crypto.randomBytes(16).toString("hex"),
        },
      });
    }

    // Notifications + audit history
    const notifyUsers = await prisma.user.findMany({ where: { organizationId: organization.id }, select: { id: true } });
    for (const [i, u] of notifyUsers.entries()) {
      await prisma.notification.create({
        data: {
          organizationId: organization.id,
          userId: u.id,
          type: "welcome",
          title: "Welcome to the HR portal",
          body: "Your workspace is ready",
          status: i % 2 === 0 ? "UNREAD" : "READ",
          readAt: i % 2 === 0 ? null : new Date(),
        },
      });
      await prisma.auditLog.create({
        data: {
          organizationId: organization.id,
          userId: u.id,
          action: "user.login",
          entityType: "User",
          entityId: u.id,
          ipAddress: "203.0.113.10",
        },
      });
    }
  }

  console.log("\nSeed complete. Login accounts (password for all: " + DEFAULT_PASSWORD + "):");
  for (const c of credentials) {
    console.log(`  [${c.organization}] ${c.role.padEnd(20)} ${c.email}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
