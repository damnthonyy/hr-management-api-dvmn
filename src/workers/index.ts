import { Worker } from "bullmq";
import { logger } from "../lib/logger";
import { connectPrisma, disconnectPrisma } from "../lib/prisma";
import { closeRedis } from "../lib/redis";
import { createEmailWorker } from "./email.worker";
import { createPayslipWorker } from "./payslip.worker";
import { createDocumentWorker } from "./document.worker";
import { createReportWorker } from "./report.worker";
import { createInvitationWorker } from "./invitation.worker";
import { createNotificationWorker } from "./notification.worker";

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

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`received ${signal}, stopping workers`);
    await Promise.all(workers.map((w) => w.close()));
    await disconnectPrisma().catch(() => undefined);
    await closeRedis().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

bootstrap().catch((error) => {
  logger.error({ err: error }, "failed to start workers");
  process.exit(1);
});
