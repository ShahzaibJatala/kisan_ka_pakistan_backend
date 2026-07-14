-- AlterTable
ALTER TABLE "FarmerProfile" ADD COLUMN     "shareInCount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showOwnDetailsPublicly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ArtiaProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "shopName" TEXT,
    "shopPhone" TEXT,
    "address" TEXT,
    "commissionRules" TEXT,
    "showFarmerCount" BOOLEAN NOT NULL DEFAULT false,
    "showFarmerDetails" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtiaProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_ur" TEXT NOT NULL,
    "body_en" TEXT NOT NULL,
    "body_ur" TEXT NOT NULL,
    "metadata" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtiaProfile_userId_key" ON "ArtiaProfile"("userId");

-- AddForeignKey
ALTER TABLE "ArtiaProfile" ADD CONSTRAINT "ArtiaProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
