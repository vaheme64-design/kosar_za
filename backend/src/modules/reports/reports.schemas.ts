/**
 * KPIMS — Phase 5: report filter validation (Zod).
 * Unknown keys are rejected so callers cannot smuggle unindexed filters.
 */
import { z } from 'zod';

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ باید به قالب YYYY-MM-DD باشد')
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00.000Z`).getTime()), 'تاریخ نامعتبر است');

const uuid = z.string().uuid('شناسه نامعتبر است');

export const reportFiltersSchema = z
  .object({
    from: dateStr.optional(),
    to: dateStr.optional(),
    partId: uuid.optional(),
    materialId: uuid.optional(),
    customerId: uuid.optional(),
    machineId: uuid.optional(),
    operationId: uuid.optional(),
    warehouseId: uuid.optional(),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .strict();

export type ReportFilters = z.infer<typeof reportFiltersSchema>;

export const drillDownSchema = z
  .object({
    kind: z.string().min(3).max(40),
    /** Single UUID or server-issued composite id ("partId|opCode|from|to"). */
    id: z.string().min(1).max(220),
    from: dateStr.optional(),
    to: dateStr.optional(),
  })
  .strict();

export type DrillDownQuery = z.infer<typeof drillDownSchema>;
