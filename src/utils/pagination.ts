import { PaginationMeta } from "./response";

export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function parsePagination(query: Record<string, unknown>): PageParams {
  const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
  const rawSize = Number.parseInt(String(query.pageSize ?? "25"), 10);
  const pageSize = Number.isNaN(rawSize) ? 25 : rawSize;
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
