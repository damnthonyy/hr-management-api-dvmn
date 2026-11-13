import express, { Application, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import { env } from "./config/env";
import { requestContext } from "./middleware/requestContext";
import { rateLimit } from "./middleware/rateLimit";
import { errorHandler, notFoundHandler } from "./middleware/error";
import apiRoutes from "./routes";
import { prisma } from "./lib/prisma";
import { pingRedis } from "./lib/redis";
import { isShuttingDown } from "./lib/shutdown";

export function createApp(): Application {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", env.trustProxy);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.use(
    cors({
      origin: env.corsOrigins === "*" ? "*" : env.corsOrigins,
      credentials: false,
      exposedHeaders: ["X-Request-Id", "X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After"],
    })
  );
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).requestId ?? "",
      autoLogging: { ignore: (req) => req.url === "/health" },
    })
  );

  app.use(rateLimit());

  app.get("/health", async (_req: Request, res: Response) => {
    if (isShuttingDown()) {
      res.status(503).json({ success: false, data: { status: "shutting_down" } });
      return;
    }
    const checks: Record<string, string> = {};
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = "up";
    } catch {
      checks.database = "down";
    }
    try {
      await pingRedis();
      checks.redis = "up";
    } catch {
      checks.redis = "down";
    }
    const healthy = Object.values(checks).every((v) => v === "up");
    res.status(healthy ? 200 : 503).json({ success: healthy, data: checks });
  });

  app.use("/api/v1", apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
