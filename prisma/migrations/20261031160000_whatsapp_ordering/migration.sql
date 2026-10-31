-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "waOrderingEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "WaOrderDraft" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "deliveryLocationId" TEXT,
    "deliveryDate" TEXT,
    "deliverySlotId" TEXT,
    "address" TEXT,
    "customerName" TEXT,
    "step" TEXT NOT NULL DEFAULT 'BROWSING',
    "quotedTotal" INTEGER,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaOrderDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaOrderDraft_conversationId_key" ON "WaOrderDraft"("conversationId");

-- AddForeignKey
ALTER TABLE "WaOrderDraft" ADD CONSTRAINT "WaOrderDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WaConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
