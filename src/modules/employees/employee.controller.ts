import { Request, Response } from "express";
import * as service from "./employee.service";
import { sendSuccess, sendCreated, sendPaginated, sendNoContent } from "../../utils/response";
import { requireAuthContext, requireOrgId } from "../../utils/tenant";

export async function list(req: Request, res: Response): Promise<void> {
  const { items, meta } = await service.listEmployees(requireOrgId(req), req.query as Record<string, unknown>);
  sendPaginated(res, items, meta);
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const employee = await service.getEmployee(requireOrgId(req), req.params.id);
  sendSuccess(res, employee);
}

export async function create(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const employee = await service.createEmployee(auth.organizationId, req.body, auth.userId);
  sendCreated(res, employee);
}

export async function update(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const employee = await service.updateEmployee(auth.organizationId, req.params.id, req.body, auth.userId);
  sendSuccess(res, employee);
}

export async function deactivate(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const employee = await service.deactivateEmployee(auth.organizationId, req.params.id, auth.userId);
  sendSuccess(res, employee);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  await service.deleteEmployee(auth.organizationId, req.params.id, auth.userId);
  sendNoContent(res);
}

export async function addEmergencyContact(req: Request, res: Response): Promise<void> {
  const contact = await service.addEmergencyContact(requireOrgId(req), req.params.id, req.body);
  sendCreated(res, contact);
}

export async function listEmergencyContacts(req: Request, res: Response): Promise<void> {
  const contacts = await service.listEmergencyContacts(requireOrgId(req), req.params.id);
  sendSuccess(res, contacts);
}

export async function addContract(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const contract = await service.addContract(auth.organizationId, req.params.id, req.body, auth.userId);
  sendCreated(res, contract);
}

export async function listContracts(req: Request, res: Response): Promise<void> {
  const contracts = await service.listContracts(requireOrgId(req), req.params.id);
  sendSuccess(res, contracts);
}

export async function updateSalary(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req);
  const result = await service.updateSalary(auth.organizationId, req.params.id, req.body, auth.userId);
  sendSuccess(res, result);
}

export async function salaryHistory(req: Request, res: Response): Promise<void> {
  const result = await service.salaryHistory(requireOrgId(req), req.params.id);
  sendSuccess(res, result);
}

export async function reports(req: Request, res: Response): Promise<void> {
  const result = await service.listReports(requireOrgId(req), req.params.id);
  sendSuccess(res, result);
}
