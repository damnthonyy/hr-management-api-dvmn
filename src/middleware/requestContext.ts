import { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "crypto";

/**
 * A client-supplied request id is only reused when it looks like an id:
 * otherwise it could carry newlines or arbitrary text into the logs
 * (log forging) or be used to bloat them.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const headerId = req.header("x-request-id");
  req.requestId = headerId && REQUEST_ID_PATTERN.test(headerId) ? headerId : randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}
