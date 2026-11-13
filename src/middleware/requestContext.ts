import { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";

export function requestContext(req: Request, _res: Response, next: NextFunction): void {
  const headerId = req.header("x-request-id");
  req.requestId = headerId && headerId.length > 0 ? headerId : randomUUID();
  next();
}
