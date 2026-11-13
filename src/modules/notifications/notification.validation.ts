import { z } from "zod";
import { SystemRole } from "@prisma/client";
import { accountEmail } from "../../utils/schemas";
import { paginationQuery } from "../../utils/query";

export const listNotificationsQuery = z.object({
  ...paginationQuery,
  status: z.enum(["UNREAD", "READ"]).optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>;

export const inviteSchema = z.object({
  email: accountEmail(),
  role: z.enum(SystemRole),
});
