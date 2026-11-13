import fs from "fs";
import crypto from "crypto";
import { Worker, Job } from "bullmq";
import { bullConnection } from "../lib/redis";
import { QUEUE_NAMES, DocumentJob } from "../queues";
import { prisma } from "../lib/prisma";
import { resolveStoragePath } from "../lib/storage";
import { logger } from "../lib/logger";

export function createDocumentWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.document,
    async (job: Job<DocumentJob>) => {
      const document = await prisma.document.findUnique({ where: { id: job.data.documentId } });
      if (!document) return { skipped: true };
      const absolutePath = resolveStoragePath(document.storagePath);
      if (!fs.existsSync(absolutePath)) return { missing: true };

      if (!document.checksum) {
        const buffer = fs.readFileSync(absolutePath);
        const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
        await prisma.document.update({ where: { id: document.id }, data: { checksum } });
      }
      return { processed: true };
    },
    { connection: bullConnection, concurrency: 5 }
  ).on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "document job failed");
  });
}
