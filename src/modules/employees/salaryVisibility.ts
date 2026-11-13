import { PERMISSIONS } from "../../config/permissions";
import type { AuthContext } from "../../types/express";

/**
 * Salary data is guarded by salary:view / salary:manage, but employee
 * endpoints only require employee:view / employee:update. These helpers keep
 * the salary fields out of employee responses for callers without
 * salary:view.
 */
export const canViewSalary = (auth: AuthContext): boolean => auth.permissions.includes(PERMISSIONS.SALARY_VIEW);
export const canManageSalary = (auth: AuthContext): boolean => auth.permissions.includes(PERMISSIONS.SALARY_MANAGE);

const SALARY_FIELDS = ["baseSalary", "currency", "salaryHistory"] as const;

export function redactContract<T extends object>(contract: T): Omit<T, "salary" | "currency"> {
  const { salary, currency, ...rest } = contract as T & { salary?: unknown; currency?: unknown };
  void salary;
  void currency;
  return rest;
}

export function redactEmployee<T extends object>(employee: T): Omit<T, (typeof SALARY_FIELDS)[number]> {
  const copy: Record<string, unknown> = { ...(employee as Record<string, unknown>) };
  for (const field of SALARY_FIELDS) delete copy[field];
  if (Array.isArray(copy.contracts)) copy.contracts = copy.contracts.map((contract: object) => redactContract(contract));
  return copy as Omit<T, (typeof SALARY_FIELDS)[number]>;
}

export function employeeView<T extends object>(auth: AuthContext, employee: T) {
  return canViewSalary(auth) ? employee : redactEmployee(employee);
}
