/**
 * KPIMS — Phase 4: planning module request schemas (zod).
 */
import { z } from 'zod';

const uuid = z.string().uuid('شناسه معتبر نیست');
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ باید به قالب YYYY-MM-DD باشد');

export const runPlanningSchema = z
  .object({
    orderIds: z.array(uuid).max(200).optional(),
    partIds: z.array(uuid).max(500).optional(),
    dueFrom: isoDate.optional(),
    dueTo: isoDate.optional(),
    horizonDays: z.coerce.number().int().min(1).max(365).optional(),
    notes: z.string().max(500).optional(),
  })
  .refine(
    (v) => !(v.dueFrom && v.dueTo) || v.dueFrom <= v.dueTo,
    { message: 'بازه تاریخ سررسید نامعتبر است', path: ['dueTo'] },
  );

export type RunPlanningInput = z.infer<typeof runPlanningSchema>;

export const createCustomerOrderSchema = z
  .object({
    customerId: uuid,
    orderDate: isoDate,
    dueDate: isoDate.optional(),
    description: z.string().max(500).optional(),
    lines: z
      .array(
        z.object({
          partId: uuid,
          quantity: z.coerce.number().positive('مقدار باید مثبت باشد'),
          dueDate: isoDate.optional(),
          notes: z.string().max(500).optional(),
        }),
      )
      .min(1, 'حداقل یک ردیف سفارش لازم است')
      .max(200),
  })
  .refine(
    (v) => !(v.dueDate && v.lines.some((l) => l.dueDate && l.dueDate < v.dueDate!)),
    { message: 'سررسید ردیف نمی‌تواند قبل از سررسید سفارش باشد', path: ['lines'] },
  );

export type CreateCustomerOrderInput = z.infer<typeof createCustomerOrderSchema>;

export const listOrdersSchema = z.object({
  openOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});

export const planIdSchema = z.object({ id: uuid });

export const planningFilterSchema = z.object({
  partIds: z.string().optional(), // comma-separated uuids
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
});

export interface PlanningFilters {
  partIds?: string[];
  dueFrom?: string;
  dueTo?: string;
}
