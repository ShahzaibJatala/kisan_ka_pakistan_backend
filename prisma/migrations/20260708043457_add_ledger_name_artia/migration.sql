/*
  Warnings:

  - Added the required column `name` to the `FarmerLedger` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "FarmerLedger" ADD COLUMN     "createdByArtiaId" INTEGER,
ADD COLUMN     "name" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_mandiId_fkey" FOREIGN KEY ("mandiId") REFERENCES "Mandi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmerProfile" ADD CONSTRAINT "FarmerProfile_mandiId_fkey" FOREIGN KEY ("mandiId") REFERENCES "Mandi"("id") ON DELETE SET NULL ON UPDATE CASCADE;
