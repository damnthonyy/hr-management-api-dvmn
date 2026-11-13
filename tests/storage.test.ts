import { describe, it, expect } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
  fileExists,
  removeFile,
  resolveStoragePath,
  sanitizeFileName,
  sha256File,
  storageRoot,
} from "../src/lib/storage";

describe("storage paths", () => {
  it.each([
    ["../../../app/dist/server.js", "server.js"],
    ["..\\\\..\\\\windows\\\\evil.dll", "evil.dll"],
    ["/etc/passwd", "passwd"],
    ["..", "document"],
    [".hidden", "hidden"],
    ['in"jec\r\ntion<>.pdf', "injection.pdf"],
    ["", "document"],
    ["Rapport annuel 2026.pdf", "Rapport annuel 2026.pdf"],
  ])("sanitizeFileName(%j) = %j", (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it("caps the length", () => {
    expect(sanitizeFileName("a".repeat(500) + ".pdf").length).toBeLessThanOrEqual(150);
  });

  it("resolves paths inside the storage root", () => {
    expect(resolveStoragePath("uploads/file")).toBe(path.join(storageRoot(), "uploads", "file"));
  });

  it.each(["../secret", "uploads/../../secret", "/etc/passwd"])("refuses %j", (relative) => {
    expect(() => resolveStoragePath(relative)).toThrow(/escapes/);
  });
});

describe("async file helpers", () => {
  it("hashes, checks and removes files without loading them synchronously", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hr-storage-"));
    const file = path.join(dir, "blob.bin");
    const content = crypto.randomBytes(3 * 1024 * 1024);
    await fs.promises.writeFile(file, content);

    expect(await sha256File(file)).toBe(crypto.createHash("sha256").update(content).digest("hex"));
    expect(await fileExists(file)).toBe(true);
    await removeFile(file);
    expect(await fileExists(file)).toBe(false);
    await expect(removeFile(file)).resolves.toBeUndefined();
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
});
