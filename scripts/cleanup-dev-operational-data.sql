-- Cleanup of API smoke-test artifacts from the DEV database (kpims).
-- The Phase-1 seed created NO operational documents; every inventory document
-- here was created by the smoke test, so removing all of them restores the
-- documented state. Test database (kpims_test) is recreated by vitest and is
-- not affected.
DELETE FROM "inventory_transactions";
DELETE FROM "inventory_document_lines";
DELETE FROM "inventory_documents";
DELETE FROM "stock_balances";
DELETE FROM "material_lots";
DELETE FROM "material_contract_transactions";
DELETE FROM "inventory_reservations";
DELETE FROM "production_transfers";
DELETE FROM "production_scraps";
DELETE FROM "production_reports";
DELETE FROM "production_operations";
DELETE FROM "manufacturing_orders";
DELETE FROM "audit_logs" WHERE "entity_type" IN ('InventoryDocument', 'ProductionReport', 'ProductionTransfer', 'ManufacturingOrder', 'InventoryReservation', 'MaterialContract');
UPDATE "document_sequences" SET "next_number" = 1001 WHERE "key" IN ('INV', 'TX', 'MO', 'PR', 'TRF');
