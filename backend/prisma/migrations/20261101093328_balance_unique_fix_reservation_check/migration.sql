-- DropIndex
DROP INDEX "stock_balances_part_id_material_id_warehouse_id_location_id_key";


-- reservations: allow zero quantity for fully-consumed reservations
ALTER TABLE "inventory_reservations" DROP CONSTRAINT "chk_inv_reservation_qty_positive";
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "chk_inv_reservation_qty_positive" CHECK ("quantity" >= 0);
