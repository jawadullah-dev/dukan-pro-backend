import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString } from 'class-validator';

/**
 * Returned from every create / update / delete / cancel / approve endpoint.
 * Never returns the mutated object itself — controller returns a message +
 * success boolean. A follow-up GET/:id fetches the row if the UI needs it.
 */
export class StatusBaseResponseDTO {
  @ApiProperty({ example: true, description: 'Whether the mutation succeeded' })
  @IsBoolean()
  status: boolean;

  @ApiProperty({
    example: 'Brand created successfully',
    description: 'Human friendly result message to show the shop owner',
  })
  @IsString()
  message: string;

  constructor(status: boolean, message: string) {
    this.status = status;
    this.message = message;
  }
}
