/**
 * KPIMS — Phase 7: AI assistant service.
 *
 * Provider-agnostic bridge to any OpenAI-compatible chat endpoint.
 * Primary target: a LOCAL Ollama server (default http://127.0.0.1:11434/v1) —
 * free, fully offline and immune to network filtering, which matters for
 * on-premise deployment inside Iran. Any other OpenAI-compatible endpoint
 * (e.g. an Iranian hosted gateway) can be plugged in via settings without
 * code changes.
 *
 * Honesty rules (same as the rest of KPIMS):
 *   • the AI never writes to the database — it only advises;
 *   • every figure shown to the user comes from real reports executed here;
 *   • status checks are real HTTP probes — "reachable" is never faked.
 */
import { db } from '../../config/db';
import { ApiError } from '../../lib/http';

export type AiProvider = 'ollama' | 'openai-compatible';

export interface AiConfig {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  temperature: number;
  timeoutMs: number;
  /** where the effective configuration came from (DB settings > env > defaults) */
  source: 'database' | 'environment' | 'defaults';
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = 'qwen2.5:7b';

const AI_SETTING_KEYS = [
  'ai.enabled',
  'ai.provider',
  'ai.baseUrl',
  'ai.model',
  'ai.apiKey',
  'ai.temperature',
  'ai.timeoutMs',
] as const;

async function loadAiSettings(): Promise<Map<string, string>> {
  const rows = await db.systemSetting.findMany({
    where: { key: { in: [...AI_SETTING_KEYS] } },
    select: { key: true, value: true },
  });
  return new Map(rows.map((r) => [r.key, r.value]));
}

export async function getAiConfig(): Promise<AiConfig> {
  const s = await loadAiSettings();
  const fromDb = (k: (typeof AI_SETTING_KEYS)[number]): string | undefined => {
    const v = s.get(k);
    return v !== undefined && v.trim() !== '' ? v.trim() : undefined;
  };

  let source: AiConfig['source'] = 'defaults';
  const pick = (dbKey: (typeof AI_SETTING_KEYS)[number], envKey: string, fallback: string): string => {
    const dbVal = fromDb(dbKey);
    if (dbVal !== undefined) {
      source = 'database';
      return dbVal;
    }
    const envVal = process.env[envKey];
    if (envVal !== undefined && envVal.trim() !== '') {
      source = 'environment';
      return envVal.trim();
    }
    return fallback;
  };

  const enabled = pick('ai.enabled', 'AI_ENABLED', 'true') === 'true';
  const provider = (pick('ai.provider', 'AI_PROVIDER', 'ollama') === 'openai-compatible'
    ? 'openai-compatible'
    : 'ollama') as AiProvider;
  const baseUrl = pick('ai.baseUrl', 'AI_BASE_URL', DEFAULT_BASE_URL);
  const model = pick('ai.model', 'AI_MODEL', DEFAULT_MODEL);
  const apiKey = pick('ai.apiKey', 'AI_API_KEY', '');
  const temperature = Number(pick('ai.temperature', 'AI_TEMPERATURE', '0.2'));
  const timeoutMs = Number(pick('ai.timeoutMs', 'AI_TIMEOUT_MS', '90000'));

  return {
    enabled,
    provider,
    baseUrl,
    model,
    apiKey: apiKey === '' ? null : apiKey,
    temperature: Number.isFinite(temperature) ? Math.min(1.5, Math.max(0, temperature)) : 0.2,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.min(300_000, Math.max(5_000, timeoutMs)) : 90_000,
    source,
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  content: string;
  model: string;
  latencyMs: number;
}

/** One chat completion against the configured OpenAI-compatible endpoint. */
export async function chat(
  messages: ChatMessage[],
  overrides?: { temperature?: number; maxTokens?: number },
): Promise<ChatResult> {
  const cfg = await getAiConfig();
  if (!cfg.enabled) {
    throw new ApiError(503, 'AI assistant is disabled', 'دستیار هوش مصنوعی غیرفعال است', 'ai_disabled');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: overrides?.temperature ?? cfg.temperature,
        stream: false,
        ...(overrides?.maxTokens ? { max_tokens: overrides.maxTokens } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      await res.text().catch(() => '');
      throw new ApiError(
        502,
        `AI provider responded with HTTP ${res.status}`,
        `سرویس هوش مصنوعی پاسخ معتبری نداد (کد ${res.status})`,
        'ai_provider_error',
      );
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new ApiError(502, 'Empty AI response', 'پاسخ خالی از سرویس هوش مصنوعی', 'ai_empty_response');
    }
    return { content, model: cfg.model, latencyMs: Date.now() - started };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      503,
      'AI service unreachable',
      'سرویس هوش مصنوعی در دسترس نیست — اجرای مدل و آدرس سرویس را در تنظیمات بررسی کنید',
      'ai_unreachable',
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface AiStatus {
  enabled: boolean;
  configured: boolean;
  provider: AiProvider;
  model: string;
  baseUrl: string;
  source: AiConfig['source'];
  reachable: boolean;
  latencyMs: number | null;
  errorFa: string | null;
  /** models advertised by the endpoint (real probe of /models) */
  models: string[];
}

/** Real reachability probe — never fakes success. */
export async function checkAiStatus(): Promise<AiStatus> {
  const cfg = await getAiConfig();
  const base = {
    enabled: cfg.enabled,
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    source: cfg.source,
  };

  if (!cfg.enabled) {
    return {
      ...base,
      configured: false,
      reachable: false,
      latencyMs: null,
      errorFa: 'دستیار هوش مصنوعی غیرفعال است (تنظیم ai.enabled)',
      models: [],
    };
  }

  const started = Date.now();
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/models`, {
      method: 'GET',
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : undefined,
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      return {
        ...base,
        configured: true,
        reachable: false,
        latencyMs: null,
        errorFa: `سرویس پاسخ داد اما کد وضعیت ${res.status} برگرداند`,
        models: [],
      };
    }
    const json = (await res.json()) as { data?: { id?: string }[] };
    const models = (json.data ?? [])
      .map((m) => (typeof m.id === 'string' ? m.id : ''))
      .filter((v) => v !== '')
      .sort()
      .slice(0, 50);
    return {
      ...base,
      configured: true,
      reachable: true,
      latencyMs: Date.now() - started,
      errorFa: null,
      models,
    };
  } catch {
    return {
      ...base,
      configured: true,
      reachable: false,
      latencyMs: null,
      errorFa: 'اتصال به سرویس برقرار نشد — اگر Ollama محلی است، بررسی کنید که اجرا باشد: `ollama serve` و سپس `ollama pull <model>`',
      models: [],
    };
  }
}

// ---------------------------------------------------------------------------
// strict-JSON extraction (small local models often wrap JSON in prose/fences)
// ---------------------------------------------------------------------------

/** Extract the first JSON object embedded in a model reply (fences tolerated). */
export function extractJsonObject(text: string): unknown {
  let t = text.trim();
  // strip markdown code fences if present
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) t = fence[1].trim();

  const start = t.indexOf('{');
  if (start === -1) {
    throw new ApiError(502, 'AI output has no JSON object', 'پاسخ مدل هوش مصنوعی قابل تفسیر نبود', 'ai_bad_output');
  }
  // find the matching closing brace, aware of string literals
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const slice = t.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          throw new ApiError(502, 'AI output is not valid JSON', 'پاسخ مدل هوش مصنوعی JSON معتبر نبود', 'ai_bad_output');
        }
      }
    }
  }
  throw new ApiError(502, 'AI output JSON is incomplete', 'پاسخ ناقص از مدل هوش مصنوعی', 'ai_bad_output');
}

// ---------------------------------------------------------------------------
// natural-language → report query (whitelist-guarded, executed on real data)
// ---------------------------------------------------------------------------

export interface ResolvedReportQuery {
  reportKey: string;
  filters: Record<string, string>;
  explanationFa: string;
}

/**
 * Validate an LLM "which report + filters" answer against the real catalog.
 * Unknown report keys and unknown filter keys are REJECTED (never silently
 * dropped) so a hallucinated query can never return misleading numbers.
 */
export function resolveReportQuery(
  rawLlmOutput: string,
  allowedFiltersByKey: Record<string, string[]>,
  contextFilters: Record<string, string> = {},
): ResolvedReportQuery {
  const obj = extractJsonObject(rawLlmOutput) as Record<string, unknown>;
  const reportKey = typeof obj.reportKey === 'string' ? obj.reportKey.trim() : '';
  if (reportKey === '' || !(reportKey in allowedFiltersByKey)) {
    throw new ApiError(
      422,
      `AI proposed unknown report key: ${reportKey || '(empty)'}`,
      'مدل هوش مصنوعی گزارش نامعتبری پیشنهاد داد؛ لطفاً سؤال را واضح‌تر بپرسید',
      'ai_bad_report_key',
    );
  }

  const rawFilters = (obj.filters ?? {}) as Record<string, unknown>;
  const allowed = allowedFiltersByKey[reportKey]!;
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawFilters)) {
    if (v === null || v === undefined) continue;
    if (!allowed.includes(k)) {
      throw new ApiError(
        422,
        `AI proposed unknown filter "${k}" for report ${reportKey}`,
        `مدل فیلتر ناشناختهٔ «${k}» را برای این گزارش پیشنهاد داد؛ لطفاً سؤال را بازنویسی کنید`,
        'ai_bad_filter',
      );
    }
    if (typeof v === 'string' && v.trim() !== '') filters[k] = v.trim();
    else if (typeof v === 'number') filters[k] = String(v);
  }

  // page context (real UUIDs picked by the user in the UI) wins over AI guesses
  for (const [k, v] of Object.entries(contextFilters)) {
    if (allowed.includes(k) && typeof v === 'string' && v.trim() !== '') filters[k] = v.trim();
  }

  const explanationFa =
    typeof obj.explanationFa === 'string' && obj.explanationFa.trim() !== ''
      ? obj.explanationFa.trim().slice(0, 1500)
      : 'بدون توضیح از مدل';

  return { reportKey, filters, explanationFa };
}

/** Compact real entity lists so the model can map Persian names to UUIDs. */
export async function buildEntityHints(): Promise<string> {
  const [materials, parts, warehouses, machines] = await Promise.all([
    db.material.findMany({
      select: { id: true, materialCode: true, nameFa: true, materialType: true },
      orderBy: { materialCode: 'asc' },
      take: 80,
    }),
    db.part.findMany({
      select: { id: true, partNumber: true, nameFa: true },
      orderBy: { partNumber: 'asc' },
      take: 80,
    }),
    db.warehouse.findMany({ select: { id: true, code: true, nameFa: true }, orderBy: { code: 'asc' }, take: 40 }),
    db.machine.findMany({ select: { id: true, code: true, nameFa: true }, orderBy: { code: 'asc' }, take: 40 }),
  ]);
  return JSON.stringify({ materials, parts, warehouses, machines });
}
