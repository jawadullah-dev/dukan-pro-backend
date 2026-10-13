-- CreateEnum
CREATE TYPE "PtaStatus" AS ENUM ('PTA_APPROVED', 'NON_PTA');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "contact_for_price" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pta_status" "PtaStatus",
ADD COLUMN     "public_description" TEXT,
ADD COLUMN     "published_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "shop_store_settings" (
    "shop_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "display_name" TEXT NOT NULL,
    "about" TEXT,
    "logo_url" TEXT,
    "banner_url" TEXT,
    "whatsapp_number" TEXT,
    "phone_number" TEXT,
    "address" TEXT,
    "city" TEXT,
    "google_maps_url" TEXT,
    "opening_hours" TEXT,
    "facebook_url" TEXT,
    "instagram_url" TEXT,
    "show_exact_stock" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shop_store_settings_pkey" PRIMARY KEY ("shop_id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_store_settings_slug_key" ON "shop_store_settings"("slug");

-- CreateIndex
CREATE INDEX "product_images_product_id_sort_order_idx" ON "product_images"("product_id", "sort_order");

-- CreateIndex
CREATE INDEX "product_images_shop_id_idx" ON "product_images"("shop_id");

-- AddForeignKey
ALTER TABLE "shop_store_settings" ADD CONSTRAINT "shop_store_settings_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
