import fs from "fs";
import crypto from "crypto";
import path from "path";
import { pipeline } from "stream/promises";
import { env } from "../config/env";

const root = path.resolve(process.cwd(), env.storageDir);

/** Startup only (synchronous on purpose): creates the storage directories. */
export function ensureStorage(): void {
  for (const dir of [root, path.join(root, "uploads"), path.join(root, "payslips")]) {
    fs.mkdirSync(dir, { recursive: true });
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

/*
 * Async helpers for request handlers and workers: the synchronous fs calls
 * they used block the event loop (every request waits while a 15 MB upload
 * is read to compute its checksum).
 */

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** SHA-256 of a file, streamed (constant memory). */
export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

/** Deletes a file; a missing file is not an error. */
export async function removeFile(filePath: string): Promise<void> {
  await fs.promises.rm(filePath, { force: true });
}
