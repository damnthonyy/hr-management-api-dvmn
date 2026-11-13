import pino from "pino";
import { env } from "../config/env";

export const logger = pino({
  level: env.isProduction ? "info" : "debug",
  base: { service: "hr-management-api" },
  transport: env.isProduction
    ? undefined
    : {
        target: "pino/file",
        options: { destination: 1 },
      },
});
