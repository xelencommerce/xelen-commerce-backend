import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class AcceptedResponseDto {
  @ApiProperty({ enum: ['REQUEST_ACCEPTED'] }) status!: string;
  @ApiProperty() message!: string;
}
export class MfaFlowResponseDto {
  @ApiProperty({ enum: ['MFA_REQUIRED', 'MFA_ENROLLMENT_REQUIRED'] }) status!: string;
  @ApiProperty({
    description: 'Opaque, scoped challenge; keep only in memory. Never an authenticated session.',
  })
  challengeToken!: string;
  @ApiProperty({ example: 600 }) expiresIn!: number;
  @ApiProperty({ type: [String], enum: ['TOTP', 'SMS', 'RECOVERY'] }) availableMethods!: string[];
}
export class FactorResponseDto {
  @ApiProperty({ enum: ['CODE_REQUIRED', 'CODE_SENT'] }) status!: string;
  @ApiProperty({ enum: ['TOTP', 'SMS', 'RECOVERY'] }) method!: string;
  @ApiPropertyOptional({ example: '••••2671' }) maskedDestination?: string;
  @ApiPropertyOptional({ example: 45 }) resendAfter?: number;
}
export class TotpSetupResponseDto {
  @ApiProperty({ enum: ['ENROLLMENT_PENDING'] }) status!: string;
  @ApiProperty({
    description:
      'Sensitive otpauth URI. Display as enrollment material; never log or persist client-side.',
  })
  otpauthUri!: string;
  @ApiProperty({ description: 'Dynamically generated PNG data URL.' }) qrCodeDataUrl!: string;
  @ApiProperty() expiresIn!: number;
}
export class VerifiedResponseDto {
  @ApiProperty({
    enum: ['AUTHENTICATED', 'MFA_ENROLLED', 'REAUTHENTICATED'],
    description: 'Only AUTHENTICATED includes an access token and refresh cookie.',
  })
  status!: string;
  @ApiPropertyOptional() accessToken?: string;
  @ApiPropertyOptional({ enum: ['Bearer'] }) tokenType?: string;
  @ApiPropertyOptional() expiresIn?: number;
  @ApiPropertyOptional() csrfToken?: string;
  @ApiPropertyOptional({
    description: 'One-use, session-bound grant for a sensitive MFA operation.',
  })
  reauthToken?: string;
  @ApiPropertyOptional({
    type: [String],
    description: 'Disclosed once on initial enrollment. Store safely offline.',
  })
  recoveryCodes?: string[];
}
export class StatusResponseDto {
  @ApiProperty({ enum: ['PASSWORD_CHANGED', 'SIGNED_OUT', 'MFA_REMOVED'] }) status!: string;
  @ApiPropertyOptional() message?: string;
}
export class CsrfResponseDto {
  @ApiProperty() csrfToken!: string;
}
export class RecoveryResponseDto {
  @ApiProperty({ type: [String] }) recoveryCodes!: string[];
}
export class MembershipResponseDto {
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() role!: string;
  @ApiProperty({ type: [String] }) permissions!: string[];
}
export class CurrentUserResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiProperty({ type: [String] }) permissions!: string[];
  @ApiProperty({ type: [MembershipResponseDto] }) memberships!: MembershipResponseDto[];
  @ApiProperty() dashboard!: string;
  @ApiProperty({ enum: [true] }) mfaVerified!: boolean;
}
