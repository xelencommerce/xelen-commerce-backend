import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  type ValidationArguments,
} from 'class-validator';
@ValidatorConstraint({ name: 'passwordConfirmation' })
class PasswordConfirmation implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    return value === (args.object as { password?: unknown }).password;
  }
  defaultMessage() {
    return 'Password confirmation must match.';
  }
}
export class EmailDto {
  @ApiProperty({ example: 'merchant@example.com', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
export class LoginDto extends EmailDto {
  @ApiProperty({ format: 'password', maxLength: 128 })
  @IsString()
  @Length(1, 128)
  password!: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() remember = false;
}
export class PasswordDto {
  @ApiProperty({
    format: 'password',
    minLength: 8,
    maxLength: 128,
    description: 'At least one uppercase letter, number and non-whitespace special character.',
  })
  @IsString()
  @Length(8, 128)
  @Matches(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9\s]).{8,128}$/s)
  password!: string;
  @ApiProperty({ format: 'password', maxLength: 128 })
  @IsString()
  @MaxLength(128)
  @Validate(PasswordConfirmation)
  confirmPassword!: string;
}
export class RegisterDto extends PasswordDto {
  @ApiProperty({ example: 'merchant@example.com', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
export class TokenDto {
  @ApiProperty({ minLength: 43, maxLength: 43 })
  @IsString()
  @Length(43, 43)
  @Matches(/^[A-Za-z0-9_-]+$/)
  token!: string;
}
export class ResetPasswordDto extends PasswordDto {
  @ApiProperty({ minLength: 43, maxLength: 43 })
  @IsString()
  @Length(43, 43)
  @Matches(/^[A-Za-z0-9_-]+$/)
  token!: string;
}
export class FlowDto {
  @ApiProperty({ minLength: 43, maxLength: 43 })
  @IsString()
  @Length(43, 43)
  @Matches(/^[A-Za-z0-9_-]+$/)
  challengeToken!: string;
}
export class MfaChallengeDto extends FlowDto {
  @ApiProperty({ enum: ['TOTP', 'SMS', 'RECOVERY'] }) @IsIn(['TOTP', 'SMS', 'RECOVERY']) method!:
    'TOTP' | 'SMS' | 'RECOVERY';
  @ApiPropertyOptional({
    description: 'E.164 phone number. Only accepted during authorized SMS enrollment.',
  })
  @IsOptional()
  @IsString()
  @Length(8, 16)
  @Matches(/^\+[1-9]\d{6,14}$/)
  phone?: string;
}
export class VerifyMfaDto extends FlowDto {
  @ApiProperty({
    description: 'Six-digit OTP, or a recovery code when RECOVERY is selected.',
    minLength: 6,
    maxLength: 32,
  })
  @IsString()
  @Length(6, 32)
  code!: string;
}
export class ReauthenticateDto {
  @ApiProperty({ format: 'password' }) @IsString() @Length(1, 128) password!: string;
}
export class ReauthTokenDto {
  @ApiProperty({ minLength: 43, maxLength: 43 })
  @IsString()
  @Length(43, 43)
  @Matches(/^[A-Za-z0-9_-]+$/)
  reauthToken!: string;
}
export class RemoveMfaDto extends ReauthTokenDto {
  @ApiProperty({ enum: ['TOTP', 'SMS'] }) @IsIn(['TOTP', 'SMS']) method!: 'TOTP' | 'SMS';
}
