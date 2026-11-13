import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { connectPrisma, disconnectPrisma } from "./lib/prisma";
import { pingRedis, closeRedis } from "./lib/redis";
import { ensureStorage } from "./lib/storage";
import { closeQueues } from "./queues";

async function bootstrap(): Promise<void> {
  ensureStorage();
  await connectPrisma();
  logger.info("database connection established");
  await pingRedis();
  logger.info("redis connection established");

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(`HR Management API listening on port ${env.port}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`received ${signal}, shutting down`);
    server.close();
    await closeQueues().catch(() => undefined);
    await disconnectPrisma().catch(() => undefined);
    await closeRedis().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

bootstrap().catch((error) => {
  logger.error({ err: error }, "failed to start server");
  process.exit(1);
});
