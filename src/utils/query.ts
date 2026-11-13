import { z } from "zod";

/**
 * Query string building blocks. Pagination values are kept as strings and
 * clamped by parsePagination (out-of-range values are corrected, not
 * rejected); repeated parameters (?page=1&page=2) are rejected.
 */
export const paginationQuery = {
  page: z.string().max(10).optional(),
  pageSize: z.string().max(10).optional(),
};

export const uuidFilter = z.uuid().optional();

export const searchFilter = z.string().trim().max(100).optional();

/** ISO date or datetime, as accepted by `new Date()`; rejects "Invalid Date". */
export const dateFilter = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })])
  .transform((value) => new Date(value));
