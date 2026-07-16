-- CreateTable
CREATE TABLE "ArtiaFarmerHistory" (
    "id" SERIAL NOT NULL,
    "farmerId" INTEGER NOT NULL,
    "artiaId" INTEGER NOT NULL,
    "leftBy" TEXT NOT NULL,
    "leftAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtiaFarmerHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArtiaFarmerHistory_farmerId_idx" ON "ArtiaFarmerHistory"("farmerId");

-- CreateIndex
CREATE INDEX "ArtiaFarmerHistory_artiaId_idx" ON "ArtiaFarmerHistory"("artiaId");

-- AddForeignKey
ALTER TABLE "ArtiaFarmerHistory" ADD CONSTRAINT "ArtiaFarmerHistory_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtiaFarmerHistory" ADD CONSTRAINT "ArtiaFarmerHistory_artiaId_fkey" FOREIGN KEY ("artiaId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
