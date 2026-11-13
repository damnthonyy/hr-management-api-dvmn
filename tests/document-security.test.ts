import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { closeRedis } from "../src/lib/redis";
import { closeQueues } from "../src/queues";
import { uploadsDir, ensureStorage } from "../src/lib/storage";

const app = createApp();
const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let orgId = "";
let token = "";

const PDF = Buffer.from("%PDF-1.7\n%test document\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const uploadsCount = () => fs.readdirSync(uploadsDir()).length;
const upload = () => request(app).post("/api/v1/documents/upload").set("Authorization", `Bearer ${token}`);

describe("document security", () => {
  beforeAll(async () => {
    ensureStorage();
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({
        organizationName: `Docs ${unique}`,
        email: `docs-${unique}@test.example`,
        password: "Password123!",
        firstName: "Doc",
        lastName: "Admin",
      });
    expect(res.status).toBe(201);
    orgId = res.body.data.organization.id;
    token = res.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    const documents = await prisma.document.findMany({ where: { organizationId: orgId } });
    for (const document of documents) fs.rmSync(`${uploadsDir()}/${document.fileName}`, { force: true });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await closeQueues().catch(() => undefined);
    await prisma.$disconnect();
    await closeRedis().catch(() => undefined);
  });

  describe("uploads", () => {
    it("accepts a real PDF, with a server-generated name and a sanitized display name", async () => {
      const res = await upload().attach("file", PDF, {
        filename: "../../../etc/Rapport<annuel>|.pdf",
        contentType: "application/pdf",
      });
      expect(res.status).toBe(201);
      expect(res.body.data.fileName).toMatch(/^\d+-[0-9a-f]{16}\.pdf$/);
      expect(res.body.data.originalName).toBe("Rapportannuel.pdf");
      expect(fs.existsSync(`${uploadsDir()}/${res.body.data.fileName}`)).toBe(true);
    });

    it("accepts a real PNG", async () => {
      const res = await upload().attach("file", PNG, { filename: "photo.png", contentType: "image/png" });
      expect(res.status).toBe(201);
      expect(res.body.data.fileName).toMatch(/\.png$/);
    });

    it("rejects types outside the allowlist without writing anything", async () => {
      const before = uploadsCount();
      const res = await upload().attach("file", Buffer.from("MZ\x90\x00"), {
        filename: "invoice.exe",
        contentType: "application/x-msdownload",
      });
      expect(res.status).toBe(415);
      expect(uploadsCount()).toBe(before);
    });

    it("rejects content that does not match the declared type, and deletes it", async () => {
      const before = uploadsCount();
      const res = await upload().attach("file", Buffer.from("<html><script>alert(1)</script></html>"), {
        filename: "cv.pdf",
        contentType: "application/pdf",
      });
      expect(res.status).toBe(415);
      expect(uploadsCount()).toBe(before);
    });

    it("validates the multipart fields and removes the file when they are invalid", async () => {
      const before = uploadsCount();
      const res = await upload()
        .field("employeeId", "not-a-uuid")
        .attach("file", PDF, { filename: "a.pdf", contentType: "application/pdf" });
      expect(res.status).toBe(400);
      expect(uploadsCount()).toBe(before);
    });

    it("answers 400 (not 500) to malformed multipart requests", async () => {
      const res = await upload()
        .attach("file", PDF, { filename: "a.pdf", contentType: "application/pdf" })
        .attach("other", PDF, { filename: "b.pdf", contentType: "application/pdf" });
      expect(res.status).toBe(400);
      expect(res.body.error.stack).toBeUndefined();
    });
  });

  describe("import from URL (SSRF)", () => {
    it.each([
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      "https://169.254.169.254/latest/meta-data/",
      "https://127.0.0.1/",
      "https://localhost:6379/",
      "https://[::1]/",
      "https://2130706433/",
      "https://10.0.0.5/admin",
      "https://metadata.google.internal/computeMetadata/v1/",
      "file:///etc/passwd",
    ])("refuses %s without creating anything", async (url) => {
      const before = await prisma.document.count({ where: { organizationId: orgId } });
      const res = await request(app)
        .post("/api/v1/documents/import-from-url")
        .set("Authorization", `Bearer ${token}`)
        .send({ url, fileName: "../../../../tmp/pwned" });
      expect(res.status).toBe(400);
      expect(await prisma.document.count({ where: { organizationId: orgId } })).toBe(before);
    });
  });
});
