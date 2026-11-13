import { type NextFunction, type Request, type Response } from "express";

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

export function asyncHandler(handler: Handler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
