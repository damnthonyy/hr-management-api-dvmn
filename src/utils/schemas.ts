import { z } from "zod";

/**
 * Account email (login identifier): trimmed and lowercased before
 * validation, so "Jane@Example.com " and "jane@example.com" are the same
 * account. User.email is unique in the database.
 */
export const accountEmail = () => z.string().trim().toLowerCase().pipe(z.email().max(254));
