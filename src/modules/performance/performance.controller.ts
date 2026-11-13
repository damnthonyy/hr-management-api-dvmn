import { type Request, type Response } from "express";
import * as service from "./performance.service";
import { parseBody, parseQuery } from "../../middleware/validate";
import {
  createCycleSchema,
  createObjectiveSchema,
  createReviewSchema,
  listReviewsQuery,
  updateObjectiveSchema,
  updateReviewSchema,
} from "./performance.validation";
import { sendSuccess, sendCreated, sendNoContent, sendPaginated } from "../../utils/response";
import { requireAuthContext, requireOrgId } from "../../utils/tenant";

export async function listCycles(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listCycles(requireOrgId(req)));
}

export async function createCycle(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, createCycleSchema);
  sendCreated(res, await service.createCycle(requireOrgId(req), body));
}

export async function listReviews(req: Request, res: Response): Promise<void> {
  const { items, meta } = await service.listReviews(requireOrgId(req), parseQuery(req, listReviewsQuery));
  sendPaginated(res, items, meta);
}

export async function createReview(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, createReviewSchema);
  const auth = requireAuthContext(req);
  sendCreated(res, await service.createReview(auth.organizationId, body, auth.userId));
}

export async function getReview(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getReview(requireOrgId(req), req.params.id));
}

export async function updateReview(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, updateReviewSchema);
  sendSuccess(res, await service.updateReview(requireOrgId(req), req.params.id, body));
}

export async function listObjectives(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listObjectives(requireOrgId(req), req.params.employeeId));
}

export async function createObjective(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, createObjectiveSchema);
  sendCreated(res, await service.createObjective(requireOrgId(req), body));
}

export async function updateObjective(req: Request, res: Response): Promise<void> {
  const body = parseBody(req, updateObjectiveSchema);
  sendSuccess(res, await service.updateObjective(requireOrgId(req), req.params.id, body));
}

export async function deleteObjective(req: Request, res: Response): Promise<void> {
  await service.deleteObjective(requireOrgId(req), req.params.id);
  sendNoContent(res);
}
