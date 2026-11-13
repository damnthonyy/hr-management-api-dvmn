import { Worker, Job } from "bullmq";
import { bullConnection } from "../lib/redis";
import { QUEUE_NAMES, ScheduledNotificationJob } from "../queues";
import { createNotification, toJson } from "../services/notification.service";
import { logger } from "../lib/logger";

export function createNotificationWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.notification,
    async (job: Job<ScheduledNotificationJob>) => {
      await createNotification({
        organizationId: job.data.organizationId,
        userId: job.data.userId,
        type: job.data.type,
        title: job.data.title,
        body: job.data.body,
        data: toJson(job.data.data),
      });
      return { delivered: true };
    },
    { connection: bullConnection, concurrency: 10 }
  ).on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "notification job failed");
  });
}
