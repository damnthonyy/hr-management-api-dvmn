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
    const res = await request(app).post("/api/v1/auth/register").send({
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

    it("answers 400 (not 500) to malformed multipart requests", async () => {
      const res = await upload()
        .attach("file", PDF, { filename: "a.pdf", contentType: "application/pdf" })
        .attach("other", PDF, { filename: "b.pdf", contentType: "application/pdf" });
      expect(res.status).toBe(400);
      expect(res.body.error.stack).toBeUndefined();
    });
  });
});
