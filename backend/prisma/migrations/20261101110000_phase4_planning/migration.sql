-- AlterEnum
ALTER TYPE "plan_status" ADD VALUE 'SUPERSEDED';

-- AlterTable
ALTER TABLE "operations" ADD COLUMN     "requires_die" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "part_route_steps" ADD COLUMN     "required_tonnage" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "production_plan_lines" ADD COLUMN     "covered_by_planned_mos" DECIMAL(18,4),
ADD COLUMN     "covered_by_reservations" DECIMAL(18,4),
ADD COLUMN     "covered_by_stock" DECIMAL(18,4),
ADD COLUMN     "covered_by_wip" DECIMAL(18,4),
ADD COLUMN     "detail" JSONB,
ADD COLUMN     "due_date" DATE,
ADD COLUMN     "feasible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "gross_quantity" DECIMAL(18,4),
ADD COLUMN     "route_id" UUID,
ADD COLUMN     "route_version" INTEGER;

-- AlterTable
ALTER TABLE "production_plans" ADD COLUMN     "planning_params" JSONB,
ADD COLUMN     "planning_run_at" TIMESTAMPTZ(6),
ADD COLUMN     "revision_of_id" UUID,
ADD COLUMN     "summary" JSONB,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "part_material_requirements" (
    "id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "quantity_per_unit" DECIMAL(18,4) NOT NULL,
    "weight_kg_per_unit" DECIMAL(18,4),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "part_material_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_line_operations" (
    "id" UUID NOT NULL,
    "plan_line_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "operation_id" UUID NOT NULL,
    "route_step_id" UUID,
    "required_output" DECIMAL(18,4) NOT NULL,
    "wip_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "wip_used" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "must_produce" DECIMAL(18,4) NOT NULL,
    "required_input" DECIMAL(18,4) NOT NULL,
    "arriving_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "time_source" VARCHAR(32),
    "estimated_hours" DECIMAL(12,4),
    "setup_minutes" INTEGER,
    "setup_source" VARCHAR(32),
    "feasible" BOOLEAN NOT NULL DEFAULT true,
    "infeasibleReasons" JSONB,
    "missing_info" JSONB,
    "recommended_machine_id" UUID,
    "recommended_die_id" UUID,
    "recommended_machine_code" VARCHAR(32),
    "recommended_die_code" VARCHAR(32),
    "recommended_rank" INTEGER,
    "candidates" JSONB,

    CONSTRAINT "plan_line_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_line_material_shortages" (
    "id" UUID NOT NULL,
    "plan_line_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "severity" VARCHAR(32) NOT NULL,
    "required_quantity" DECIMAL(18,4) NOT NULL,
    "available_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "consignment_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "shortage_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "covered_by_open_contracts" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "contractInfo" JSONB,
    "notes" TEXT,

    CONSTRAINT "plan_line_material_shortages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "part_material_requirements_material_id_idx" ON "part_material_requirements"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "part_material_requirements_part_id_material_id_key" ON "part_material_requirements"("part_id", "material_id");

-- CreateIndex
CREATE INDEX "plan_line_operations_operation_id_idx" ON "plan_line_operations"("operation_id");

-- CreateIndex
CREATE INDEX "plan_line_operations_recommended_machine_id_idx" ON "plan_line_operations"("recommended_machine_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_line_operations_plan_line_id_sequence_key" ON "plan_line_operations"("plan_line_id", "sequence");

-- CreateIndex
CREATE INDEX "plan_line_material_shortages_material_id_idx" ON "plan_line_material_shortages"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_line_material_shortages_plan_line_id_material_id_key" ON "plan_line_material_shortages"("plan_line_id", "material_id");

-- CreateIndex
CREATE INDEX "production_plan_lines_route_id_idx" ON "production_plan_lines"("route_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_plans_revision_of_id_key" ON "production_plans"("revision_of_id");

-- AddForeignKey
ALTER TABLE "part_material_requirements" ADD CONSTRAINT "part_material_requirements_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_material_requirements" ADD CONSTRAINT "part_material_requirements_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_revision_of_id_fkey" FOREIGN KEY ("revision_of_id") REFERENCES "production_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plan_lines" ADD CONSTRAINT "production_plan_lines_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "part_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_line_operations" ADD CONSTRAINT "plan_line_operations_plan_line_id_fkey" FOREIGN KEY ("plan_line_id") REFERENCES "production_plan_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_line_operations" ADD CONSTRAINT "plan_line_operations_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_line_operations" ADD CONSTRAINT "plan_line_operations_route_step_id_fkey" FOREIGN KEY ("route_step_id") REFERENCES "part_route_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_line_operations" ADD CONSTRAINT "plan_line_operations_recommended_machine_id_fkey" FOREIGN KEY ("recommended_machine_id") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_line_operations" ADD CONSTRAINT "plan_line_operations_recommended_die_id_fkey" FOREIGN KEY ("recommended_die_id") REFERENCES "dies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_line_material_shortages" ADD CONSTRAINT "plan_line_material_shortages_plan_line_id_fkey" FOREIGN KEY ("plan_line_id") REFERENCES "production_plan_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_line_material_shortages" ADD CONSTRAINT "plan_line_material_shortages_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Phase 4 data classification: press operations that require a die
-- (BLK = blanking, FRM = punching/forming are die operations by definition)
-- ---------------------------------------------------------------------------
UPDATE "operations" SET "requires_die" = true WHERE "code" IN ('BLK', 'FRM');
