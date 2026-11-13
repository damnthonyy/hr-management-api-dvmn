import { Router, Request, Response } from "express";
import authRoutes from "./modules/auth/auth.routes";
import organizationRoutes from "./modules/organizations/organization.routes";
import employeeRoutes from "./modules/employees/employee.routes";
import departmentRoutes from "./modules/departments/department.routes";
import roleRoutes from "./modules/roles/role.routes";
import leaveRoutes from "./modules/leave/leave.routes";
import payrollRoutes from "./modules/payroll/payroll.routes";
import performanceRoutes from "./modules/performance/performance.routes";
import documentRoutes from "./modules/documents/document.routes";
import notificationRoutes from "./modules/notifications/notification.routes";
import auditRoutes from "./modules/audit/audit.routes";
import reportRoutes from "./modules/reports/report.routes";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: { name: "HR Management API", version: "v1", status: "ok" },
  });
});

router.use("/auth", authRoutes);
router.use("/organizations", organizationRoutes);
router.use("/employees", employeeRoutes);
router.use("/departments", departmentRoutes);
router.use("/roles", roleRoutes);
router.use("/leave", leaveRoutes);
router.use("/payroll", payrollRoutes);
router.use("/performance", performanceRoutes);
router.use("/documents", documentRoutes);
router.use("/notifications", notificationRoutes);
router.use("/audit-logs", auditRoutes);
router.use("/reports", reportRoutes);

export default router;
