import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { ApiError } from '../exceptions/api-error.js';
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}
  catch(error: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const parserStatus =
      typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : parserStatus === 400 || parserStatus === 413
          ? parserStatus
          : 500;
    const code =
      error instanceof ApiError
        ? error.code
        : status === 400
          ? 'VALIDATION_ERROR'
          : status === 404
            ? 'NOT_FOUND'
            : status === 413
              ? 'PAYLOAD_TOO_LARGE'
              : 'INTERNAL_ERROR';
    const message =
      error instanceof ApiError
        ? error.message
        : status === 400
          ? 'The request contains invalid data.'
          : status === 404
            ? 'The requested resource was not found.'
            : status === 413
              ? 'The request payload is too large.'
              : 'The request could not be completed.';
    if (status >= 500) this.logger.error({ code, status, requestId: request.id }, 'Request failed');
    response
      .status(status)
      .json({ success: false, error: { code, message }, requestId: String(request.id ?? '') });
  }
}
