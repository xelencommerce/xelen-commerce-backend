import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import type { Request } from 'express';
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      map((data: unknown) => ({
        success: true,
        data,
        meta: { requestId: String(request.id ?? '') },
      })),
    );
  }
}
