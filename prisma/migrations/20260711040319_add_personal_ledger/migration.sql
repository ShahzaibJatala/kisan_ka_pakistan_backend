-- CreateTable
CREATE TABLE "PersonalLedger" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Personal Ledger',
    "description" TEXT,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalTransaction" (
    "id" SERIAL NOT NULL,
    "ledgerId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonalLedger_userId_key" ON "PersonalLedger"("userId");

-- AddForeignKey
ALTER TABLE "PersonalLedger" ADD CONSTRAINT "PersonalLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTransaction" ADD CONSTRAINT "PersonalTransaction_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "PersonalLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
