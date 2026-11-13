import { Worker, type Job } from "bullmq";
import { bullConnection } from "../lib/redis";
import { QUEUE_NAMES, type EmailJob } from "../queues";
import { deliverEmail, renderTemplate } from "../services/mailer";
import { logger } from "../lib/logger";

export function createEmailWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.email,
    async (job: Job<EmailJob>) => {
      const { to, subject, template, context } = job.data;
      const html = renderTemplate(template, context);
      await deliverEmail({ to, subject, html });
      return { delivered: true };
    },
    { connection: bullConnection, concurrency: 10 }
  ).on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "email job failed");
  });
}
