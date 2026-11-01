-- AlterTable
ALTER TABLE "inventory_document_lines" ADD COLUMN     "lot_number" VARCHAR(64),
ADD COLUMN     "ownership" "stock_ownership",
ADD COLUMN     "quality_status" "quality_status";

