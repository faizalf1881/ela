-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "servingInfo" TEXT;

-- CreateTable
CREATE TABLE "SiteContent" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "featuredItemId" TEXT,
    "featuredLabel" TEXT NOT NULL DEFAULT 'Today''s Special',
    "featuredNote" TEXT,
    "promoActive" BOOLEAN NOT NULL DEFAULT false,
    "promoText" TEXT,
    "promoCode" TEXT,
    "heroStats" JSONB,
    "ratingMode" TEXT NOT NULL DEFAULT 'AUTO',
    "ratingValue" TEXT,
    "ratingNote" TEXT,
    "deliveryTime" TEXT,
    "openingHours" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "instagramUrl" TEXT,
    "facebookUrl" TEXT,
    "xUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteContent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SiteContent" ADD CONSTRAINT "SiteContent_featuredItemId_fkey" FOREIGN KEY ("featuredItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
