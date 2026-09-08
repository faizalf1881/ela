-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryDate" DATE,
ADD COLUMN     "deliverySlotId" TEXT;

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "deliveryDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
ADD COLUMN     "maxPreorderDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "orderCutoffMinutes" INTEGER NOT NULL DEFAULT 480;

-- CreateTable
CREATE TABLE "DeliverySlot" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliverySlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotBlock" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "locationId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlotBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliverySlot_active_idx" ON "DeliverySlot"("active");

-- CreateIndex
CREATE INDEX "SlotBlock_date_idx" ON "SlotBlock"("date");

-- CreateIndex
CREATE UNIQUE INDEX "SlotBlock_slotId_date_locationId_key" ON "SlotBlock"("slotId", "date", "locationId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliverySlotId_fkey" FOREIGN KEY ("deliverySlotId") REFERENCES "DeliverySlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotBlock" ADD CONSTRAINT "SlotBlock_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "DeliverySlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

