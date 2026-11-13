import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import request from "supertest";

// The network is mocked: these tests cover what happens to the downloaded
// content (type checks, file naming), not the SSRF guard itself.
const remote = vi.hoisted(() => ({ contentType: "application/pdf", body: Buffer.from("%PDF-1.7\n"), status: 200 }));
vi.mock("../src/lib/safeFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/safeFetch")>();
  return {
    ...actual,
    fetchRemoteFile: vi.fn(async (url: string) => ({ ...remote, finalUrl: url })),
  };
});

import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { closeRedis } from "../src/lib/redis";
import { closeQueues } from "../src/queues";
import { storageRoot, uploadsDir } from "../src/lib/storage";

const app = createApp();
const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let orgId = "";
let token = "";
const importUrl = (body: Record<string, unknown>) =>
  request(app).post("/api/v1/documents/import-from-url").set("Authorization", `Bearer ${token}`).send(body);

describe("document import", () => {
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({
        organizationName: `Import ${unique}`,
        email: `import-${unique}@test.example`,
        password: "Password123!",
        firstName: "Import",
        lastName: "Admin",
      });
    orgId = res.body.data.organization.id;
    token = res.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    const documents = await prisma.document.findMany({ where: { organizationId: orgId } });
    for (const document of documents) fs.rmSync(path.join(uploadsDir(), document.fileName), { force: true });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await closeQueues().catch(() => undefined);
    await prisma.$disconnect();
    await closeRedis().catch(() => undefined);
  });

  it("stores the file inside uploads/ whatever fileName says (path traversal)", async () => {
    const res = await importUrl({ url: "https://files.example.com/doc.pdf", fileName: "../../../../tmp/pwned.js" });
    expect(res.status).toBe(201);
    expect(res.body.data.fileName).toMatch(/^\d+-[0-9a-f]{16}\.pdf$/);
    expect(res.body.data.originalName).toBe("pwned.js");
    expect(fs.existsSync(path.join(uploadsDir(), res.body.data.fileName))).toBe(true);
    expect(fs.existsSync(path.join(storageRoot(), "..", "tmp", "pwned.js"))).toBe(false);
  });

  it("rejects remote content outside the allowlist", async () => {
    remote.contentType = "text/html";
    remote.body = Buffer.from("<script>alert(1)</script>");
    const res = await importUrl({ url: "https://files.example.com/page.html" });
    expect(res.status).toBe(415);
  });

  it("rejects remote content that does not match its declared type", async () => {
    remote.contentType = "application/pdf";
    remote.body = Buffer.from("<script>alert(1)</script>");
    const res = await importUrl({ url: "https://files.example.com/fake.pdf" });
    expect(res.status).toBe(415);
  });

  it("does not echo remote errors", async () => {
    remote.status = 500;
    remote.body = Buffer.from("%PDF-1.7\n");
    const res = await importUrl({ url: "https://files.example.com/doc.pdf" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("Could not download the file");
  });
});
