import { type Worker } from "bullmq";
import { logger } from "../lib/logger";
import { connectPrisma, disconnectPrisma } from "../lib/prisma";
import { closeRedis } from "../lib/redis";
import { createEmailWorker } from "./email.worker";
import { createPayslipWorker } from "./payslip.worker";
import { createDocumentWorker } from "./document.worker";
import { createReportWorker } from "./report.worker";
import { createInvitationWorker } from "./invitation.worker";
import { createNotificationWorker } from "./notification.worker";
import { createShutdown, installShutdownHandlers } from "../lib/shutdown";
import { closeQueues } from "../queues";

async function bootstrap(): Promise<void> {
  await connectPrisma();
  logger.info("worker runtime connected to database");

  const workers: Worker[] = [
    createEmailWorker(),
    createPayslipWorker(),
    createDocumentWorker(),
    createReportWorker(),
    createInvitationWorker(),
    createNotificationWorker(),
  ];

  logger.info(`started ${workers.length} background workers`);

  // Workers finish their active jobs before closing; jobs still running at
  // the deadline are retried by BullMQ once their lock expires.
  const shutdown = createShutdown({
    logger,
    timeoutMs: 30_000,
    steps: [
      { name: "workers", run: () => Promise.all(workers.map((worker) => worker.close())) },
      { name: "queues", run: closeQueues },
      { name: "database", run: disconnectPrisma },
      { name: "redis", run: closeRedis },
    ],
  });
  installShutdownHandlers(shutdown, logger);
}

bootstrap().catch((error: unknown) => {
  logger.error({ err: error }, "failed to start workers");
  process.exit(1);
});
