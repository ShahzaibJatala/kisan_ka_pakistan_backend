-- Canonical catalog + per-shop offer migration. Legacy PesticideProduct rows
-- are retained only for historic receipt/order compatibility.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "catalog_products" (
  "id" SERIAL PRIMARY KEY,
  "genericName" VARCHAR(160) NOT NULL,
  "brand" VARCHAR(100) NOT NULL,
  "displayName" VARCHAR(200),
  "category" VARCHAR(100),
  "description" TEXT,
  "images" JSONB,
  "standardUnit" VARCHAR(60),
  "status" VARCHAR(30) NOT NULL DEFAULT 'active',
  "rejectionReason" TEXT,
  "requestedShopId" INTEGER REFERENCES "PesticideShop"("id") ON DELETE SET NULL,
  "submittedById" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
  "approvedById" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalog_products_genericName_brand_key" UNIQUE ("genericName", "brand")
);
CREATE INDEX "catalog_products_status_category_idx" ON "catalog_products" ("status", "category");
CREATE INDEX "catalog_products_search_trgm_idx" ON "catalog_products" USING GIN (lower("genericName" || ' ' || "brand" || ' ' || coalesce("displayName", '')) gin_trgm_ops);

CREATE TABLE "shop_offers" (
  "id" SERIAL PRIMARY KEY,
  "shopId" INTEGER NOT NULL REFERENCES "PesticideShop"("id") ON DELETE CASCADE,
  "catalogProductId" INTEGER NOT NULL REFERENCES "catalog_products"("id") ON DELETE RESTRICT,
  "price" DOUBLE PRECISION NOT NULL,
  "stockQuantity" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shop_offers_shopId_catalogProductId_key" UNIQUE ("shopId", "catalogProductId")
);
CREATE INDEX "shop_offers_catalogProductId_active_idx" ON "shop_offers" ("catalogProductId", "active");
CREATE INDEX "shop_offers_shopId_active_idx" ON "shop_offers" ("shopId", "active");

INSERT INTO "catalog_products" ("genericName", "brand", "displayName", "category", "description", "standardUnit", "status", "createdAt", "updatedAt")
SELECT DISTINCT ON (COALESCE(NULLIF(trim("genericName"), ''), "name"), COALESCE(NULLIF(trim("brand"), ''), 'Unbranded'))
  COALESCE(NULLIF(trim("genericName"), ''), "name"), COALESCE(NULLIF(trim("brand"), ''), 'Unbranded'), "name", "category", "description", "packSize", 'active', "createdAt", "updatedAt"
FROM "PesticideProduct"
ORDER BY COALESCE(NULLIF(trim("genericName"), ''), "name"), COALESCE(NULLIF(trim("brand"), ''), 'Unbranded'), "createdAt";

INSERT INTO "shop_offers" ("shopId", "catalogProductId", "price", "stockQuantity", "active", "createdAt", "updatedAt")
SELECT p."shopId", c."id", p."price", p."stockQuantity", p."isActive", p."createdAt", p."updatedAt"
FROM "PesticideProduct" p
JOIN "catalog_products" c ON c."genericName" = COALESCE(NULLIF(trim(p."genericName"), ''), p."name") AND c."brand" = COALESCE(NULLIF(trim(p."brand"), ''), 'Unbranded')
ON CONFLICT ("shopId", "catalogProductId") DO NOTHING;

ALTER TABLE "PesticideOrderItem" ADD COLUMN IF NOT EXISTS "shopOfferId" INTEGER;
ALTER TABLE "PesticideOrderItem" ADD CONSTRAINT "PesticideOrderItem_shopOfferId_fkey" FOREIGN KEY ("shopOfferId") REFERENCES "shop_offers"("id") ON DELETE SET NULL;
UPDATE "PesticideOrderItem" oi SET "shopOfferId" = so."id"
FROM "PesticideProduct" p JOIN "shop_offers" so ON so."shopId" = p."shopId"
WHERE oi."productId" = p."id" AND oi."shopOfferId" IS NULL;
