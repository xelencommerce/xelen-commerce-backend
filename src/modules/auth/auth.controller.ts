import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public, CurrentUser } from '../../common/decorators/access.js';
import { Configuration } from '../../config/environment.js';
import { CryptoService } from '../../infrastructure/security/crypto.service.js';
import { cookieOptions } from '../../common/middleware/browser-security.js';
import type { AuthenticatedUser, RequestContext } from '../../types/auth.js';
import { AuthService } from './auth.service.js';
import { SessionService, type AuthenticationResult } from './session.service.js';
import { MfaService } from './mfa.service.js';
import {
  EmailDto,
  RegisterDto,
  LoginDto,
  TokenDto,
  ResetPasswordDto,
  FlowDto,
  MfaChallengeDto,
  VerifyMfaDto,
  ReauthenticateDto,
  ReauthTokenDto,
  RemoveMfaDto,
} from './dto/auth.dto.js';
import { ApiError } from '../../common/exceptions/api-error.js';
import { ApiSuccess } from '../../common/decorators/api-success.js';
import {
  AcceptedResponseDto,
  MfaFlowResponseDto,
  FactorResponseDto,
  TotpSetupResponseDto,
  VerifiedResponseDto,
  StatusResponseDto,
  CsrfResponseDto,
  RecoveryResponseDto,
  CurrentUserResponseDto,
} from './dto/auth-response.dto.js';
const context = (request: Request): RequestContext => ({
  requestId: String(request.id ?? ''),
  ip: request.ip ?? 'unknown',
  userAgent: request.headers['user-agent'] ?? '',
});
@ApiTags('Authentication')
@ApiResponse({ status: 400, description: 'VALIDATION_ERROR: invalid input or unexpected fields.' })
@ApiResponse({
  status: 401,
  description: 'Authentication or challenge failed; no account-enumeration details are returned.',
})
@ApiResponse({ status: 429, description: 'Rate limit, OTP attempts or resend limit exceeded.' })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly config: Configuration,
    private readonly crypto: CryptoService,
  ) {}
  private complete(result: AuthenticationResult, response: Response) {
    if (result.refresh) {
      response.cookie(this.config.refreshCookie, result.refresh.token, {
        ...cookieOptions(this.config),
        expires: result.refresh.expiresAt,
      });
      const csrfToken = this.crypto.csrf();
      response.cookie(this.config.csrfCookie, csrfToken, {
        ...cookieOptions(this.config),
        httpOnly: false,
        expires: result.refresh.expiresAt,
      });
      result.data.csrfToken = csrfToken;
    }
    return result.data;
  }
  @Public()
  @Post('register')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Create a pending merchant registration and request email verification. Cannot assign platform roles.',
  })
  @ApiSuccess(AcceptedResponseDto, 202)
  register(@Body() body: RegisterDto, @Req() request: Request) {
    return this.auth.register(body, context(request));
  }
  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Consume an email verification token and begin MFA enrollment. Does not issue a session.',
  })
  @ApiSuccess(MfaFlowResponseDto, 200)
  verifyEmail(@Body() body: TokenDto) {
    return this.auth.verifyEmail(body.token);
  }
  @Public()
  @Post('verify-email/resend')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Request another verification email with a generic eligibility response.',
  })
  @ApiSuccess(AcceptedResponseDto, 202)
  resendVerification(@Body() body: EmailDto) {
    return this.auth.resendVerification(body.email);
  }
  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verify password and return a scoped MFA challenge; no access/refresh tokens yet.',
  })
  @ApiSuccess(MfaFlowResponseDto, 200)
  login(@Body() body: LoginDto, @Req() request: Request) {
    return this.auth.login(body, context(request));
  }
  @Public()
  @Post('mfa/challenge')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Select an enrolled factor or request an SMS enrollment code. Requires a scoped challenge token.',
  })
  @ApiSuccess(FactorResponseDto, 200)
  challenge(@Body() body: MfaChallengeDto) {
    return this.mfa.challenge(body);
  }
  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Consume a code/challenge; issue a session only after all required factors pass.',
  })
  @ApiSuccess(VerifiedResponseDto, 200)
  async verify(
    @Body() body: VerifyMfaDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.complete(
      await this.mfa.verify(body.challengeToken, body.code, context(request)),
      response,
    );
  }
  @Public()
  @Post('mfa/resend')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Resend SMS after 45 seconds. Does not reset attempts or the absolute challenge expiry.',
  })
  @ApiSuccess(FactorResponseDto, 200)
  resend(@Body() body: FlowDto) {
    return this.mfa.resend(body.challengeToken);
  }
  @Public()
  @Post('mfa/totp/setup')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Return a real QR enrollment URI for an authorized initial or reauthenticated enrollment challenge.',
  })
  @ApiSuccess(TotpSetupResponseDto, 200)
  setup(@Body() body: FlowDto) {
    return this.mfa.setupTotp(body.challengeToken);
  }
  @Public()
  @Post('mfa/totp/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirm an enrollment TOTP. Recovery codes are returned once on first enrollment.',
  })
  @ApiSuccess(VerifiedResponseDto, 200)
  async confirm(
    @Body() body: VerifyMfaDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.complete(
      await this.mfa.verify(body.challengeToken, body.code, context(request), true),
      response,
    );
  }
  @ApiBearerAuth()
  @Post('reauthenticate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verify the current password and require another MFA challenge for sensitive actions.',
  })
  @ApiSuccess(MfaFlowResponseDto, 200)
  reauthenticate(@CurrentUser() user: AuthenticatedUser, @Body() body: ReauthenticateDto) {
    return this.auth.reauthenticate(user, body.password);
  }
  @ApiBearerAuth()
  @Post('mfa/enrollment')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Consume a fresh reauthentication grant to add or replace an MFA method.',
  })
  @ApiSuccess(MfaFlowResponseDto, 200)
  enrollment(@CurrentUser() user: AuthenticatedUser, @Body() body: ReauthTokenDto) {
    return this.mfa.enrollment(user, body.reauthToken);
  }
  @ApiBearerAuth()
  @Post('mfa/recovery-codes')
  @HttpCode(200)
  @ApiOperation({ summary: 'Regenerate recovery codes after password and MFA reauthentication.' })
  @ApiSuccess(RecoveryResponseDto, 200)
  recovery(@CurrentUser() user: AuthenticatedUser, @Body() body: ReauthTokenDto) {
    return this.mfa.regenerateRecovery(user, body.reauthToken);
  }
  @ApiBearerAuth()
  @Post('mfa/remove')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Remove a method after reauthentication, preserving a usable factor and revoking sessions.',
  })
  @ApiSuccess(StatusResponseDto, 200)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RemoveMfaDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.mfa.remove(user, body.reauthToken, body.method);
    this.clear(response);
    return result;
  }
  @Public()
  @Get('csrf')
  @ApiOperation({
    summary:
      'Retrieve a signed CSRF token for cookie-based session restoration. Use credentials: include.',
  })
  @ApiSuccess(CsrfResponseDto, 200)
  csrf(@Res({ passthrough: true }) response: Response) {
    const csrfToken = this.crypto.csrf();
    response.cookie(this.config.csrfCookie, csrfToken, {
      ...cookieOptions(this.config),
      httpOnly: false,
    });
    return { csrfToken };
  }
  @Public()
  @ApiCookieAuth()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Rotate the HttpOnly refresh token. Requires allowlisted Origin and signed X-CSRF-Token when a refresh cookie exists.',
  })
  @ApiSuccess(VerifiedResponseDto, 200)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const raw = cookies?.[this.config.refreshCookie];
    if (typeof raw !== 'string')
      throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in again.');
    try {
      return this.complete(await this.sessions.refresh(raw), response);
    } catch (error) {
      this.clear(response);
      throw error;
    }
  }
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke the current session immediately.' })
  @ApiSuccess(StatusResponseDto, 200)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.sessions.logout(user);
    this.clear(response);
    return { status: 'SIGNED_OUT' };
  }
  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke all sessions for this account.' })
  @ApiSuccess(StatusResponseDto, 200)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.sessions.logout(user, true);
    this.clear(response);
    return { status: 'SIGNED_OUT' };
  }
  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Request a password reset without disclosing whether the account exists.',
  })
  @ApiSuccess(AcceptedResponseDto, 202)
  forgot(@Body() body: EmailDto) {
    return this.auth.forgotPassword(body.email);
  }
  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Consume a single-use reset token, change the password and revoke sessions/challenges.',
  })
  @ApiSuccess(StatusResponseDto, 200)
  reset(@Body() body: ResetPasswordDto) {
    return this.auth.resetPassword(body);
  }
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({
    summary:
      'Return verified identity, platform roles, authorized memberships and dashboard destination.',
  })
  @ApiSuccess(CurrentUserResponseDto, 200)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.sessions.me(user);
  }
  private clear(response: Response) {
    response.clearCookie(this.config.refreshCookie, cookieOptions(this.config));
    response.clearCookie(this.config.csrfCookie, {
      ...cookieOptions(this.config),
      httpOnly: false,
    });
  }
}
