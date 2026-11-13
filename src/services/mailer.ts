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

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * Context values include user-controlled data (names, organization names):
 * everything is escaped so it cannot inject markup or links into the email.
 */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  const rows = Object.entries(context)
    .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join("");
  return `<h1>${escapeHtml(template)}</h1><table>${rows}</table>`;
}
