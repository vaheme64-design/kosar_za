-- KPIMS — Phase 8: MRP utility, supplier matrix report, ledger snapshots.
--
-- 1) Composite indexes for the hot reporting paths (item + time ranges and
--    per-type scans) — the supplier matrix and movement reports filter by
--    material/part + occurred_at on every call.
-- 2) mv_daily_ledger — a materialized daily rollup of the immutable ledger.
--    Dashboards and matrix reports aggregate this instead of scanning the
--    full transaction table; it is refreshed explicitly (never the source of
--    truth — StockBalance/InventoryTransaction remain authoritative).

-- CreateIndex
CREATE INDEX "inventory_transactions_material_occurred_idx" ON "inventory_transactions"("material_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_transactions_part_occurred_idx" ON "inventory_transactions"("part_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_transactions_warehouse_occurred_idx" ON "inventory_transactions"("warehouse_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_transactions_material_type_occurred_idx" ON "inventory_transactions"("material_id", "type", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_reservations_item_active_idx" ON "inventory_reservations"("part_id", "material_id", "status");

-- Materialized daily ledger snapshot.
-- Nullable dimensions are coalesced to fixed sentinels so a UNIQUE index can
-- back REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE MATERIALIZED VIEW "mv_daily_ledger" AS
SELECT
  (t.occurred_at AT TIME ZONE 'UTC')::date                    AS "day",
  COALESCE(t.part_id, '00000000-0000-0000-0000-000000000000'::uuid)     AS "part_key",
  COALESCE(t.material_id, '00000000-0000-0000-0000-000000000000'::uuid) AS "material_key",
  t.warehouse_id                                              AS "warehouse_id",
  COALESCE(t.location_id, '00000000-0000-0000-0000-000000000000'::uuid) AS "location_key",
  COALESCE(t.lot_id, '00000000-0000-0000-0000-000000000000'::uuid)      AS "lot_key",
  t.ownership,
  t.quality_status,
  t.type,
  COUNT(*)        AS "tx_count",
  SUM(t.quantity) AS "quantity_sum",
  SUM(t.weight_kg) AS "weight_kg_sum"
FROM "inventory_transactions" t
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9;

-- Unique index (required for REFRESH ... CONCURRENTLY).
CREATE UNIQUE INDEX "mv_daily_ledger_dims_idx"
  ON "mv_daily_ledger" ("day", "part_key", "material_key", "warehouse_id", "location_key", "lot_key", "ownership", "quality_status", "type");

-- Supporting indexes for the matrix / movement queries.
CREATE INDEX "mv_daily_ledger_material_day_idx" ON "mv_daily_ledger" ("material_key", "day");
CREATE INDEX "mv_daily_ledger_part_day_idx" ON "mv_daily_ledger" ("part_key", "day");
