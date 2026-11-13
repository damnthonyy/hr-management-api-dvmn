import { describe, it, expect } from "vitest";
import path from "path";
import { resolveStoragePath, sanitizeFileName, storageRoot } from "../src/lib/storage";

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
