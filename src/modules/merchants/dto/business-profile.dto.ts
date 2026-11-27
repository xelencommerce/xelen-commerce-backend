import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
export const INDUSTRIES = [
  'Fashion & Accessories',
  'Beauty & Personal Care',
  'Food & Beverages',
  'Electronics & Gadgets',
  'Home & Lifestyle',
  'Arts, Crafts & Handmade',
  'Health, Fitness & Wellness',
  'Digital Products & Software',
  'Education & Coaching',
  'Creators & Communities',
  'Services & Consulting',
  'Events & Experiences',
  'Nonprofits & Fundraising',
  'Multiple Categories',
  'Other',
] as const;
export class BusinessProfileDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  businessName!: string;
  @ApiProperty({ enum: INDUSTRIES }) @IsIn(INDUSTRIES) industry!: string;
  @ApiPropertyOptional({ maxLength: 1000, description: 'Required when industry is Other.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf(
    (object: BusinessProfileDto) =>
      object.industry === 'Other' || object.otherIndustry !== undefined,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  otherIndustry?: string;
}
