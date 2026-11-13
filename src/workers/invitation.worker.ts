import { Worker, Job } from "bullmq";
import { bullConnection } from "../lib/redis";
import { QUEUE_NAMES, InvitationJob, enqueueEmail } from "../queues";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { randomToken } from "../utils/tokens";
import { logger } from "../lib/logger";

export function createInvitationWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.invitation,
    async (job: Job<InvitationJob>) => {
      const { organizationId, email, role } = job.data;
      const token = randomToken(24);

      await prisma.notification.create({
        data: {
          organizationId,
          userId: job.data.invitedBy,
          type: "invitation.sent",
          title: `Invitation sent to ${email}`,
          data: { email, role },
        },
      });

      await enqueueEmail({
        to: email,
        subject: "You have been invited",
        template: "invitation",
        context: {
          role,
          acceptUrl: `${env.appPublicUrl}/api/v1/auth/accept-invite?token=${token}`,
        },
      });

      return { invited: true };
    },
    { connection: bullConnection, concurrency: 5 }
  ).on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "invitation job failed");
  });
}
