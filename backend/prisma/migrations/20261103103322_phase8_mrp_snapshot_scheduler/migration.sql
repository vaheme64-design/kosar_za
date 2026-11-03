-- Phase 8 (scheduler): mrp_snapshots — stored results of MRP runs
-- (scheduled or manual). Read by the dashboard shortage alert and the MRP
-- page so the calculation is not repeated on every load.
--
-- Also normalises the phase-8 reporting index names to the ones Prisma
-- expects, so they can be declared in schema.prisma (a plain Prisma diff
-- would otherwise DROP these raw-SQL indexes on the next migration).
-- mv_daily_ledger is intentionally NOT touched (Prisma does not model views).

-- CreateTable
CREATE TABLE IF NOT EXISTS "mrp_snapshots" (
    "id" UUID NOT NULL,
    "ran_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggered_by" VARCHAR(64) NOT NULL,
    "summary_json" JSONB NOT NULL,
    "result_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mrp_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mrp_snapshots_ran_at_idx" ON "mrp_snapshots"("ran_at");

-- normalise phase-8 index names (no-op when the old names are absent)
DROP INDEX IF EXISTS "inventory_transactions_material_occurred_idx";
DROP INDEX IF EXISTS "inventory_transactions_part_occurred_idx";
DROP INDEX IF EXISTS "inventory_transactions_warehouse_occurred_idx";
DROP INDEX IF EXISTS "inventory_transactions_material_type_occurred_idx";
DROP INDEX IF EXISTS "inventory_reservations_item_active_idx";
CREATE INDEX IF NOT EXISTS "inventory_transactions_material_id_occurred_at_idx" ON "inventory_transactions"("material_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "inventory_transactions_part_id_occurred_at_idx" ON "inventory_transactions"("part_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "inventory_transactions_warehouse_id_occurred_at_idx" ON "inventory_transactions"("warehouse_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "inventory_transactions_material_id_type_occurred_at_idx" ON "inventory_transactions"("material_id", "type", "occurred_at");
CREATE INDEX IF NOT EXISTS "inventory_reservations_part_id_material_id_status_idx" ON "inventory_reservations"("part_id", "material_id", "status");
