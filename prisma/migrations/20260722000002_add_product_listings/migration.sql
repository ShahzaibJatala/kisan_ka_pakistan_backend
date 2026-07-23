CREATE TABLE "ProductListing" (
  "id" SERIAL PRIMARY KEY,
  "productName" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL,
  "askingPrice" DOUBLE PRECISION NOT NULL,
  "description" TEXT,
  "phone" TEXT NOT NULL,
  "district" TEXT,
  "city" TEXT,
  "farmerId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ProductListing_district_city_idx" ON "ProductListing"("district", "city");
CREATE INDEX "ProductListing_productName_idx" ON "ProductListing"("productName");
