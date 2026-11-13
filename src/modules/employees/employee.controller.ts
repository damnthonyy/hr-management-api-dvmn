import { Request, Response } from "express";
import * as service from "./employee.service";
import { sendSuccess, sendCreated, sendPaginated, sendNoContent } from "../../utils/response";
import { ApiError } from "../../utils/apiError";

function orgId(req: Request): string {
  const header = req.header("x-organization-id");
  if (header) return header;
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth.organizationId;
}

export async function list(req: Request, res: Response): Promise<void> {
  const { items, meta } = await service.listEmployees(orgId(req), req.query as Record<string, unknown>);
  sendPaginated(res, items, meta);
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const employee = await service.getEmployee(req.params.id);
  sendSuccess(res, employee);
}

export async function create(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const employee = await service.createEmployee(orgId(req), req.body, req.auth.userId);
  sendCreated(res, employee);
}

export async function update(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const employee = await service.updateEmployee(req.params.id, req.body, req.auth.userId);
  sendSuccess(res, employee);
}

export async function deactivate(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const employee = await service.deactivateEmployee(req.params.id, req.auth.userId);
  sendSuccess(res, employee);
}

export async function remove(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  await service.deleteEmployee(req.params.id, req.auth.userId);
  sendNoContent(res);
}

export async function addEmergencyContact(req: Request, res: Response): Promise<void> {
  const contact = await service.addEmergencyContact(req.params.id, req.body);
  sendCreated(res, contact);
}

export async function listEmergencyContacts(req: Request, res: Response): Promise<void> {
  const contacts = await service.listEmergencyContacts(req.params.id);
  sendSuccess(res, contacts);
}

export async function addContract(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const contract = await service.addContract(req.params.id, req.body, req.auth.userId);
  sendCreated(res, contract);
}

export async function listContracts(req: Request, res: Response): Promise<void> {
  const contracts = await service.listContracts(req.params.id);
  sendSuccess(res, contracts);
}

export async function updateSalary(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw ApiError.unauthorized();
  const result = await service.updateSalary(req.params.id, req.body, req.auth.userId);
  sendSuccess(res, result);
}

export async function salaryHistory(req: Request, res: Response): Promise<void> {
  const result = await service.salaryHistory(req.params.id);
  sendSuccess(res, result);
}

export async function reports(req: Request, res: Response): Promise<void> {
  const result = await service.listReports(req.params.id);
  sendSuccess(res, result);
}
