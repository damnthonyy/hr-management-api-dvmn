import fs from "fs";
import path from "path";
import { Worker, Job } from "bullmq";
import { bullConnection } from "../lib/redis";
import { QUEUE_NAMES, PayslipJob } from "../queues";
import { prisma } from "../lib/prisma";
import { payslipsDir, ensureStorage } from "../lib/storage";
import { logger } from "../lib/logger";

ensureStorage();

export function createPayslipWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.payslip,
    async (job: Job<PayslipJob>) => {
      const record = await prisma.payrollRecord.findUnique({
        where: { id: job.data.payrollRecordId },
        include: { employee: true, period: true },
      });
      if (!record) return { skipped: true };

      const fileName = `payslip-${record.id}.txt`;
      const filePath = path.join(payslipsDir(), fileName);
      const content = [
        `Payslip for ${record.employee.firstName} ${record.employee.lastName}`,
        `Period: ${record.period.label}`,
        `Gross: ${record.grossSalary.toString()} ${record.currency}`,
        `Bonuses: ${record.bonusTotal.toString()}`,
        `Deductions: ${record.deductionTotal.toString()}`,
        `Net: ${record.netSalary.toString()} ${record.currency}`,
      ].join("\n");
      await fs.promises.writeFile(filePath, content);

      await prisma.payrollRecord.update({
        where: { id: record.id },
        data: { payslipPath: path.join("payslips", fileName) },
      });

      return { generated: true };
    },
    { connection: bullConnection, concurrency: 5 }
  ).on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "payslip job failed");
  });
}
