-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIAL';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "codBalanceDue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "codConfirmPaid" INTEGER NOT NULL DEFAULT 0;

