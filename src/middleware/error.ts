import { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import multer from "multer";
import { ApiError } from "../utils/apiError";
import { logger } from "../lib/logger";

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.path} not found` },
  });
}

type ErrorBody = { code: string; message: string; details?: unknown; requestId?: string };

function send(res: Response, status: number, error: ErrorBody): void {
  res.status(status).json({ success: false, error });
}

/** Errors raised by body-parser / http-errors carry a 4xx status and expose=true. */
function clientHttpError(err: unknown): { status: number; type?: string } | null {
  if (typeof err !== "object" || err === null) return null;
  const { status, statusCode, expose, type } = err as {
    status?: number;
    statusCode?: number;
    expose?: boolean;
    type?: string;
  };
  const code = status ?? statusCode;
  if (expose === true && typeof code === "number" && code >= 400 && code < 500) return { status: code, type };
  return null;
}

/**
 * Only messages written for the client are returned: ApiError (4xx) and a few
 * known cases. Everything else gets a generic message, without stack trace,
 * Prisma message/meta (table, column and constraint names, query details) or
 * library internals; the details are logged with the request id instead.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.requestId;

  if (err instanceof ApiError) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId }, err.message);
      send(res, err.statusCode, { code: err.code, message: "Internal server error", requestId });
      return;
    }
    send(res, err.statusCode, { code: err.code, message: err.message, details: err.details });
    return;
  }

  if (err instanceof multer.MulterError) {
    const apiError =
      err.code === "LIMIT_FILE_SIZE"
        ? ApiError.payloadTooLarge("File is too large")
        : ApiError.badRequest(`Invalid upload: ${err.message}`);
    send(res, apiError.statusCode, { code: apiError.code, message: apiError.message });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      send(res, 409, { code: "CONFLICT", message: "A record with these values already exists" });
      return;
    }
    if (err.code === "P2003") {
      send(res, 400, { code: "BAD_REQUEST", message: "A referenced record does not exist" });
      return;
    }
    if (err.code === "P2025") {
      send(res, 404, { code: "NOT_FOUND", message: "Resource not found" });
      return;
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    // Invalid query built from user input (e.g. an unknown enum value in a filter).
    logger.warn({ err, requestId }, "invalid database query");
    send(res, 400, { code: "BAD_REQUEST", message: "Invalid request", requestId });
    return;
  }

  const httpError = clientHttpError(err);
  if (httpError) {
    if (httpError.type === "entity.too.large") {
      send(res, 413, { code: "PAYLOAD_TOO_LARGE", message: "Payload too large" });
    } else if (httpError.type === "entity.parse.failed") {
      send(res, 400, { code: "BAD_REQUEST", message: "Malformed request body" });
    } else {
      send(res, httpError.status, { code: "BAD_REQUEST", message: "Invalid request" });
    }
    return;
  }

  logger.error({ err, requestId }, "unhandled error");
  send(res, 500, { code: "INTERNAL_ERROR", message: "Internal server error", requestId });
}
