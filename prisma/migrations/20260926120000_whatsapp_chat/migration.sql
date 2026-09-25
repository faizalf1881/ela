-- CreateEnum
CREATE TYPE "ChatMode" AS ENUM ('AI', 'HUMAN');

-- CreateEnum
CREATE TYPE "ChatState" AS ENUM ('AI_HANDLING', 'HUMAN_HANDLING', 'WAITING_CUSTOMER', 'REQUIRES_ATTENTION');

-- CreateEnum
CREATE TYPE "ChatSender" AS ENUM ('CUSTOMER', 'AI', 'STAFF', 'SYSTEM');

-- CreateTable
CREATE TABLE "WaConversation" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "customerId" TEXT,
    "profileName" TEXT,
    "mode" "ChatMode" NOT NULL DEFAULT 'AI',
    "state" "ChatState" NOT NULL DEFAULT 'AI_HANDLING',
    "attentionReason" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastPreview" TEXT,
    "handledByLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "sender" "ChatSender" NOT NULL,
    "staffLabel" TEXT,
    "type" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT NOT NULL,
    "waMessageId" TEXT,
    "status" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaHandlingEvent" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "fromMode" "ChatMode",
    "toMode" "ChatMode" NOT NULL,
    "fromState" "ChatState",
    "toState" "ChatState" NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorLabel" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaHandlingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL DEFAULT 'DISABLED',
    "openaiModel" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "openaiKeyEnc" TEXT,
    "openaiKeyHint" TEXT,
    "openaiBaseUrl" TEXT,
    "ollamaUrl" TEXT,
    "ollamaModel" TEXT NOT NULL DEFAULT 'llama3.1',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "instructions" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaConversation_phone_key" ON "WaConversation"("phone");

-- CreateIndex
CREATE INDEX "WaConversation_state_idx" ON "WaConversation"("state");

-- CreateIndex
CREATE INDEX "WaConversation_lastMessageAt_idx" ON "WaConversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "WaConversation_customerId_idx" ON "WaConversation"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "WaMessage_waMessageId_key" ON "WaMessage"("waMessageId");

-- CreateIndex
CREATE INDEX "WaMessage_conversationId_createdAt_idx" ON "WaMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "WaHandlingEvent_conversationId_createdAt_idx" ON "WaHandlingEvent"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "WaConversation" ADD CONSTRAINT "WaConversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WaConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaHandlingEvent" ADD CONSTRAINT "WaHandlingEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WaConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

