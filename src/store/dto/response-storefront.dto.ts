import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Release 1.2 public store DTOs (WF22).
 *
 * These are an ALLOWLIST: only the fields a browsing customer may see. Cost,
 * supplier, IMEI, SKU, barcode, the private `description` and `shopId` must
 * never appear here — tests assert their absence from every public response.
 */

/** The three stock labels the store shows (WF22 example: "LOW_STOCK"). */
export type StoreAvailability = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

/** Public spec sheet. null = the owner never filled it in. */
export class StoreSpecsDto {
  @ApiPropertyOptional({ example: 'SM-A155F' })
  model: string | null;

  @ApiPropertyOptional({ example: 'Blue' })
  color: string | null;

  @ApiPropertyOptional({ example: '6GB' })
  ram: string | null;

  @ApiPropertyOptional({ example: '128GB' })
  storage: string | null;
}

/**
 * One published product exactly as the customer sees it. Price is in paisa
 * (divide by 100) and is null when the owner chose contactForPrice;
 * stockCount is null unless the owner opted into showExactStock.
 */
export class ResponseStoreProductDto {
  @ApiProperty({
    description: 'Product id.',
    example: '01924f0a-0000-7000-8000-000000000002',
  })
  id: string;

  @ApiProperty({ description: 'Product name.', example: 'Samsung A15' })
  name: string;

  @ApiProperty({ description: 'Brand name.', example: 'Samsung' })
  brand: string;

  @ApiProperty({ description: 'Category name.', example: 'Mobile Phones' })
  category: string;

  @ApiProperty({
    description:
      'Selling price in paisa, or null when contactForPrice is true. Rs 45,000 = 4500000.',
    example: 4500000,
  })
  price: number | null;

  @ApiProperty({
    description: 'true = customers must message the owner to learn the price.',
    example: false,
  })
  contactForPrice: boolean;

  @ApiProperty({
    description: 'IN_STOCK | LOW_STOCK | OUT_OF_STOCK.',
    example: 'LOW_STOCK',
  })
  availability: StoreAvailability;

  @ApiProperty({
    description:
      'Exact number on hand — null unless the owner turned on showExactStock.',
    example: null,
  })
  stockCount: number | null;

  @ApiPropertyOptional({
    description: 'PTA status for phones; null on accessories or when unknown.',
    enum: ['PTA_APPROVED', 'NON_PTA'],
    example: 'PTA_APPROVED',
  })
  ptaStatus?: 'PTA_APPROVED' | 'NON_PTA' | null;

  @ApiProperty({
    description: 'Image URLs sorted by sortOrder — index 0 is the cover.',
    type: [String],
    example: ['https://cdn.example.com/a15-1.jpg'],
  })
  images: string[];

  @ApiPropertyOptional({
    description:
      'The PUBLIC description. The private product description is never returned.',
    example: 'Brand new, box pack, 1 year warranty.',
  })
  description?: string | null;

  @ApiProperty({ type: () => StoreSpecsDto })
  specs: StoreSpecsDto;
}

/**
 * The public store profile — the allowlisted face of shop_store_settings.
 * Deliberately carries no shopId and no showExactStock switch.
 */
export class ResponseStoreDto {
  @ApiProperty({ description: 'Store address.', example: 'khalid-mobile' })
  slug: string;

  @ApiProperty({ description: 'Store name.', example: 'Khalid Mobile Center' })
  displayName: string;

  @ApiPropertyOptional({ description: 'Short intro story.' })
  about?: string | null;

  @ApiPropertyOptional({ description: 'Logo image URL.' })
  logoUrl?: string | null;

  @ApiPropertyOptional({ description: 'Banner image URL.' })
  bannerUrl?: string | null;

  @ApiPropertyOptional({
    description: 'WhatsApp number (international digits).',
  })
  whatsappNumber?: string | null;

  @ApiPropertyOptional({ description: 'Display phone number.' })
  phoneNumber?: string | null;

  @ApiPropertyOptional({ description: 'Street address.' })
  address?: string | null;

  @ApiPropertyOptional({ description: 'City.' })
  city?: string | null;

  @ApiPropertyOptional({ description: 'Google Maps link.' })
  googleMapsUrl?: string | null;

  @ApiPropertyOptional({ description: 'Opening hours text.' })
  openingHours?: string | null;

  @ApiPropertyOptional({ description: 'Facebook page URL.' })
  facebookUrl?: string | null;

  @ApiPropertyOptional({ description: 'Instagram profile URL.' })
  instagramUrl?: string | null;
}

/** One filter chip on the store (a category or a brand). */
export class StoreFilterOptionDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000010' })
  id: string;

  @ApiProperty({ example: 'Mobile Phones' })
  name: string;
}

/** Categories and brands that have at least one published product. */
export class ResponseStoreCategoriesDto {
  @ApiProperty({ type: [StoreFilterOptionDto] })
  categories: StoreFilterOptionDto[];

  @ApiProperty({ type: [StoreFilterOptionDto] })
  brands: StoreFilterOptionDto[];
}

export class ResponseStoreListItemDto extends ResponseStoreDto {
  @ApiPropertyOptional({
    description: 'Count of active and published products in this store.',
    example: 45,
  })
  totalProducts?: number;
}

