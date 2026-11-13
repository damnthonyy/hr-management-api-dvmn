import { Queue, JobsOptions } from "bullmq";
import { bullConnection } from "../lib/redis";

export const QUEUE_NAMES = {
  email: "email",
  payslip: "payslip",
  document: "document",
  report: "report",
  invitation: "invitation",
  notification: "notification",
} as const;

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

function makeQueue(name: string): Queue {
  return new Queue(name, { connection: bullConnection, defaultJobOptions });
}

export const emailQueue = makeQueue(QUEUE_NAMES.email);
export const payslipQueue = makeQueue(QUEUE_NAMES.payslip);
export const documentQueue = makeQueue(QUEUE_NAMES.document);
export const reportQueue = makeQueue(QUEUE_NAMES.report);
export const invitationQueue = makeQueue(QUEUE_NAMES.invitation);
export const notificationQueue = makeQueue(QUEUE_NAMES.notification);

export interface EmailJob {
  to: string;
  subject: string;
  template: string;
  context: Record<string, unknown>;
}

export interface PayslipJob {
  payrollRecordId: string;
  organizationId: string;
}

export interface DocumentJob {
  documentId: string;
  organizationId: string;
}

export interface ReportJob {
  organizationId: string;
  reportType: string;
  requestedBy: string;
  params: Record<string, unknown>;
}

export interface InvitationJob {
  organizationId: string;
  email: string;
  invitedBy: string;
  role: string;
}

export interface ScheduledNotificationJob {
  organizationId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}

export async function enqueueEmail(data: EmailJob): Promise<void> {
  await emailQueue.add("send", data);
}

export async function enqueuePayslip(data: PayslipJob): Promise<void> {
  await payslipQueue.add("generate", data);
}

export async function enqueueDocumentProcessing(data: DocumentJob): Promise<void> {
  await documentQueue.add("process", data);
}

export async function enqueueReport(data: ReportJob): Promise<void> {
  await reportQueue.add("build", data);
}

export async function enqueueInvitation(data: InvitationJob): Promise<void> {
  await invitationQueue.add("invite", data);
}

export async function enqueueNotification(data: ScheduledNotificationJob): Promise<void> {
  await notificationQueue.add("deliver", data);
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    emailQueue.close(),
    payslipQueue.close(),
    documentQueue.close(),
    reportQueue.close(),
    invitationQueue.close(),
    notificationQueue.close(),
  ]);
}
