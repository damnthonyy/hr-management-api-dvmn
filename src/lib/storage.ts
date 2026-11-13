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

export function resolveStoragePath(relative: string): string {
  return path.join(root, relative);
}
