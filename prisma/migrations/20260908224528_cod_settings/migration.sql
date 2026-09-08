-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "codConfirmAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "codEnabled" BOOLEAN NOT NULL DEFAULT true;

