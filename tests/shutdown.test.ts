import { describe, it, expect, vi } from "vitest";
import http from "http";
import express from "express";
import { closeServer, createShutdown } from "../src/lib/shutdown";

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };

describe("graceful shutdown", () => {
  it("runs every step in order, even after a failure, then exits with 1", async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const shutdown = createShutdown({
      logger: silentLogger,
      exit,
      steps: [
        { name: "a", run: async () => void order.push("a") },
        { name: "b", run: async () => { order.push("b"); throw new Error("boom"); } },
        { name: "c", run: async () => void order.push("c") },
      ],
    });
    await shutdown("SIGTERM");
    expect(order).toEqual(["a", "b", "c"]);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits with 0 when everything closes, and only shuts down once", async () => {
    const exit = vi.fn();
    const step = vi.fn(async () => undefined);
    const shutdown = createShutdown({ logger: silentLogger, exit, steps: [{ name: "a", run: step }] });
    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);
    expect(step).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("forces the exit when a step hangs past the deadline", async () => {
    const exit = vi.fn();
    const shutdown = createShutdown({
      logger: silentLogger,
      exit,
      timeoutMs: 50,
      steps: [{ name: "stuck", run: () => new Promise(() => undefined) }],
    });
    void shutdown("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("lets in-flight requests finish before the server closes", async () => {
    const app = express();
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => (started = resolve));
    app.get("/slow", (_req, res) => {
      started();
      setTimeout(() => res.send("done"), 200);
    });
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as { port: number };

    const response = new Promise<string>((resolve, reject) => {
      http.get({ port, path: "/slow", agent: new http.Agent({ keepAlive: true }) }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve(body));
      }).on("error", reject);
    });
    await requestStarted;

    let closed = false;
    const closing = closeServer(server).then(() => (closed = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(false); // still serving /slow

    expect(await response).toBe("done");
    await closing;
    expect(closed).toBe(true);
  });
});
