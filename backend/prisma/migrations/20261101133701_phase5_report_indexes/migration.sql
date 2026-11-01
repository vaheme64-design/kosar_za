-- CreateIndex
CREATE INDEX "customer_order_lines_due_date_idx" ON "customer_order_lines"("due_date");

-- CreateIndex
CREATE INDEX "customer_order_lines_status_idx" ON "customer_order_lines"("status");

-- CreateIndex
CREATE INDEX "manufacturing_orders_completed_at_idx" ON "manufacturing_orders"("completed_at");

-- CreateIndex
CREATE INDEX "production_operations_planned_end_idx" ON "production_operations"("planned_end");
