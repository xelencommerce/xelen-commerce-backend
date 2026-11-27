import { HttpException } from '@nestjs/common';
export class ApiError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
  ) {
    super({ code, message }, status);
  }
}
export const invalidCredentials = () =>
  new ApiError(401, 'INVALID_CREDENTIALS', 'Unable to authenticate with these credentials.');
export const invalidChallenge = () =>
  new ApiError(401, 'INVALID_CHALLENGE', 'The verification challenge is invalid or expired.');
