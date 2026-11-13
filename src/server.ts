import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { connectPrisma, disconnectPrisma } from "./lib/prisma";
import { pingRedis, closeRedis } from "./lib/redis";
import { ensureStorage } from "./lib/storage";
import { closeQueues } from "./queues";
import { closeServer, createShutdown, installShutdownHandlers } from "./lib/shutdown";

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

  // Order matters: stop taking requests and let in-flight ones finish, then
  // close what they use.
  const shutdown = createShutdown({
    logger,
    steps: [
      { name: "http server", run: () => closeServer(server) },
      { name: "queues", run: closeQueues },
      { name: "database", run: disconnectPrisma },
      { name: "redis", run: closeRedis },
    ],
  });
  installShutdownHandlers(shutdown, logger);
}

bootstrap().catch((error) => {
  logger.error({ err: error }, "failed to start server");
  process.exit(1);
});
