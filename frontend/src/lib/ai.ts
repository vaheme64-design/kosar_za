import { api } from './api';

/**
 * Typed wrappers for the AI assistant endpoints (Phase 7).
 * All endpoints are advisory / read-only — the AI never posts documents
 * and can only surface data the caller is allowed to see.
 */

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export type AiProvider = 'ollama' | 'openai-compatible';
export type AiConfigSource = 'database' | 'environment' | 'defaults';

export interface AiStatus {
  enabled: boolean;
  configured: boolean;
  provider: AiProvider;
  model: string;
  baseUrl: string;
  source: AiConfigSource;
  reachable: boolean;
  latencyMs: number | null;
  errorFa: string | null;
  models: string[];
}

export function getAiStatus(): Promise<AiStatus> {
  return api<AiStatus>('/ai/status');
}

// ---------------------------------------------------------------------------
// general assistant
// ---------------------------------------------------------------------------

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiAssistantResponse {
  reply: string;
  model: string;
  latencyMs: number;
}

export function aiAssistant(message: string, history?: AiChatMessage[]): Promise<AiAssistantResponse> {
  return api<AiAssistantResponse>('/ai/assistant', {
    method: 'POST',
    body: { message, ...(history && history.length > 0 ? { history } : {}) },
  });
}

// ---------------------------------------------------------------------------
// document draft review (advisory — never posts)
// ---------------------------------------------------------------------------

export type AiDocumentType = 'RECEIPT' | 'ISSUE' | 'TRANSFER' | 'ADJUSTMENT';

export interface AiSuggestion {
  severity: 'error' | 'warning' | 'info';
  field: string | null;
  messageFa: string;
}

export interface AiSuggestResponse {
  structured: boolean;
  summaryFa: string | null;
  suggestions: AiSuggestion[];
  noteFa: string;
  raw: string;
  model: string;
  latencyMs: number;
}

export function aiSuggestDocument(documentType: AiDocumentType, draft: object): Promise<AiSuggestResponse> {
  return api<AiSuggestResponse>('/ai/suggest/document', {
    method: 'POST',
    body: { documentType, draft },
  });
}

// ---------------------------------------------------------------------------
// natural-language report query (runs the REAL report; AI only narrates)
// ---------------------------------------------------------------------------

export type AiReportValueKind = 'IDENTIFIER' | 'ACTUAL' | 'PLANNED' | 'STANDARD' | 'ESTIMATED' | 'INFO';

export interface AiReportColumn {
  key: string;
  labelFa: string;
  kind: AiReportValueKind;
  unit?: string | null;
}

export interface AiReportTable {
  key: string;
  titleFa: string;
  columns: AiReportColumn[];
  rows: Record<string, unknown>[];
  meta: {
    generatedAtFa: string;
    notesFa: string[];
    filters: Record<string, string>;
  };
}

export interface AiReportQueryResponse {
  reportKey: string;
  filters: Record<string, string>;
  explanationFa: string;
  table: AiReportTable;
  aiSummary: string | null;
  model: string;
  latencyMs: number;
}

export function aiReportQuery(question: string, contextFilters?: Record<string, string>): Promise<AiReportQueryResponse> {
  return api<AiReportQueryResponse>('/ai/report-query', {
    method: 'POST',
    body: { question, ...(contextFilters && Object.keys(contextFilters).length > 0 ? { contextFilters } : {}) },
  });
}
