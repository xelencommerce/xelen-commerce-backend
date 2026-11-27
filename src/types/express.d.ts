import type { AuthenticatedUser, TenantContext } from './auth.js';
declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser;
      tenant?: TenantContext;
    }
  }
}
