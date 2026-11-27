import type { Request, Response, NextFunction, CookieOptions } from 'express';
import { Configuration } from '../../config/environment.js';
import { CryptoService } from '../../infrastructure/security/crypto.service.js';
export function cookieOptions(config: Configuration): CookieOptions {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: config.values.COOKIE_SAME_SITE,
    path: '/',
  };
}
export function browserSecurity(config: Configuration, crypto: CryptoService) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (request.path.startsWith(`/${config.values.API_PREFIX}/auth`))
      response.setHeader('Cache-Control', 'no-store');
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    const origin = request.headers.origin;
    if (origin && !config.corsOrigins.includes(origin))
      return response.status(403).json({
        success: false,
        error: { code: 'ORIGIN_REJECTED', message: 'This request origin is not permitted.' },
        requestId: String(request.id ?? ''),
      });
    if (request.headers['content-type'] && !request.is('application/json'))
      return response.status(415).json({
        success: false,
        error: { code: 'JSON_REQUIRED', message: 'Use application/json request bodies.' },
        requestId: String(request.id ?? ''),
      });
    const cookies = request.cookies as Record<string, unknown> | undefined;
    if (cookies?.[config.refreshCookie]) {
      const cookie = cookies[config.csrfCookie];
      const header = request.headers['x-csrf-token'];
      if (
        !origin ||
        typeof cookie !== 'string' ||
        typeof header !== 'string' ||
        !crypto.validCsrf(cookie) ||
        !crypto.equal(cookie, header)
      )
        return response.status(403).json({
          success: false,
          error: { code: 'CSRF_REJECTED', message: 'The request could not be verified.' },
          requestId: String(request.id ?? ''),
        });
    }
    next();
  };
}
