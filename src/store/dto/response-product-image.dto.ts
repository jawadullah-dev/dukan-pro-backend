import { ApiProperty } from '@nestjs/swagger';

/** One saved photo of a product, ordered by sortOrder (lowest = cover). */
export class ResponseProductImageDto {
  @ApiProperty({
    description: 'UUID v7 of this product_images row.',
    example: '01924f0a-0000-7000-8000-000000000010',
  })
  id: string;

  @ApiProperty({
    description: 'Public https URL of the stored photo.',
    example: 'https://pub-xxxx.r2.dev/shops/…/products/…/a15-front.jpg',
  })
  url: string;

  @ApiProperty({
    description: 'Position on the store. 0 is the cover photo.',
    example: 0,
  })
  sortOrder: number;
}

/** GET /products/:id/images — wrapped so Swagger can document `data.items`. */
export class ResponseProductImagesDto {
  @ApiProperty({
    type: [ResponseProductImageDto],
    description: 'Saved photos, lowest sortOrder first (index 0 = cover).',
  })
  items: ResponseProductImageDto[];
}
