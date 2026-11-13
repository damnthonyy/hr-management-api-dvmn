import { describe, it, expect, afterAll, vi } from "vitest";
import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import { renderTemplate } from "../src/services/mailer";
import { numericCode } from "../src/utils/tokens";
import { cacheDeletePattern } from "../src/services/cache";
import { closeRedis, getRedis } from "../src/lib/redis";
import { prisma } from "../src/lib/prisma";
import { optionalAuthenticate } from "../src/middleware/authenticate";
import { errorHandler } from "../src/middleware/error";

describe("hardening utilities", () => {
  afterAll(async () => {
    await prisma.$disconnect();
    await closeRedis().catch(() => undefined);
  });

  describe("email templates", () => {
    it("escapes user-controlled values", () => {
      const html = renderTemplate("invitation", {
        organizationName: '<a href="https://evil.example">Click</a>',
        "<b>key</b>": "Tom & Jerry's",
      });
      expect(html).not.toContain("<a href");
      expect(html).not.toContain("<b>");
      expect(html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;Click&lt;/a&gt;");
      expect(html).toContain("Tom &amp; Jerry&#39;s");
    });
  });

  describe("numericCode", () => {
    it("uses the CSPRNG, not Math.random", () => {
      const spy = vi.spyOn(Math, "random");
      const code = numericCode(8);
      expect(code).toMatch(/^\d{8}$/);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("cacheDeletePattern", () => {
    it("deletes matching keys with SCAN, never KEYS", async () => {
      const redis = getRedis();
      const prefix = `test-cache-${Date.now()}`;
      for (let i = 0; i < 450; i += 1) await redis.set(`${prefix}:${i}`, "1", "EX", 60);
      await redis.set(`${prefix}-other`, "1", "EX", 60);
      const keysSpy = vi.spyOn(redis, "keys");

      expect(await cacheDeletePattern(`${prefix}:*`)).toBe(450);
      expect(keysSpy).not.toHaveBeenCalled();
      expect(await redis.exists(`${prefix}:0`)).toBe(0);
      expect(await redis.exists(`${prefix}-other`)).toBe(1);
      await redis.del(`${prefix}-other`);
      keysSpy.mockRestore();
    });
  });

  describe("optionalAuthenticate", () => {
    const makeApp = (middleware: typeof optionalAuthenticate, handler: (req: Request, res: Response) => void) => {
      const app = express();
      const calls = { next: 0 };
      app.get(
        "/",
        (req: Request, res: Response, next: NextFunction) =>
          void middleware(req, res, (...args: unknown[]) => {
            calls.next += 1;
            (next as (...a: unknown[]) => void)(...args);
          }),
        handler
      );
      app.use(errorHandler);
      return { app, calls };
    };

    it("continues anonymously with an invalid token", async () => {
      const { app, calls } = makeApp(optionalAuthenticate, (req, res) => {
        res.json({ authenticated: Boolean(req.auth) });
      });
      const res = await request(app).get("/").set("Authorization", "Bearer not-a-jwt");
      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(false);
      expect(calls.next).toBe(1);
    });
  });
});
