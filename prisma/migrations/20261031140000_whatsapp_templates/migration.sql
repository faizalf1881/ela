-- AlterTable
ALTER TABLE "WaConversation" ADD COLUMN     "aiTypingAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WaMessage" ADD COLUMN     "meta" JSONB,
ADD COLUMN     "replyId" TEXT;

-- CreateTable
CREATE TABLE "WaTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "parameterFormat" TEXT NOT NULL DEFAULT 'POSITIONAL',
    "components" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'meta',
    "metaId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaTemplate_status_idx" ON "WaTemplate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WaTemplate_name_language_key" ON "WaTemplate"("name", "language");
