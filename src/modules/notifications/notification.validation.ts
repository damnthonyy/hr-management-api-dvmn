import { z } from "zod";
import { paginationQuery } from "../../utils/query";

export const listNotificationsQuery = z.object({
  ...paginationQuery,
  status: z.enum(["UNREAD", "READ"]).optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>;
