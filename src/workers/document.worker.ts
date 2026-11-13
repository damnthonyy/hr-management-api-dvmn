import { Worker, type Job } from "bullmq";
import { bullConnection } from "../lib/redis";
import { QUEUE_NAMES, type DocumentJob } from "../queues";
import { prisma } from "../lib/prisma";
import { fileExists, resolveStoragePath, sha256File } from "../lib/storage";
import { logger } from "../lib/logger";

export function createDocumentWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.document,
    async (job: Job<DocumentJob>) => {
      const document = await prisma.document.findUnique({ where: { id: job.data.documentId } });
      if (!document) return { skipped: true };
      const absolutePath = resolveStoragePath(document.storagePath);
      if (!(await fileExists(absolutePath))) return { missing: true };

      if (!document.checksum) {
        const checksum = await sha256File(absolutePath);
        await prisma.document.update({ where: { id: document.id }, data: { checksum } });
      }
      return { processed: true };
    },
    { connection: bullConnection, concurrency: 5 }
  ).on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "document job failed");
  });
}
