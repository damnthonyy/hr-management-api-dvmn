import type { Server } from "http";
import type { Logger } from "pino";

let shuttingDown = false;

/** True once a shutdown has started: /health answers 503 so load balancers stop routing traffic here. */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

export interface ShutdownStep {
  name: string;
  run: () => Promise<unknown>;
}

export interface ShutdownOptions {
  logger: Pick<Logger, "info" | "warn" | "error" | "fatal">;
  steps: ShutdownStep[];
  /** Hard deadline: past it the process exits even if a step is stuck. */
  timeoutMs?: number;
  exit?: (code: number) => void;
}

/**
 * Returns a shutdown function that runs the steps in order (each one even if
 * a previous one failed), then exits. A second signal does not start a
 * second shutdown; a step that hangs is cut by the deadline (exit code 1).
 */
export function createShutdown(options: ShutdownOptions): (reason: string, exitCode?: number) => Promise<void> {
  const { logger, steps, timeoutMs = 10_000, exit = (code) => process.exit(code) } = options;
  let running: Promise<void> | null = null;

  return (reason, exitCode = 0) => {
    if (running) {
      logger.warn({ reason }, "shutdown already in progress");
      return running;
    }
    shuttingDown = true;
    logger.info({ reason }, "shutting down");

    const deadline = setTimeout(() => {
      logger.fatal({ timeoutMs }, "shutdown timed out, forcing exit");
      exit(1);
    }, timeoutMs);
    deadline.unref();

    running = (async () => {
      let code = exitCode;
      for (const step of steps) {
        try {
          await step.run();
          logger.info({ step: step.name }, "shutdown step completed");
        } catch (error) {
          code = 1;
          logger.error({ err: error, step: step.name }, "shutdown step failed");
        }
      }
      clearTimeout(deadline);
      exit(code);
    })();
    return running;
  };
}

/**
 * Stops accepting connections and resolves once in-flight requests are done.
 * Idle keep-alive connections are closed right away so they do not hold the
 * server open.
 */
export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
  });
}

/** Signals and fatal errors trigger the shutdown. */
export function installShutdownHandlers(
  shutdown: (reason: string, exitCode?: number) => Promise<void>,
  logger: Pick<Logger, "error" | "fatal">
): void {
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "unhandled promise rejection");
  });
  process.on("uncaughtException", (error) => {
    // The process state is unknown after an uncaught exception: stop cleanly.
    logger.fatal({ err: error }, "uncaught exception");
    void shutdown("uncaughtException", 1);
  });
}
