-- AlterTable
ALTER TABLE "ArtiaProfile" ADD COLUMN     "secondPhone" TEXT;

-- CreateTable
CREATE TABLE "FarmerArtiaConnection" (
    "id" SERIAL NOT NULL,
    "farmerId" INTEGER NOT NULL,
    "artiaId" INTEGER NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FarmerArtiaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JoinBypassRequest" (
    "id" SERIAL NOT NULL,
    "farmerName" TEXT NOT NULL,
    "farmerPhone" TEXT NOT NULL,
    "farmerCnic" TEXT NOT NULL,
    "targetArtiaId" INTEGER NOT NULL,
    "reason" TEXT,
    "targetRole" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JoinBypassRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FarmerArtiaConnection_phone_idx" ON "FarmerArtiaConnection"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "FarmerArtiaConnection_farmerId_artiaId_key" ON "FarmerArtiaConnection"("farmerId", "artiaId");

-- AddForeignKey
ALTER TABLE "FarmerLedger" ADD CONSTRAINT "FarmerLedger_createdByArtiaId_fkey" FOREIGN KEY ("createdByArtiaId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmerArtiaConnection" ADD CONSTRAINT "FarmerArtiaConnection_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "FarmerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmerArtiaConnection" ADD CONSTRAINT "FarmerArtiaConnection_artiaId_fkey" FOREIGN KEY ("artiaId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JoinBypassRequest" ADD CONSTRAINT "JoinBypassRequest_targetArtiaId_fkey" FOREIGN KEY ("targetArtiaId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JoinBypassRequest" ADD CONSTRAINT "JoinBypassRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
