import fs from "fs";
import path from "path";
import { env } from "../config/env";

const root = path.resolve(process.cwd(), env.storageDir);

export function ensureStorage(): void {
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  const uploads = path.join(root, "uploads");
  if (!fs.existsSync(uploads)) {
    fs.mkdirSync(uploads, { recursive: true });
  }
  const payslips = path.join(root, "payslips");
  if (!fs.existsSync(payslips)) {
    fs.mkdirSync(payslips, { recursive: true });
  }
}

export function storageRoot(): string {
  return root;
}

export function uploadsDir(): string {
  return path.join(root, "uploads");
}

export function payslipsDir(): string {
  return path.join(root, "payslips");
}

/**
 * Resolves a path stored in the database. Refuses anything that would
 * escape the storage root (absolute paths, "..").
 */
export function resolveStoragePath(relative: string): string {
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Storage path escapes the storage root: ${relative}`);
  }
  return resolved;
}

/**
 * Display-safe version of a user supplied file name: no directory part,
 * no control or path characters, bounded length. Never use it to build a
 * path on disk: stored files get a server-generated name.
 */
export function sanitizeFileName(name: string, fallback = "document"): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 150);
  return cleaned.length > 0 ? cleaned : fallback;
}
