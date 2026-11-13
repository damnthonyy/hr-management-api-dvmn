import { SystemRole } from "@prisma/client";

export interface AuthContext {
  userId: string;
  organizationId: string;
  email: string;
  role: SystemRole;
  sessionId: string;
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId?: string;
    }
  }
}

export {};
