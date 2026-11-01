-- CreateEnum
CREATE TYPE "stock_ownership" AS ENUM ('OWNED', 'SUPPLIER_CONSIGNMENT');

-- CreateEnum
CREATE TYPE "quality_status" AS ENUM ('PENDING', 'APPROVED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "adjustment_reason" AS ENUM ('OPENING_BALANCE', 'COUNT_CORRECTION', 'DAMAGE', 'LOSS', 'FOUND', 'QUALITY_RELEASE', 'OTHER');

-- AlterTable
ALTER TABLE "inventory_document_lines" ADD COLUMN     "contract_id" UUID,
ADD COLUMN     "reservation_id" UUID;

-- AlterTable
ALTER TABLE "inventory_documents" ADD COLUMN     "reason_code" "adjustment_reason",
ADD COLUMN     "reason_text" VARCHAR(500);

-- AlterTable
ALTER TABLE "inventory_transactions" ADD COLUMN     "ownership" "stock_ownership" NOT NULL DEFAULT 'OWNED',
ADD COLUMN     "quality_status" "quality_status" NOT NULL DEFAULT 'APPROVED';

-- AlterTable
ALTER TABLE "material_lots" ADD COLUMN     "ownership" "stock_ownership" NOT NULL DEFAULT 'OWNED';

-- AlterTable
ALTER TABLE "production_operations" ADD COLUMN     "input_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "received_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "rejected_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "rework_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "transferred_out_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "wip_location_id" UUID,
ADD COLUMN     "wip_since_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "production_reports" ADD COLUMN     "input_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "rejected_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "stock_balances" ADD COLUMN     "balance_key" VARCHAR(220) NOT NULL,
ADD COLUMN     "ownership" "stock_ownership" NOT NULL DEFAULT 'OWNED',
ADD COLUMN     "quality_status" "quality_status" NOT NULL DEFAULT 'APPROVED';

-- CreateIndex
CREATE INDEX "inventory_transactions_ownership_idx" ON "inventory_transactions"("ownership");

-- CreateIndex
CREATE INDEX "inventory_transactions_quality_status_idx" ON "inventory_transactions"("quality_status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_balance_key_key" ON "stock_balances"("balance_key");

-- CreateIndex
CREATE INDEX "stock_balances_ownership_idx" ON "stock_balances"("ownership");

-- CreateIndex
CREATE INDEX "stock_balances_quality_status_idx" ON "stock_balances"("quality_status");

-- AddForeignKey
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_wip_location_id_fkey" FOREIGN KEY ("wip_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "material_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "inventory_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

