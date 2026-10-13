import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/**
 * Reorder a product's photos. Send the FULL ordered list of image ids —
 * the first entry becomes the cover (lowest sortOrder), the rest follow.
 * The service rejects any list that is not exactly the product's images.
 */
export class ReorderProductImagesDto {
  @ApiProperty({
    description:
      'Every image id of this product, in the new desired order (first = cover).',
    example: [
      '01924f0a-0000-7000-8000-000000000010',
      '01924f0a-0000-7000-8000-000000000009',
    ],
    type: 'array',
    items: { type: 'string' },
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  imageIds: string[];
}
