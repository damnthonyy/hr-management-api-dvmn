import { NextFunction, Request, Response, Router } from "express";
import { z, ZodError, type ZodType } from "zod";
import { ApiError } from "../utils/apiError";

type Source = "body" | "query" | "params";

export function validate(schema: ZodType, source: Source = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req[source]);
      if (source === "body") {
        req.body = parsed;
      } else if (source === "params") {
        Object.assign(req.params, parsed as Record<string, string>);
      } else {
        (req as unknown as Record<string, unknown>).validatedQuery = parsed;
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          ApiError.badRequest(
            "Request validation failed",
            error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            }))
          )
        );
        return;
      }
      next(error);
    }
  };
}

/** Every id in this API is a UUID (Prisma `@default(uuid())`). */
const ID_PARAMS = [
  "id",
  "assignmentId",
  "departmentId",
  "employeeId",
  "periodId",
  "recordId",
  "sessionId",
  "teamId",
  "userId",
] as const;

const uuid = z.uuid();

/**
 * Rejects malformed ids in route parameters with a 400 before they reach the
 * services and the database (they used to be passed straight to Prisma).
 * Called on each module router: router.param handlers are per router.
 */
export function validateIdParams(router: Router): Router {
  for (const name of ID_PARAMS) {
    router.param(name, (_req, _res, next, value: string) => {
      next(uuid.safeParse(value).success ? undefined : ApiError.badRequest(`Invalid ${name}: expected a UUID`));
    });
  }
  return router;
}
