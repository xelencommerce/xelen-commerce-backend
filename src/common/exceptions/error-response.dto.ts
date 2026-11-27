import { ApiProperty } from '@nestjs/swagger';
export class MachineErrorDto {
  @ApiProperty({ example: 'VALIDATION_ERROR' }) code!: string;
  @ApiProperty({ example: 'The request contains invalid data.' }) message!: string;
}
export class ErrorResponseDto {
  @ApiProperty({ enum: [false] }) success!: boolean;
  @ApiProperty({ type: MachineErrorDto }) error!: MachineErrorDto;
  @ApiProperty() requestId!: string;
}
