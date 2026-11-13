import { type SystemRole } from "@prisma/client";

export const PERMISSIONS = {
  EMPLOYEE_VIEW: "employee:view",
  EMPLOYEE_CREATE: "employee:create",
  EMPLOYEE_UPDATE: "employee:update",
  EMPLOYEE_DELETE: "employee:delete",
  SALARY_VIEW: "salary:view",
  SALARY_MANAGE: "salary:manage",
  DEPARTMENT_VIEW: "department:view",
  DEPARTMENT_MANAGE: "department:manage",
  LEAVE_VIEW: "leave:view",
  LEAVE_APPROVE: "leave:approve",
  LEAVE_MANAGE: "leave:manage",
  CONTRACT_VIEW: "contract:view",
  PAYROLL_VIEW: "payroll:view",
  PAYROLL_MANAGE: "payroll:manage",
  PERFORMANCE_VIEW: "performance:view",
  PERFORMANCE_MANAGE: "performance:manage",
  DOCUMENT_VIEW: "document:view",
  DOCUMENT_MANAGE: "document:manage",
  NOTIFICATION_VIEW: "notification:view",
  REPORT_VIEW: "report:view",
  ORGANIZATION_MANAGE: "organization:manage",
  ROLE_MANAGE: "role:manage",
  AUDIT_VIEW: "audit:view",
  USER_MANAGE: "user:manage",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS);

export const ROLE_PERMISSIONS: Record<SystemRole, PermissionKey[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  ORGANIZATION_ADMIN: [
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.EMPLOYEE_CREATE,
    PERMISSIONS.EMPLOYEE_UPDATE,
    PERMISSIONS.EMPLOYEE_DELETE,
    PERMISSIONS.SALARY_VIEW,
    PERMISSIONS.SALARY_MANAGE,
    PERMISSIONS.DEPARTMENT_VIEW,
    PERMISSIONS.DEPARTMENT_MANAGE,
    PERMISSIONS.LEAVE_VIEW,
    PERMISSIONS.LEAVE_APPROVE,
    PERMISSIONS.LEAVE_MANAGE,
    PERMISSIONS.CONTRACT_VIEW,
    PERMISSIONS.PAYROLL_VIEW,
    PERMISSIONS.PAYROLL_MANAGE,
    PERMISSIONS.PERFORMANCE_VIEW,
    PERMISSIONS.PERFORMANCE_MANAGE,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_MANAGE,
    PERMISSIONS.NOTIFICATION_VIEW,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.ORGANIZATION_MANAGE,
    PERMISSIONS.ROLE_MANAGE,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.USER_MANAGE,
  ],
  HR_MANAGER: [
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.EMPLOYEE_CREATE,
    PERMISSIONS.EMPLOYEE_UPDATE,
    PERMISSIONS.DEPARTMENT_VIEW,
    PERMISSIONS.LEAVE_VIEW,
    PERMISSIONS.LEAVE_APPROVE,
    PERMISSIONS.LEAVE_MANAGE,
    PERMISSIONS.CONTRACT_VIEW,
    PERMISSIONS.PERFORMANCE_VIEW,
    PERMISSIONS.PERFORMANCE_MANAGE,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.DOCUMENT_MANAGE,
    PERMISSIONS.NOTIFICATION_VIEW,
    PERMISSIONS.REPORT_VIEW,
  ],
  DEPARTMENT_MANAGER: [
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.DEPARTMENT_VIEW,
    PERMISSIONS.LEAVE_VIEW,
    PERMISSIONS.LEAVE_APPROVE,
    PERMISSIONS.PERFORMANCE_VIEW,
    PERMISSIONS.PERFORMANCE_MANAGE,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.NOTIFICATION_VIEW,
    PERMISSIONS.REPORT_VIEW,
  ],
  FINANCE_MANAGER: [
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.SALARY_VIEW,
    PERMISSIONS.PAYROLL_VIEW,
    PERMISSIONS.PAYROLL_MANAGE,
    PERMISSIONS.CONTRACT_VIEW,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.NOTIFICATION_VIEW,
    PERMISSIONS.REPORT_VIEW,
  ],
  EMPLOYEE: [
    PERMISSIONS.LEAVE_VIEW,
    PERMISSIONS.DOCUMENT_VIEW,
    PERMISSIONS.NOTIFICATION_VIEW,
    PERMISSIONS.PERFORMANCE_VIEW,
  ],
};

export function permissionsForRole(role: SystemRole): PermissionKey[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/** Minimal view of the caller needed for privilege checks. */
export interface Grantor {
  userId: string;
  role: SystemRole;
  permissions: readonly string[];
}

/** Permissions from `required` that `granted` does not hold. */
export function missingPermissions(granted: readonly string[], required: readonly string[]): string[] {
  return required.filter((permission) => !granted.includes(permission));
}

/**
 * A caller may only hand out privileges they already hold:
 * - SUPER_ADMIN is a cross-tenant role and can only be granted by a SUPER_ADMIN;
 * - any other system role is grantable only if its permission set is a
 *   subset of the caller's permissions.
 */
export function canGrantSystemRole(grantor: Grantor, target: SystemRole): boolean {
  if (grantor.role === "SUPER_ADMIN") return true;
  if (target === "SUPER_ADMIN") return false;
  return missingPermissions(grantor.permissions, permissionsForRole(target)).length === 0;
}

export function isKnownPermission(key: string): key is PermissionKey {
  return (ALL_PERMISSIONS as string[]).includes(key);
}
