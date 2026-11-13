import { type PaginationMeta } from "./response";

export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
/** Deep offsets are expensive for the database; nobody pages this far by hand. */
export const MAX_PAGE = 10_000;

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof raw === "string" || typeof raw === "number" ? Number.parseInt(String(raw), 10) : Number.NaN;
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * pageSize was unbounded (pageSize=1000000 loaded whole tables, negative
 * values reached Prisma): it is now clamped to 1..MAX_PAGE_SIZE.
 */
export function parsePagination(query: { page?: unknown; pageSize?: unknown }): PageParams {
  const page = clampInt(query.page, 1, 1, MAX_PAGE);
  const pageSize = clampInt(query.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

export function buildMeta(params: PageParams, total: number): PaginationMeta {
  const totalPages = params.pageSize > 0 ? Math.ceil(total / params.pageSize) : 1;
  return {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages,
  };
}

export function parseSort(
  sort: unknown,
  allowed: string[],
  fallback: Record<string, "asc" | "desc">
): Record<string, "asc" | "desc"> {
  if (typeof sort !== "string" || sort.length === 0) return fallback;
  const desc = sort.startsWith("-");
  const field = desc ? sort.slice(1) : sort;
  if (!allowed.includes(field)) return fallback;
  return { [field]: desc ? "desc" : "asc" };
}
