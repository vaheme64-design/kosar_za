import { z } from 'zod';

const decimalField = z.union([z.number(), z.string()]).transform((v) => String(v));
const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

// ---------------------------------------------------------------------------
// Manufacturing orders
// ---------------------------------------------------------------------------

export const createMoSchema = z.object({
  partId: z.string().uuid(),
  quantity: decimalField.refine((v) => Number(v) > 0, 'quantity must be positive'),
  /** Explicit route; otherwise the newest ACTIVE route version of the part. */
  routeId: z.string().uuid().optional(),
  dueDate: dateField.nullable().optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  planLineId: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const moActionSchema = z.object({
  notes: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Production reports
// ---------------------------------------------------------------------------

export const scrapInputSchema = z.object({
  reason: z.enum(['MATERIAL_DEFECT', 'DIE_DEFECT', 'MACHINE_FAULT', 'OPERATOR_ERROR', 'QUALITY_REJECT', 'SETUP_WASTE', 'OTHER']),
  quantity: decimalField.refine((v) => Number(v) > 0, 'scrap quantity must be positive'),
  weightKg: decimalField.nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});

export const createReportSchema = z.object({
  operationId: z.string().uuid(),
  reportDate: dateField,
  shiftId: z.string().uuid().nullable().optional(),
  machineId: z.string().uuid().nullable().optional(),
  dieId: z.string().uuid().nullable().optional(),
  /** Pieces fed into the process during this report (including rework re-feed). */
  inputQuantity: decimalField,
  /** Good output of this report. */
  producedQuantity: decimalField,
  /** Definitively defective output (non-reworkable). */
  rejectedQuantity: decimalField.default('0'),
  /** Output needing re-processing (will be re-fed later). */
  reworkQuantity: decimalField.default('0'),
  scraps: z.array(scrapInputSchema).max(20).default([]),
  notes: z.string().max(500).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Production transfers
// ---------------------------------------------------------------------------

export const createTransferSchema = z
  .object({
    partId: z.string().uuid(),
    /** null = feed from warehouse (first operation input). */
    fromOperationId: z.string().uuid().nullable().optional(),
    /** null when transferring to the finished-goods warehouse. */
    toOperationId: z.string().uuid().nullable().optional(),
    /** Required when fromOperationId is null. */
    fromWarehouseId: z.string().uuid().nullable().optional(),
    /** Required when toOperationId is null (finished-goods warehouse). */
    toWarehouseId: z.string().uuid().nullable().optional(),
    quantity: decimalField.refine((v) => Number(v) > 0, 'quantity must be positive'),
    transferDate: dateField,
    notes: z.string().max(500).nullable().optional(),
  })
  .superRefine((t, ctx) => {
    if (!t.fromOperationId && !t.fromWarehouseId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fromWarehouseId'], message: 'fromWarehouseId is required when feeding from a warehouse' });
    }
    if (!t.toOperationId && !t.toWarehouseId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['toWarehouseId'], message: 'toWarehouseId or toOperationId is required' });
    }
    if (t.toOperationId && t.toWarehouseId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['toOperationId'], message: 'Choose either target operation or target warehouse' });
    }
  });

export const transferActionSchema = z.object({
  notes: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Query filters
// ---------------------------------------------------------------------------

export const moFilterSchema = z.object({
  status: z.enum(['PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED']).optional(),
  partId: z.string().uuid().optional(),
  take: z.coerce.number().int().min(1).max(500).default(100),
});

export const reportFilterSchema = z.object({
  operationId: z.string().uuid().optional(),
  moId: z.string().uuid().optional(),
  take: z.coerce.number().int().min(1).max(500).default(100),
});

export const transferFilterSchema = z.object({
  moId: z.string().uuid().optional(),
  partId: z.string().uuid().optional(),
  take: z.coerce.number().int().min(1).max(500).default(100),
});
