import { Worker, Job } from "bullmq";
import { bullConnection } from "../lib/redis";
import { QUEUE_NAMES, ReportJob } from "../queues";
import * as reportService from "../modules/reports/report.service";
import { createNotification, toJson } from "../services/notification.service";
import { logger } from "../lib/logger";

export function createReportWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.report,
    async (job: Job<ReportJob>) => {
      const { organizationId, reportType, requestedBy, includeSalary = false } = job.data;
      let payload: unknown;
      switch (reportType) {
        case "salary-summary":
          // Jobs queued before includeSalary existed are not trusted with salary data.
          if (!includeSalary) throw new Error("salary report requested without salary:view");
          payload = await reportService.salarySummary(organizationId);
          break;
        case "turnover":
          payload = await reportService.turnover(organizationId);
          break;
        case "leave":
          payload = await reportService.leaveStatistics(organizationId);
          break;
        default:
          payload = await reportService.dashboard(organizationId, includeSalary);
      }

      await createNotification({
        organizationId,
        userId: requestedBy,
        type: "report.ready",
        title: `Report ready: ${reportType}`,
        data: toJson(payload),
      });

      return { generated: true };
    },
    { connection: bullConnection, concurrency: 3 }
  ).on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "report job failed");
  });
}
