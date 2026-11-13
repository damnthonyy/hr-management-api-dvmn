import { NextFunction, Request, Response, Router } from "express";
import { z, ZodError, type ZodType } from "zod";
import { ApiError } from "../utils/apiError";

export function validationError(error: ZodError): ApiError {
  return ApiError.badRequest(
    "Request validation failed",
    error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }))
  );
}

export function validate(schema: ZodType, source: "body" | "params" = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(validationError(result.error));
      return;
    }
    if (source === "body") {
      req.body = result.data;
    } else {
      Object.assign(req.params, result.data as Record<string, string>);
    }
    next();
  };
}

/**
 * Parses req.body with a schema and returns the typed result (400 on invalid
 * input). Validation happens in the controller so the inferred type flows to
 * the service: req.body itself is typed any by Express.
 */
export function parseBody<S extends ZodType>(req: Request, schema: S): z.output<S> {
  const result = schema.safeParse(req.body);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

/**
 * Parses req.query with a schema and returns the typed result. Used in
 * controllers rather than as a middleware so the type flows to the service
 * (req.query itself stays typed as ParsedQs). Throws a 400 on invalid input.
 */
export function parseQuery<S extends ZodType>(req: Request, schema: S): z.output<S> {
  const result = schema.safeParse(req.query);
  if (!result.success) throw validationError(result.error);
  return result.data;
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
