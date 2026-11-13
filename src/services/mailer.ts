import { logger } from "../lib/logger";
import { env } from "../config/env";

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
}

export async function deliverEmail(message: OutboundEmail): Promise<void> {
  logger.info(
    { to: message.to, subject: message.subject, from: env.smtpFrom },
    "email dispatched"
  );
}

export function renderTemplate(template: string, context: Record<string, unknown>): string {
  const rows = Object.entries(context)
    .map(([key, value]) => `<tr><td>${key}</td><td>${String(value)}</td></tr>`)
    .join("");
  return `<h1>${template}</h1><table>${rows}</table>`;
}
