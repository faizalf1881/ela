-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "statusChangedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "scanSteps" "OrderStatus"[] DEFAULT ARRAY['PLACED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED']::"OrderStatus"[];

