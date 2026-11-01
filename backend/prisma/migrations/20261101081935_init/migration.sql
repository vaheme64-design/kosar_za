-- CreateEnum
CREATE TYPE "unit_kind" AS ENUM ('COUNT', 'WEIGHT', 'LENGTH', 'AREA');

-- CreateEnum
CREATE TYPE "material_type" AS ENUM ('SHEET', 'COIL', 'PROFILE', 'PAINT', 'CONSUMABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "material_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "part_type" AS ENUM ('FINISHED_PART', 'SEMI_FINISHED', 'SUBASSEMBLY');

-- CreateEnum
CREATE TYPE "part_status" AS ENUM ('ACTIVE', 'INACTIVE', 'PHASED_OUT');

-- CreateEnum
CREATE TYPE "route_status" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "machine_type" AS ENUM ('PRESS', 'CUTTING', 'PRESS_WELDING', 'CO2_WELDING', 'PAINTING', 'ASSEMBLY', 'OTHER');

-- CreateEnum
CREATE TYPE "machine_status" AS ENUM ('ACTIVE', 'MAINTENANCE', 'BREAKDOWN', 'RETIRED');

-- CreateEnum
CREATE TYPE "die_status" AS ENUM ('ACTIVE', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "warehouse_type" AS ENUM ('RAW_MATERIAL', 'WIP', 'FINISHED_GOODS', 'SCRAP', 'TOOLS');

-- CreateEnum
CREATE TYPE "customer_order_status" AS ENUM ('DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "order_line_status" AS ENUM ('OPEN', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "plan_status" AS ENUM ('DRAFT', 'CONFIRMED', 'RELEASED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "mo_priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "mo_status" AS ENUM ('PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "operation_status" AS ENUM ('PENDING', 'QUEUED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "posting_status" AS ENUM ('UNPOSTED', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "scrap_reason" AS ENUM ('MATERIAL_DEFECT', 'DIE_DEFECT', 'MACHINE_FAULT', 'OPERATOR_ERROR', 'QUALITY_REJECT', 'SETUP_WASTE', 'OTHER');

-- CreateEnum
CREATE TYPE "transfer_status" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "assignment_status" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "inventory_doc_type" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT', 'PRODUCTION_RECEIPT', 'PRODUCTION_ISSUE', 'SCRAP_DISPOSAL');

-- CreateEnum
CREATE TYPE "inventory_doc_status" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "inventory_tx_type" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT');

-- CreateEnum
CREATE TYPE "reservation_status" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "lot_status" AS ENUM ('OPEN', 'CLOSED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "contract_status" AS ENUM ('OPEN', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "sequence_reset_policy" AS ENUM ('NEVER', 'YEARLY');

-- CreateEnum
CREATE TYPE "setting_value_type" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'JSON');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "email" VARCHAR(190),
    "full_name" VARCHAR(190) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "role_id" UUID NOT NULL,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "name_fa" VARCHAR(190) NOT NULL,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "module" VARCHAR(64) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "description" VARCHAR(500),

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64),
    "entity_id" VARCHAR(64),
    "changes" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" UUID NOT NULL,
    "key" VARCHAR(32) NOT NULL,
    "title" VARCHAR(190),
    "prefix" VARCHAR(16) NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "pad_length" INTEGER NOT NULL DEFAULT 6,
    "reset_policy" "sequence_reset_policy" NOT NULL DEFAULT 'NEVER',
    "last_reset_year" INTEGER,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "value_type" "setting_value_type" NOT NULL DEFAULT 'STRING',
    "description" VARCHAR(500),
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "name_fa" VARCHAR(190) NOT NULL,
    "name_en" VARCHAR(190) NOT NULL,
    "kind" "unit_kind" NOT NULL DEFAULT 'COUNT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" UUID NOT NULL,
    "material_code" VARCHAR(64) NOT NULL,
    "name_fa" VARCHAR(190) NOT NULL,
    "name_en" VARCHAR(190),
    "material_type" "material_type" NOT NULL DEFAULT 'SHEET',
    "grade" VARCHAR(64),
    "thickness_mm" DECIMAL(10,3),
    "width_mm" DECIMAL(10,2),
    "length_mm" DECIMAL(10,2),
    "unit_weight_kg" DECIMAL(18,4),
    "base_unit_id" UUID NOT NULL,
    "supplier_name" VARCHAR(190) NOT NULL DEFAULT 'SAPCO',
    "status" "material_status" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts" (
    "id" UUID NOT NULL,
    "part_number" VARCHAR(64) NOT NULL,
    "name_fa" VARCHAR(190) NOT NULL,
    "name_en" VARCHAR(190),
    "part_type" "part_type" NOT NULL DEFAULT 'FINISHED_PART',
    "status" "part_status" NOT NULL DEFAULT 'ACTIVE',
    "base_unit_id" UUID NOT NULL,
    "standard_weight_kg" DECIMAL(18,4),
    "main_material_id" UUID,
    "primary_customer_id" UUID,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name_fa" VARCHAR(190) NOT NULL,
    "name_en" VARCHAR(190),
    "contact_person" VARCHAR(190),
    "phone" VARCHAR(32),
    "email" VARCHAR(190),
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations" (
    "id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "name_fa" VARCHAR(190) NOT NULL,
    "name_en" VARCHAR(190) NOT NULL,
    "description" TEXT,
    "default_setup_time_min" INTEGER,
    "default_cycle_time_sec" DECIMAL(10,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_routes" (
    "id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" VARCHAR(190),
    "status" "route_status" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "effective_from" DATE,
    "superseded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "part_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_route_steps" (
    "id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "operation_id" UUID NOT NULL,
    "machine_id" UUID,
    "die_id" UUID,
    "setup_time_min" INTEGER,
    "cycle_time_sec" DECIMAL(10,2),
    "scrap_factor_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "part_route_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machines" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name_fa" VARCHAR(190) NOT NULL,
    "name_en" VARCHAR(190),
    "machine_type" "machine_type" NOT NULL,
    "tonnage" DECIMAL(10,2),
    "manufacturer" VARCHAR(190),
    "location" VARCHAR(190),
    "status" "machine_status" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_capabilities" (
    "machine_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "standard_rate_per_hour" DECIMAL(10,2),
    "notes" VARCHAR(500),

    CONSTRAINT "machine_capabilities_pkey" PRIMARY KEY ("machine_id","operation_id")
);

-- CreateTable
CREATE TABLE "dies" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name_fa" VARCHAR(190) NOT NULL,
    "description" TEXT,
    "status" "die_status" NOT NULL DEFAULT 'ACTIVE',
    "storage_location" VARCHAR(190),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_die_compatibility" (
    "machine_id" UUID NOT NULL,
    "die_id" UUID NOT NULL,
    "notes" VARCHAR(500),

    CONSTRAINT "machine_die_compatibility_pkey" PRIMARY KEY ("machine_id","die_id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "name_fa" VARCHAR(190) NOT NULL,
    "warehouse_type" "warehouse_type" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_locations" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name_fa" VARCHAR(190) NOT NULL,
    "capacity_kg" DECIMAL(18,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "warehouse_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "name_fa" VARCHAR(190) NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_orders" (
    "id" UUID NOT NULL,
    "order_number" VARCHAR(32) NOT NULL,
    "customer_id" UUID NOT NULL,
    "order_date" DATE NOT NULL,
    "due_date" DATE,
    "status" "customer_order_status" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_order_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "part_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "delivered_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "due_date" DATE,
    "status" "order_line_status" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,

    CONSTRAINT "customer_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_plans" (
    "id" UUID NOT NULL,
    "plan_number" VARCHAR(32) NOT NULL,
    "title" VARCHAR(190) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "plan_status" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "created_by_id" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "confirmed_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "production_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_plan_lines" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "part_id" UUID NOT NULL,
    "planned_quantity" DECIMAL(18,4) NOT NULL,
    "customer_order_line_id" UUID,
    "notes" TEXT,

    CONSTRAINT "production_plan_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_orders" (
    "id" UUID NOT NULL,
    "mo_number" VARCHAR(32) NOT NULL,
    "part_id" UUID NOT NULL,
    "route_id" UUID,
    "plan_line_id" UUID,
    "quantity" DECIMAL(18,4) NOT NULL,
    "due_date" DATE,
    "priority" "mo_priority" NOT NULL DEFAULT 'NORMAL',
    "status" "mo_status" NOT NULL DEFAULT 'PLANNED',
    "released_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "manufacturing_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_operations" (
    "id" UUID NOT NULL,
    "manufacturing_order_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "operation_id" UUID NOT NULL,
    "route_step_id" UUID,
    "machine_id" UUID,
    "status" "operation_status" NOT NULL DEFAULT 'PENDING',
    "planned_start" TIMESTAMPTZ(6),
    "planned_end" TIMESTAMPTZ(6),
    "actual_start" TIMESTAMPTZ(6),
    "actual_end" TIMESTAMPTZ(6),
    "planned_quantity" DECIMAL(18,4) NOT NULL,
    "produced_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "scrapped_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "production_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_reports" (
    "id" UUID NOT NULL,
    "report_number" VARCHAR(32) NOT NULL,
    "operation_id" UUID NOT NULL,
    "machine_id" UUID,
    "die_id" UUID,
    "shift_id" UUID,
    "operator_id" UUID,
    "report_date" DATE NOT NULL,
    "produced_quantity" DECIMAL(18,4) NOT NULL,
    "rework_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "report_status" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "posting_status" NOT NULL DEFAULT 'UNPOSTED',
    "posted_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "production_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_scraps" (
    "id" UUID NOT NULL,
    "report_id" UUID,
    "operation_id" UUID,
    "part_id" UUID,
    "reason" "scrap_reason" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "weight_kg" DECIMAL(18,4),
    "description" TEXT,
    "scrap_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_scraps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_transfers" (
    "id" UUID NOT NULL,
    "transfer_number" VARCHAR(32) NOT NULL,
    "part_id" UUID NOT NULL,
    "from_operation_id" UUID,
    "to_operation_id" UUID,
    "from_warehouse_id" UUID,
    "to_warehouse_id" UUID,
    "quantity" DECIMAL(18,4) NOT NULL,
    "weight_kg" DECIMAL(18,4),
    "transfer_date" DATE NOT NULL,
    "status" "transfer_status" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "posting_status" NOT NULL DEFAULT 'UNPOSTED',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "production_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_assignments" (
    "id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "machine_id" UUID NOT NULL,
    "die_id" UUID,
    "shift_id" UUID,
    "planned_start" TIMESTAMPTZ(6) NOT NULL,
    "planned_end" TIMESTAMPTZ(6),
    "status" "assignment_status" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "machine_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_documents" (
    "id" UUID NOT NULL,
    "document_number" VARCHAR(32) NOT NULL,
    "document_type" "inventory_doc_type" NOT NULL,
    "status" "inventory_doc_status" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "posting_status" NOT NULL DEFAULT 'UNPOSTED',
    "document_date" DATE NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "reference_type" VARCHAR(64),
    "reference_id" UUID,
    "description" TEXT,
    "created_by_id" UUID NOT NULL,
    "posted_by_id" UUID,
    "posted_at" TIMESTAMPTZ(6),
    "reversal_of_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_document_lines" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "part_id" UUID,
    "material_id" UUID,
    "lot_id" UUID,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_id" UUID NOT NULL,
    "weight_kg" DECIMAL(18,4),
    "from_location_id" UUID,
    "to_location_id" UUID,
    "notes" TEXT,

    CONSTRAINT "inventory_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL,
    "transaction_number" VARCHAR(32) NOT NULL,
    "document_id" UUID,
    "document_line_id" UUID,
    "type" "inventory_tx_type" NOT NULL,
    "part_id" UUID,
    "material_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID,
    "lot_id" UUID,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_id" UUID NOT NULL,
    "weight_kg" DECIMAL(18,4),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversal_of_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" UUID NOT NULL,
    "part_id" UUID,
    "material_id" UUID,
    "warehouse_id" UUID,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_id" UUID NOT NULL,
    "for_manufacturing_order_id" UUID,
    "for_customer_order_line_id" UUID,
    "status" "reservation_status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL,
    "part_id" UUID,
    "material_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID,
    "lot_id" UUID,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "weight_kg" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "last_transaction_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_lots" (
    "id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "lot_number" VARCHAR(64) NOT NULL,
    "receipt_date" DATE NOT NULL,
    "quantity_received" DECIMAL(18,4) NOT NULL,
    "quantity_remaining" DECIMAL(18,4) NOT NULL,
    "weight_received_kg" DECIMAL(18,4) NOT NULL,
    "weight_remaining_kg" DECIMAL(18,4) NOT NULL,
    "status" "lot_status" NOT NULL DEFAULT 'OPEN',
    "certificate_number" VARCHAR(190),
    "supplier_lot_number" VARCHAR(190),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "material_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_contracts" (
    "id" UUID NOT NULL,
    "contract_number" VARCHAR(32) NOT NULL,
    "supplier_name" VARCHAR(190) NOT NULL DEFAULT 'SAPCO',
    "material_id" UUID NOT NULL,
    "order_date" DATE NOT NULL,
    "expected_delivery_date" DATE,
    "total_quantity" DECIMAL(18,4) NOT NULL,
    "total_weight_kg" DECIMAL(18,4),
    "status" "contract_status" NOT NULL DEFAULT 'OPEN',
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "material_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_contract_transactions" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "received_date" DATE NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "weight_kg" DECIMAL(18,4),
    "lot_id" UUID,
    "inventory_document_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_contract_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_id_idx" ON "users"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_key_key" ON "document_sequences"("key");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "units_of_measure_code_key" ON "units_of_measure"("code");

-- CreateIndex
CREATE UNIQUE INDEX "materials_material_code_key" ON "materials"("material_code");

-- CreateIndex
CREATE INDEX "materials_material_type_idx" ON "materials"("material_type");

-- CreateIndex
CREATE INDEX "materials_supplier_name_idx" ON "materials"("supplier_name");

-- CreateIndex
CREATE UNIQUE INDEX "parts_part_number_key" ON "parts"("part_number");

-- CreateIndex
CREATE INDEX "parts_part_type_idx" ON "parts"("part_type");

-- CreateIndex
CREATE INDEX "parts_status_idx" ON "parts"("status");

-- CreateIndex
CREATE INDEX "parts_main_material_id_idx" ON "parts"("main_material_id");

-- CreateIndex
CREATE INDEX "parts_primary_customer_id_idx" ON "parts"("primary_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE INDEX "customers_is_active_idx" ON "customers"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "operations_code_key" ON "operations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "part_routes_superseded_by_id_key" ON "part_routes"("superseded_by_id");

-- CreateIndex
CREATE INDEX "part_routes_part_id_idx" ON "part_routes"("part_id");

-- CreateIndex
CREATE INDEX "part_routes_status_idx" ON "part_routes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "part_routes_part_id_version_key" ON "part_routes"("part_id", "version");

-- CreateIndex
CREATE INDEX "part_route_steps_operation_id_idx" ON "part_route_steps"("operation_id");

-- CreateIndex
CREATE INDEX "part_route_steps_machine_id_idx" ON "part_route_steps"("machine_id");

-- CreateIndex
CREATE INDEX "part_route_steps_die_id_idx" ON "part_route_steps"("die_id");

-- CreateIndex
CREATE UNIQUE INDEX "part_route_steps_route_id_sequence_key" ON "part_route_steps"("route_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "machines_code_key" ON "machines"("code");

-- CreateIndex
CREATE INDEX "machines_machine_type_idx" ON "machines"("machine_type");

-- CreateIndex
CREATE INDEX "machines_status_idx" ON "machines"("status");

-- CreateIndex
CREATE INDEX "machine_capabilities_operation_id_idx" ON "machine_capabilities"("operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "dies_code_key" ON "dies"("code");

-- CreateIndex
CREATE INDEX "machine_die_compatibility_die_id_idx" ON "machine_die_compatibility"("die_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_locations_warehouse_id_code_key" ON "warehouse_locations"("warehouse_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_code_key" ON "shifts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "customer_orders_order_number_key" ON "customer_orders"("order_number");

-- CreateIndex
CREATE INDEX "customer_orders_customer_id_idx" ON "customer_orders"("customer_id");

-- CreateIndex
CREATE INDEX "customer_orders_status_idx" ON "customer_orders"("status");

-- CreateIndex
CREATE INDEX "customer_orders_order_date_idx" ON "customer_orders"("order_date");

-- CreateIndex
CREATE INDEX "customer_order_lines_part_id_idx" ON "customer_order_lines"("part_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_order_lines_order_id_line_no_key" ON "customer_order_lines"("order_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "production_plans_plan_number_key" ON "production_plans"("plan_number");

-- CreateIndex
CREATE INDEX "production_plans_status_idx" ON "production_plans"("status");

-- CreateIndex
CREATE INDEX "production_plans_period_start_idx" ON "production_plans"("period_start");

-- CreateIndex
CREATE INDEX "production_plans_created_by_id_idx" ON "production_plans"("created_by_id");

-- CreateIndex
CREATE INDEX "production_plan_lines_part_id_idx" ON "production_plan_lines"("part_id");

-- CreateIndex
CREATE INDEX "production_plan_lines_customer_order_line_id_idx" ON "production_plan_lines"("customer_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_plan_lines_plan_id_line_no_key" ON "production_plan_lines"("plan_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_orders_mo_number_key" ON "manufacturing_orders"("mo_number");

-- CreateIndex
CREATE INDEX "manufacturing_orders_part_id_idx" ON "manufacturing_orders"("part_id");

-- CreateIndex
CREATE INDEX "manufacturing_orders_status_idx" ON "manufacturing_orders"("status");

-- CreateIndex
CREATE INDEX "manufacturing_orders_due_date_idx" ON "manufacturing_orders"("due_date");

-- CreateIndex
CREATE INDEX "manufacturing_orders_route_id_idx" ON "manufacturing_orders"("route_id");

-- CreateIndex
CREATE INDEX "manufacturing_orders_plan_line_id_idx" ON "manufacturing_orders"("plan_line_id");

-- CreateIndex
CREATE INDEX "production_operations_operation_id_idx" ON "production_operations"("operation_id");

-- CreateIndex
CREATE INDEX "production_operations_machine_id_idx" ON "production_operations"("machine_id");

-- CreateIndex
CREATE INDEX "production_operations_status_idx" ON "production_operations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "production_operations_manufacturing_order_id_sequence_key" ON "production_operations"("manufacturing_order_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "production_reports_report_number_key" ON "production_reports"("report_number");

-- CreateIndex
CREATE INDEX "production_reports_operation_id_idx" ON "production_reports"("operation_id");

-- CreateIndex
CREATE INDEX "production_reports_machine_id_idx" ON "production_reports"("machine_id");

-- CreateIndex
CREATE INDEX "production_reports_report_date_idx" ON "production_reports"("report_date");

-- CreateIndex
CREATE INDEX "production_reports_posting_status_idx" ON "production_reports"("posting_status");

-- CreateIndex
CREATE INDEX "production_scraps_report_id_idx" ON "production_scraps"("report_id");

-- CreateIndex
CREATE INDEX "production_scraps_operation_id_idx" ON "production_scraps"("operation_id");

-- CreateIndex
CREATE INDEX "production_scraps_part_id_idx" ON "production_scraps"("part_id");

-- CreateIndex
CREATE INDEX "production_scraps_scrap_date_idx" ON "production_scraps"("scrap_date");

-- CreateIndex
CREATE UNIQUE INDEX "production_transfers_transfer_number_key" ON "production_transfers"("transfer_number");

-- CreateIndex
CREATE INDEX "production_transfers_part_id_idx" ON "production_transfers"("part_id");

-- CreateIndex
CREATE INDEX "production_transfers_transfer_date_idx" ON "production_transfers"("transfer_date");

-- CreateIndex
CREATE INDEX "production_transfers_posting_status_idx" ON "production_transfers"("posting_status");

-- CreateIndex
CREATE INDEX "machine_assignments_operation_id_idx" ON "machine_assignments"("operation_id");

-- CreateIndex
CREATE INDEX "machine_assignments_machine_id_idx" ON "machine_assignments"("machine_id");

-- CreateIndex
CREATE INDEX "machine_assignments_status_idx" ON "machine_assignments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_documents_document_number_key" ON "inventory_documents"("document_number");

-- CreateIndex
CREATE INDEX "inventory_documents_warehouse_id_idx" ON "inventory_documents"("warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_documents_document_type_idx" ON "inventory_documents"("document_type");

-- CreateIndex
CREATE INDEX "inventory_documents_status_idx" ON "inventory_documents"("status");

-- CreateIndex
CREATE INDEX "inventory_documents_posting_status_idx" ON "inventory_documents"("posting_status");

-- CreateIndex
CREATE INDEX "inventory_documents_document_date_idx" ON "inventory_documents"("document_date");

-- CreateIndex
CREATE INDEX "inventory_documents_reversal_of_id_idx" ON "inventory_documents"("reversal_of_id");

-- CreateIndex
CREATE INDEX "inventory_document_lines_part_id_idx" ON "inventory_document_lines"("part_id");

-- CreateIndex
CREATE INDEX "inventory_document_lines_material_id_idx" ON "inventory_document_lines"("material_id");

-- CreateIndex
CREATE INDEX "inventory_document_lines_lot_id_idx" ON "inventory_document_lines"("lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_document_lines_document_id_line_no_key" ON "inventory_document_lines"("document_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transactions_transaction_number_key" ON "inventory_transactions"("transaction_number");

-- CreateIndex
CREATE INDEX "inventory_transactions_document_id_idx" ON "inventory_transactions"("document_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_document_line_id_idx" ON "inventory_transactions"("document_line_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_part_id_idx" ON "inventory_transactions"("part_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_material_id_idx" ON "inventory_transactions"("material_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_warehouse_id_idx" ON "inventory_transactions"("warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_location_id_idx" ON "inventory_transactions"("location_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_lot_id_idx" ON "inventory_transactions"("lot_id");

-- CreateIndex
CREATE INDEX "inventory_transactions_occurred_at_idx" ON "inventory_transactions"("occurred_at");

-- CreateIndex
CREATE INDEX "inventory_transactions_type_idx" ON "inventory_transactions"("type");

-- CreateIndex
CREATE INDEX "inventory_reservations_part_id_idx" ON "inventory_reservations"("part_id");

-- CreateIndex
CREATE INDEX "inventory_reservations_material_id_idx" ON "inventory_reservations"("material_id");

-- CreateIndex
CREATE INDEX "inventory_reservations_warehouse_id_idx" ON "inventory_reservations"("warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_reservations_status_idx" ON "inventory_reservations"("status");

-- CreateIndex
CREATE INDEX "inventory_reservations_for_manufacturing_order_id_idx" ON "inventory_reservations"("for_manufacturing_order_id");

-- CreateIndex
CREATE INDEX "inventory_reservations_for_customer_order_line_id_idx" ON "inventory_reservations"("for_customer_order_line_id");

-- CreateIndex
CREATE INDEX "stock_balances_warehouse_id_idx" ON "stock_balances"("warehouse_id");

-- CreateIndex
CREATE INDEX "stock_balances_part_id_idx" ON "stock_balances"("part_id");

-- CreateIndex
CREATE INDEX "stock_balances_material_id_idx" ON "stock_balances"("material_id");

-- CreateIndex
CREATE INDEX "stock_balances_location_id_idx" ON "stock_balances"("location_id");

-- CreateIndex
CREATE INDEX "stock_balances_lot_id_idx" ON "stock_balances"("lot_id");

-- CreateIndex
-- NULLS NOT DISTINCT: two balance rows with NULL location/lot in the same
-- warehouse must still conflict (Postgres < 15 would need partial indexes here)
CREATE UNIQUE INDEX "stock_balances_part_id_material_id_warehouse_id_location_id_key" ON "stock_balances"("part_id", "material_id", "warehouse_id", "location_id", "lot_id") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "material_lots_status_idx" ON "material_lots"("status");

-- CreateIndex
CREATE INDEX "material_lots_receipt_date_idx" ON "material_lots"("receipt_date");

-- CreateIndex
CREATE UNIQUE INDEX "material_lots_material_id_lot_number_key" ON "material_lots"("material_id", "lot_number");

-- CreateIndex
CREATE UNIQUE INDEX "material_contracts_contract_number_key" ON "material_contracts"("contract_number");

-- CreateIndex
CREATE INDEX "material_contracts_material_id_idx" ON "material_contracts"("material_id");

-- CreateIndex
CREATE INDEX "material_contracts_status_idx" ON "material_contracts"("status");

-- CreateIndex
CREATE INDEX "material_contracts_order_date_idx" ON "material_contracts"("order_date");

-- CreateIndex
CREATE INDEX "material_contract_transactions_contract_id_idx" ON "material_contract_transactions"("contract_id");

-- CreateIndex
CREATE INDEX "material_contract_transactions_received_date_idx" ON "material_contract_transactions"("received_date");

-- CreateIndex
CREATE INDEX "material_contract_transactions_lot_id_idx" ON "material_contract_transactions"("lot_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_base_unit_id_fkey" FOREIGN KEY ("base_unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_base_unit_id_fkey" FOREIGN KEY ("base_unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_main_material_id_fkey" FOREIGN KEY ("main_material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_primary_customer_id_fkey" FOREIGN KEY ("primary_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_routes" ADD CONSTRAINT "part_routes_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_routes" ADD CONSTRAINT "part_routes_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "part_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_route_steps" ADD CONSTRAINT "part_route_steps_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "part_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_route_steps" ADD CONSTRAINT "part_route_steps_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_route_steps" ADD CONSTRAINT "part_route_steps_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_route_steps" ADD CONSTRAINT "part_route_steps_die_id_fkey" FOREIGN KEY ("die_id") REFERENCES "dies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_capabilities" ADD CONSTRAINT "machine_capabilities_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_capabilities" ADD CONSTRAINT "machine_capabilities_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_die_compatibility" ADD CONSTRAINT "machine_die_compatibility_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_die_compatibility" ADD CONSTRAINT "machine_die_compatibility_die_id_fkey" FOREIGN KEY ("die_id") REFERENCES "dies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order_lines" ADD CONSTRAINT "customer_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "customer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order_lines" ADD CONSTRAINT "customer_order_lines_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "production_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_customer_order_line_id_fkey" FOREIGN KEY ("customer_order_line_id") REFERENCES "customer_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "part_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_orders" ADD CONSTRAINT "manufacturing_orders_plan_line_id_fkey" FOREIGN KEY ("plan_line_id") REFERENCES "production_plan_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_manufacturing_order_id_fkey" FOREIGN KEY ("manufacturing_order_id") REFERENCES "manufacturing_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_route_step_id_fkey" FOREIGN KEY ("route_step_id") REFERENCES "part_route_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_operations" ADD CONSTRAINT "production_operations_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_reports" ADD CONSTRAINT "production_reports_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "production_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_reports" ADD CONSTRAINT "production_reports_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_reports" ADD CONSTRAINT "production_reports_die_id_fkey" FOREIGN KEY ("die_id") REFERENCES "dies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_reports" ADD CONSTRAINT "production_reports_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_reports" ADD CONSTRAINT "production_reports_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_scraps" ADD CONSTRAINT "production_scraps_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "production_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_scraps" ADD CONSTRAINT "production_scraps_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "production_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_scraps" ADD CONSTRAINT "production_scraps_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_transfers" ADD CONSTRAINT "production_transfers_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_transfers" ADD CONSTRAINT "production_transfers_from_operation_id_fkey" FOREIGN KEY ("from_operation_id") REFERENCES "production_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_transfers" ADD CONSTRAINT "production_transfers_to_operation_id_fkey" FOREIGN KEY ("to_operation_id") REFERENCES "production_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_transfers" ADD CONSTRAINT "production_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_transfers" ADD CONSTRAINT "production_transfers_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_assignments" ADD CONSTRAINT "machine_assignments_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "production_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_assignments" ADD CONSTRAINT "machine_assignments_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_assignments" ADD CONSTRAINT "machine_assignments_die_id_fkey" FOREIGN KEY ("die_id") REFERENCES "dies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_assignments" ADD CONSTRAINT "machine_assignments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "inventory_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "inventory_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "material_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "inventory_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_document_line_id_fkey" FOREIGN KEY ("document_line_id") REFERENCES "inventory_document_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "material_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_for_manufacturing_order_id_fkey" FOREIGN KEY ("for_manufacturing_order_id") REFERENCES "manufacturing_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_for_customer_order_line_id_fkey" FOREIGN KEY ("for_customer_order_line_id") REFERENCES "customer_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "material_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_contracts" ADD CONSTRAINT "material_contracts_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_contract_transactions" ADD CONSTRAINT "material_contract_transactions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "material_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_contract_transactions" ADD CONSTRAINT "material_contract_transactions_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "material_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_contract_transactions" ADD CONSTRAINT "material_contract_transactions_inventory_document_id_fkey" FOREIGN KEY ("inventory_document_id") REFERENCES "inventory_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- KPIMS business integrity CHECK constraints (server-side, DB-level guard)
-- ============================================================================

-- exactly one item dimension (part XOR material)
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "chk_inv_tx_item" CHECK (num_nonnulls("part_id", "material_id") = 1);
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "chk_inv_doc_line_item" CHECK (num_nonnulls("part_id", "material_id") = 1);
ALTER TABLE "stock_balances" ADD CONSTRAINT "chk_stock_balance_item" CHECK (num_nonnulls("part_id", "material_id") = 1);
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "chk_inv_reservation_item" CHECK (num_nonnulls("part_id", "material_id") = 1);

-- quantities are strictly positive on ledger rows and reservations
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "chk_inv_tx_qty_positive" CHECK ("quantity" > 0);
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "chk_inv_reservation_qty_positive" CHECK ("quantity" > 0);

-- the official balance can never go negative
ALTER TABLE "stock_balances" ADD CONSTRAINT "chk_stock_balance_qty_non_negative" CHECK ("quantity" >= 0);

-- a reversal transaction must point at the original and differ in type
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "chk_inv_tx_reversal_self" CHECK ("reversal_of_id" IS NULL OR "reversal_of_id" <> "id");
ALTER TABLE "inventory_documents" ADD CONSTRAINT "chk_inv_doc_reversal_self" CHECK ("reversal_of_id" IS NULL OR "reversal_of_id" <> "id");
