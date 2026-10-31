-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "WaCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateId" TEXT,
    "templateName" TEXT NOT NULL,
    "templateLanguage" TEXT NOT NULL,
    "templateCategory" TEXT NOT NULL,
    "templateFormat" TEXT NOT NULL DEFAULT 'POSITIONAL',
    "components" JSONB NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "optInConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaCampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "data" JSONB,
    "customerId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'file',
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "body" TEXT,
    "waMessageId" TEXT,
    "error" TEXT,
    "errorCode" INTEGER,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaCampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaOptOut" (
    "phone" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaOptOut_pkey" PRIMARY KEY ("phone")
);

-- CreateIndex
CREATE INDEX "WaCampaign_status_idx" ON "WaCampaign"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WaCampaignRecipient_waMessageId_key" ON "WaCampaignRecipient"("waMessageId");

-- CreateIndex
CREATE INDEX "WaCampaignRecipient_campaignId_status_idx" ON "WaCampaignRecipient"("campaignId", "status");

-- CreateIndex
CREATE INDEX "WaCampaignRecipient_phone_idx" ON "WaCampaignRecipient"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "WaCampaignRecipient_campaignId_phone_key" ON "WaCampaignRecipient"("campaignId", "phone");

-- AddForeignKey
ALTER TABLE "WaCampaign" ADD CONSTRAINT "WaCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WaTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaCampaignRecipient" ADD CONSTRAINT "WaCampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "WaCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
