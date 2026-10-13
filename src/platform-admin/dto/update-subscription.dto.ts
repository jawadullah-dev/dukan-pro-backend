import { ApiPropertyOptional } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

/**
 * WF3 — renew or suspend a shop.
 *
 * Both halves are here on purpose: renewing is a date change, suspending is a
 * status flip, and an admin who wants to pause a shop should not have to know
 * that it means editing two different columns.
 */
export class UpdateSubscriptionDto {
  @ApiPropertyOptional({
    description:
      'New subscription end date. Must be in the future. Omit when only suspending.',
    example: '2026-12-05',
  })
  @IsOptional()
  @IsDateString()
  subscriptionEndsAt?: string;

  @ApiPropertyOptional({
    description:
      'false suspends the shop immediately. true reactivates it. Omit to leave the status unchanged.',
    example: false,
  })
  @IsOptional()
  @Type(() => String)
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new BadRequestException('isActive must be true or false');
  })
  @IsBoolean()
  isActive?: boolean;
}
