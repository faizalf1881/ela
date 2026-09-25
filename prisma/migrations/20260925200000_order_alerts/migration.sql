-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "placedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "orderAlertSeconds" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "orderSoundName" TEXT,
ADD COLUMN     "orderSoundUrl" TEXT;

-- CreateIndex
CREATE INDEX "Order_placedAt_idx" ON "Order"("placedAt");


-- Backfill: every order that already has an invoice was placed when it was created.
UPDATE "Order" SET "placedAt" = "createdAt" WHERE "invoiceNo" IS NOT NULL AND "placedAt" IS NULL;
