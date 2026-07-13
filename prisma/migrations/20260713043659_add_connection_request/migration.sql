-- CreateTable
CREATE TABLE "ConnectionRequest" (
    "id" SERIAL NOT NULL,
    "artiaId" INTEGER NOT NULL,
    "farmerId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConnectionRequest_artiaId_farmerId_key" ON "ConnectionRequest"("artiaId", "farmerId");
