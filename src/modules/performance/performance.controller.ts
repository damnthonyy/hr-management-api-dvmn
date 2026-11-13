import { Request, Response } from "express";
import * as service from "./performance.service";
import { sendSuccess, sendCreated, sendNoContent } from "../../utils/response";
import { ApiError } from "../../utils/apiError";

function orgId(req: Request): string {
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth.organizationId;
}

export async function listCycles(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listCycles(orgId(req)));
}

export async function createCycle(req: Request, res: Response): Promise<void> {
  sendCreated(res, await service.createCycle(orgId(req), req.body));
}

export async function listReviews(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listReviews(orgId(req), req.query as Record<string, unknown>));
}

export async function createReview(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  sendCreated(res, await service.createReview(req.body, req.auth.userId, orgId(req)));
}

export async function getReview(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getReview(req.params.id));
}

export async function updateReview(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.updateReview(req.params.id, req.body));
}

export async function listObjectives(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listObjectives(req.params.employeeId));
}

export async function createObjective(req: Request, res: Response): Promise<void> {
  sendCreated(res, await service.createObjective(req.body));
}

export async function updateObjective(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.updateObjective(req.params.id, req.body));
}

export async function deleteObjective(req: Request, res: Response): Promise<void> {
  await service.deleteObjective(req.params.id);
  sendNoContent(res);
}
