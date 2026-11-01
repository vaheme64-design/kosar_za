import { z } from 'zod';

/**
 * Decimal-friendly field: accepts number or string, returns string that
 * Prisma.Decimal can parse exactly (no float arithmetic anywhere).
 */
const decimalField = z.union([z.number(), z.string()]).transform((v) => String(v));

export const inventoryDocTypeEnum = z.enum([
  'RECEIPT',
  'ISSUE',
  'TRANSFER',
  'ADJUSTMENT',
  'PRODUCTION_RECEIPT',
  'PRODUCTION_ISSUE',
  'SCRAP_DISPOSAL',
]);

export const ownershipEnum = z.enum(['OWNED', 'SUPPLIER_CONSIGNMENT']);
export const qualityStatusEnum = z.enum(['PENDING', 'APPROVED', 'BLOCKED']);
export const adjustmentReasonEnum = z.enum([
  'OPENING_BALANCE',
  'COUNT_CORRECTION',
  'DAMAGE',
  'LOSS',
  'FOUND',
  'QUALITY_RELEASE',
  'OTHER',
]);

// ---------------------------------------------------------------------------
// Document lines
// ---------------------------------------------------------------------------

/** A receipt line: brings stock INTO the warehouse (optionally lot-tracked). */
export const receiptLineSchema = z
  .object({
    partId: z.string().uuid().optional(),
    materialId: z.string().uuid().optional(),
    /** Existing lot to receive into (material). */
    lotId: z.string().uuid().optional(),
    /** New lot number to create on posting (material). */
    lotNumber: z.string().trim().min(1).max(64).optional(),
    contractId: z.string().uuid().nullable().optional(),
    quantity: decimalField,
    unitId: z.string().uuid().optional(),
    weightKg: decimalField.nullable().optional(),
    toLocationId: z.string().uuid().nullable().optional(),
    ownership: ownershipEnum.optional(),
    qualityStatus: qualityStatusEnum.optional(),
    supplierLotNumber: z.string().trim().max(190).nullable().optional(),
    certificateNumber: z.string().trim().max(190).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .superRefine((line, ctx) => {
    if (!line.partId && !line.materialId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['partId'], message: 'partId or materialId is required' });
    }
    if (line.partId && line.materialId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['partId'], message: 'Choose either part or material, not both' });
    }
  });

/** An issue/disposal line: takes stock OUT of the warehouse. */
export const issueLineSchema = z
  .object({
    partId: z.string().uuid().optional(),
    materialId: z.string().uuid().optional(),
    /** Material issues are lot-tracked: draw from a specific lot. */
    lotId: z.string().uuid().optional(),
    quantity: decimalField,
    unitId: z.string().uuid().optional(),
    weightKg: decimalField.nullable().optional(),
    fromLocationId: z.string().uuid().nullable().optional(),
    reservationId: z.string().uuid().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .superRefine((line, ctx) => {
    if (!line.partId && !line.materialId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['partId'], message: 'partId or materialId is required' });
    }
    if (line.partId && line.materialId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['partId'], message: 'Choose either part or material, not both' });
    }
  });

/** A transfer line: stock moves between locations/warehouses. */
export const transferLineSchema = z
  .object({
    partId: z.string().uuid().optional(),
    materialId: z.string().uuid().optional(),
    lotId: z.string().uuid().optional(),
    quantity: decimalField,
    unitId: z.string().uuid().optional(),
    weightKg: decimalField.nullable().optional(),
    fromLocationId: z.string().uuid(),
    toLocationId: z.string().uuid(),
    notes: z.string().max(500).nullable().optional(),
  })
  .superRefine((line, ctx) => {
    if (!line.partId && !line.materialId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['partId'], message: 'partId or materialId is required' });
    }
    if (line.partId && line.materialId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['partId'], message: 'Choose either part or material, not both' });
    }
    if (line.fromLocationId === line.toLocationId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['toLocationId'], message: 'Source and destination locations must differ' });
    }
  });

/**
 * An adjustment line: positive quantity = increase (ADJUSTMENT_IN),
 * negative quantity = decrease (ADJUSTMENT_OUT). Every adjustment document
 * requires a reason at document level (rule 9).
 */
export const adjustmentLineSchema = z
  .object({
    partId: z.string().uuid().optional(),
    materialId: z.string().uuid().optional(),
    lotId: z.string().uuid().nullable().optional(),
    lotNumber: z.string().trim().min(1).max(64).optional(),
    quantity: decimalField.refine((v) => v !== '0', 'Quantity cannot be zero'),
    unitId: z.string().uuid().optional(),
    weightKg: decimalField.nullable().optional(),
    locationId: z.string().uuid().nullable().optional(),
    ownership: ownershipEnum.optional(),
    qualityStatus: qualityStatusEnum.optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .superRefine((line, ctx) => {
    if (!line.partId && !line.materialId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['partId'], message: 'partId or materialId is required' });
    }
    if (line.partId && line.materialId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['partId'], message: 'Choose either part or material, not both' });
    }
  });

const lineSchemas = {
  RECEIPT: receiptLineSchema,
  PRODUCTION_RECEIPT: receiptLineSchema,
  ISSUE: issueLineSchema,
  PRODUCTION_ISSUE: issueLineSchema,
  SCRAP_DISPOSAL: issueLineSchema,
  TRANSFER: transferLineSchema,
  ADJUSTMENT: adjustmentLineSchema,
} as const;

// ---------------------------------------------------------------------------
// Document create
// ---------------------------------------------------------------------------

export const createDocumentSchema = z
  .object({
    documentType: inventoryDocTypeEnum,
    documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'documentDate must be YYYY-MM-DD'),
    warehouseId: z.string().uuid(),
    description: z.string().max(500).nullable().optional(),
    reasonCode: adjustmentReasonEnum.optional(),
    reasonText: z.string().max(500).nullable().optional(),
    referenceType: z.string().max(64).optional(),
    referenceId: z.string().uuid().optional(),
    lines: z.array(z.unknown()).min(1, 'At least one line is required').max(200),
  })
  .superRefine((doc, ctx) => {
    if (doc.documentType === 'ADJUSTMENT' && !doc.reasonCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasonCode'],
        message: 'reasonCode is required for adjustment documents',
      });
    }
  });

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type RawDocumentLine = Record<string, unknown>;

export function lineSchemaFor(documentType: keyof typeof lineSchemas) {
  return lineSchemas[documentType];
}

// ---------------------------------------------------------------------------
// Reversal / cancel
// ---------------------------------------------------------------------------

export const reverseDocumentSchema = z.object({
  reason: z.string().trim().min(3, 'Reversal reason is required').max(500),
});

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

export const createReservationSchema = z
  .object({
    partId: z.string().uuid().optional(),
    materialId: z.string().uuid().optional(),
    warehouseId: z.string().uuid().nullable().optional(),
    quantity: decimalField,
    unitId: z.string().uuid().optional(),
    forManufacturingOrderId: z.string().uuid().nullable().optional(),
    forCustomerOrderLineId: z.string().uuid().nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .superRefine((r, ctx) => {
    if (!r.partId && !r.materialId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['partId'], message: 'partId or materialId is required' });
    }
    if (r.partId && r.materialId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['partId'], message: 'Choose either part or material, not both' });
    }
  });

// ---------------------------------------------------------------------------
// Contracts (SAPCO)
// ---------------------------------------------------------------------------

export const createContractSchema = z.object({
  contractNumber: z.string().trim().min(1).max(32),
  supplierName: z.string().trim().max(190).default('SAPCO'),
  materialId: z.string().uuid(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  totalQuantity: decimalField,
  totalWeightKg: decimalField.nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Quality release (moves qty from BLOCKED/PENDING → APPROVED dimensions)
// ---------------------------------------------------------------------------

export const qualityReleaseSchema = z.object({
  lotId: z.string().uuid().optional(),
  partId: z.string().uuid().optional(),
  materialId: z.string().uuid().optional(),
  warehouseId: z.string().uuid(),
  locationId: z.string().uuid().nullable().optional(),
  fromQualityStatus: qualityStatusEnum,
  /** Optional explicit unit; defaults to the unit of the existing stock rows. */
  unitId: z.string().uuid().optional(),
  quantity: decimalField,
  notes: z.string().max(500).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Query filters (validated at controller level)
// ---------------------------------------------------------------------------

export const balanceFilterSchema = z.object({
  partId: z.string().uuid().optional(),
  materialId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  lotId: z.string().uuid().optional(),
  ownership: ownershipEnum.optional(),
  qualityStatus: qualityStatusEnum.optional(),
});

export const ledgerFilterSchema = z.object({
  partId: z.string().uuid().optional(),
  materialId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  lotId: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
  type: z.enum(['RECEIPT', 'ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  take: z.coerce.number().int().min(1).max(500).default(100),
});

export const sapcoAccountQuerySchema = z.object({
  materialId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
