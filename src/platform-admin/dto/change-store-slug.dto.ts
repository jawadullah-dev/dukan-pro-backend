import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Length, Matches } from 'class-validator';

/**
 * WF19 step 2 — the store address may only be changed by a platform admin.
 * Format mirrors the owner-facing DB CHECK: lowercase letters/numbers with
 * single hyphens, 3–40 chars; reserved words are refused in the service.
 */
export class ChangeStoreSlugDto {
  @ApiProperty({
    description:
      'New store address, e.g. "khalid-mobile-center". Lowercase letters/numbers separated by single hyphens, 3–40 chars, not a reserved word.',
    example: 'khalid-mobile-center',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message:
      'slug must be lowercase letters/numbers separated by single hyphens',
  })
  @Length(3, 40)
  slug: string;
}
