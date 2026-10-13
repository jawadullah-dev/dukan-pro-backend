import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber, IsString } from 'class-validator';

export class ErrorResponseDTO {
  @ApiProperty()
  @IsString()
  error: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  message: string[];

  @ApiProperty()
  @IsNumber()
  statusCode: number;

  constructor(error: string, message: string[], statusCode: number) {
    this.error = error;
    this.message = message;
    this.statusCode = statusCode;
  }
}
