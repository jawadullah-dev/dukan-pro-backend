import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsString } from 'class-validator';

/**
 * Returned with HTTP 200 instead of StatusBaseResponseDTO when the payment
 * would take cash below zero and confirmOverdraft was not sent yet. The client
 * shows the warning and retries the identical payload plus confirmOverdraft.
 */
export class PurchaseOverdraftResponseDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  confirmOverdraft: true;

  @ApiProperty({
    description:
      'Paisa the drawer would go below zero by. Divide by 100 to display.',
    example: 500000,
  })
  @IsNumber()
  shortfall: number;

  @ApiProperty({
    example: 'This payment would take your cash below zero by 500000 paisa.',
  })
  @IsString()
  message: string;

  constructor(shortfall: number, subject: string = 'payment') {
    this.confirmOverdraft = true;
    this.shortfall = shortfall;
    this.message = `This ${subject} would take your cash below zero by ${shortfall} paisa. Send confirmOverdraft: true to save it anyway.`;
  }
}
