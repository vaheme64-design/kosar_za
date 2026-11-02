/**
 * KPIMS — Phase 7: AI assistant routes.
 *
 * Three capabilities, all advisory / read-only:
 *   GET  /ai/status            — real probe of the configured AI endpoint
 *   POST /ai/assistant         — general Persian Q&A with KPIMS context
 *   POST /ai/suggest/document  — review a document DRAFT (never posts it)
 *   POST /ai/report-query      — Persian question → whitelisted report →
 *                                the REAL report runs and the AI only narrates
 *
 * Permissions: report-query requires reports.view (the AI can never surface
 * data the caller is not allowed to see); document suggestions require
 * inventory.view; general assistant needs only authentication.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth';
import { ApiError } from '../../lib/http';
import { recordAudit } from '../../lib/audit';
import { toJalaliDateString } from '../../lib/jalali';
import { chat, checkAiStatus, buildEntityHints, extractJsonObject, resolveReportQuery } from './ai.service';
import { documentSuggestSystemPrompt, kpimsContextFa, reportQuerySystemPrompt, reportSummarySystemPrompt } from './ai.prompts';
import { REPORT_CATALOG, type ReportTable } from '../reports/reports.types';
import { reportFiltersSchema, type ReportFilters } from '../reports/reports.schemas';
import { runReportByKey } from '../reports/reports.controller';

export const aiRouter = Router();

aiRouter.use(authenticate);

const h =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next: NextFunction) => {
    fn(req, res).catch(next);
  };

function userId(req: Request): string {
  if (!req.user) throw new ApiError(401, 'Unauthenticated', 'ابتدا وارد سامانه شوید', 'unauthorized');
  return req.user.id;
}

// ---------------------------------------------------------------------------
// status — real probe
// ---------------------------------------------------------------------------

aiRouter.get(
  '/status',
  h(async (_req, res) => {
    res.json(await checkAiStatus());
  }),
);

// ---------------------------------------------------------------------------
// general assistant (authenticated users)
// ---------------------------------------------------------------------------

const assistantSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) }))
    .max(8)
    .optional(),
});

aiRouter.post(
  '/assistant',
  h(async (req, res) => {
    const body = assistantSchema.parse(req.body ?? {});
    const messages = [
      { role: 'system' as const, content: kpimsContextFa() },
      ...(body.history ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: body.message },
    ];
    const result = await chat(messages, { temperature: 0.3, maxTokens: 1200 });
    await recordAudit(null, {
      userId: userId(req),
      action: 'AI_ASSISTANT',
      entityType: 'ai',
      entityId: null,
      changes: { messageLength: body.message.length, latencyMs: result.latencyMs },
      ipAddress: req.ip ?? null,
    });
    res.json({ reply: result.content, model: result.model, latencyMs: result.latencyMs });
  }),
);

// ---------------------------------------------------------------------------
// document draft review (advisory only — never posts anything)
// ---------------------------------------------------------------------------

const suggestSchema = z.object({
  documentType: z.enum(['RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT']),
  draft: z.record(z.unknown()),
});

const DOC_TYPE_FA: Record<string, string> = {
  RECEIPT: 'رسید انبار',
  ISSUE: 'حواله انبار',
  TRANSFER: 'انتقال انبار',
  ADJUSTMENT: 'اصلاحیه انبار',
};

interface AiSuggestion {
  severity: 'error' | 'warning' | 'info';
  field: string | null;
  messageFa: string;
}

aiRouter.post(
  '/suggest/document',
  requirePermission('inventory.view'),
  h(async (req, res) => {
    const body = suggestSchema.parse(req.body ?? {});
    const draftJson = JSON.stringify(body.draft);
    if (draftJson.length > 20_000) {
      throw new ApiError(413, 'Draft too large for review', 'پیش‌نویس سند برای بازبینی بیش از حد بزرگ است', 'ai_draft_too_large');
    }

    const result = await chat(
      [
        { role: 'system', content: documentSuggestSystemPrompt(DOC_TYPE_FA[body.documentType] ?? 'انبار') },
        { role: 'user', content: draftJson },
      ],
      { temperature: 0.1, maxTokens: 1400 },
    );

    // best-effort structured parse — an unstructured reply is surfaced honestly
    let summaryFa: string | null = null;
    let suggestions: AiSuggestion[] = [];
    let structured = true;
    let raw: string = result.content;
    try {
      const obj = extractJsonObject(result.content) as Record<string, unknown>;
      if (typeof obj.summaryFa === 'string') summaryFa = obj.summaryFa.slice(0, 600);
      if (Array.isArray(obj.suggestions)) {
        suggestions = (obj.suggestions as Record<string, unknown>[])
          .filter((s) => typeof s.messageFa === 'string' && s.messageFa.trim() !== '')
          .slice(0, 12)
          .map((s) => ({
            severity: s.severity === 'error' || s.severity === 'warning' ? s.severity : 'info',
            field: typeof s.field === 'string' && s.field.trim() !== '' ? s.field : null,
            messageFa: String(s.messageFa).slice(0, 600),
          }));
      }
    } catch {
      structured = false;
    }

    await recordAudit(null, {
      userId: userId(req),
      action: 'AI_SUGGEST_DOCUMENT',
      entityType: 'ai',
      entityId: null,
      changes: { documentType: body.documentType, structured, suggestions: suggestions.length },
      ipAddress: req.ip ?? null,
    });

    res.json({
      structured,
      summaryFa,
      suggestions,
      noteFa: structured
        ? 'پیشنهادها فقط راهنما هستند؛ ثبت و قطع‌بوش سند همچنان با تأیید شما انجام می‌شود.'
        : 'پاسخ مدل ساختار JSON استاندارد نداشت؛ متن خام پاسخ نمایش داده می‌شود.',
      raw,
      model: result.model,
      latencyMs: result.latencyMs,
    });
  }),
);

// ---------------------------------------------------------------------------
// natural-language report query (runs the REAL report; AI only narrates)
// ---------------------------------------------------------------------------

const reportQuerySchema = z.object({
  question: z.string().trim().min(2).max(2000),
  contextFilters: z.record(z.string()).optional(),
});

aiRouter.post(
  '/report-query',
  requirePermission('reports.view'),
  h(async (req, res) => {
    const body = reportQuerySchema.parse(req.body ?? {});

    const allowedFiltersByKey: Record<string, string[]> = {};
    for (const r of REPORT_CATALOG) allowedFiltersByKey[r.key] = r.filters;
    const catalogJson = JSON.stringify(REPORT_CATALOG);
    const hints = await buildEntityHints();
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const todayJalali = toJalaliDateString(now, true);

    const mapping = await chat(
      [
        { role: 'system', content: reportQuerySystemPrompt(catalogJson, hints, todayIso, todayJalali) },
        { role: 'user', content: body.question },
      ],
      { temperature: 0, maxTokens: 700 },
    );

    const resolved = resolveReportQuery(mapping.content, allowedFiltersByKey, body.contextFilters ?? {});

    // re-validate filters through the shared zod schema (uuid/date formats)
    const parsedFilters = reportFiltersSchema.parse({ ...resolved.filters, format: 'json' }) as ReportFilters;
    const table: ReportTable = await runReportByKey(resolved.reportKey, parsedFilters);

    // AI narrates the REAL numbers only
    let aiSummary: string | null = null;
    try {
      const narration = await chat(
        [
          { role: 'system', content: reportSummarySystemPrompt() },
          {
            role: 'user',
            content: JSON.stringify({
              question: body.question,
              reportTitleFa: table.titleFa,
              explanationFa: resolved.explanationFa,
              notesFa: table.meta.notesFa,
              columns: table.columns.map((c) => ({ label: c.labelFa, kind: c.kind })),
              rows: table.rows.slice(0, 15),
              rowCount: table.rows.length,
            }),
          },
        ],
        { temperature: 0.2, maxTokens: 600 },
      );
      aiSummary = narration.content.trim().slice(0, 2000);
    } catch {
      aiSummary = null; // narration is optional — the real table is already there
    }

    await recordAudit(null, {
      userId: userId(req),
      action: 'AI_REPORT_QUERY',
      entityType: 'ai',
      entityId: null,
      changes: { questionLength: body.question.length, reportKey: resolved.reportKey, filters: resolved.filters },
      ipAddress: req.ip ?? null,
    });

    res.json({
      reportKey: resolved.reportKey,
      filters: resolved.filters,
      explanationFa: resolved.explanationFa,
      table,
      aiSummary,
      model: mapping.model,
      latencyMs: mapping.latencyMs,
    });
  }),
);
