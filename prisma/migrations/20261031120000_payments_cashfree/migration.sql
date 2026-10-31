-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cashfreeOrderId" TEXT,
ADD COLUMN     "cashfreePaymentId" TEXT,
ADD COLUMN     "refundAmount" INTEGER,
ADD COLUMN     "refundId" TEXT,
ADD COLUMN     "refundNote" TEXT,
ADD COLUMN     "refundStatus" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "paymentGateway" TEXT NOT NULL DEFAULT 'AUTO';

-- CreateIndex
CREATE UNIQUE INDEX "Order_cashfreeOrderId_key" ON "Order"("cashfreeOrderId");
