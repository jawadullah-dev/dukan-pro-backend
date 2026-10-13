import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class DashboardQueryFilterDto {
  @ApiPropertyOptional({
    example: 'today',
    description:
      "Only 'today' exists in Release 1. Week / month / custom ranges and detailed reports arrive in Release 1.1.",
  })
  @IsOptional()
  @IsIn(['today'])
  period = 'today' as const;
}
