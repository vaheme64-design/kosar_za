import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { aiSuggestDocument, type AiDocumentType, type AiSuggestResponse } from '../../lib/ai';
import { Button, ErrorBanner } from '../ui';

/**
 * «پیشنهاد هوشمند» box used inside the inventory document forms.
 * Sends the CURRENT form draft to /ai/suggest/document and renders the
 * suggestions color-coded by severity. Advisory only — nothing is posted.
 */
export function AiSuggestBox({ documentType, buildDraft }: { documentType: AiDocumentType; buildDraft: () => object }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiSuggestResponse | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await aiSuggestDocument(documentType, buildDraft()));
    } catch (err) {
      const fa = (err as { messageFa?: string }).messageFa;
      setError(fa ?? (err instanceof Error ? err.message : 'دستیار هوشمند در دسترس نیست'));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-suggest">
      <div className="ai-suggest__bar">
        <Button variant="ghost" onClick={() => void run()} disabled={busy} type="button">
          <Sparkles size={15} /> {busy ? 'در حال بازبینی…' : 'پیشنهاد هوشمند'}
        </Button>
        <span className="ai-suggest__hint">بازبینی پیش‌نویس سند با هوش مصنوعی — صرفاً پیشنهاد، بدون ثبت هیچ داده‌ای</span>
      </div>

      <ErrorBanner message={error} />

      {result && (
        <div className="ai-suggest__result">
          <div className="ai-answer-label">پاسخ دستیار هوشمند — صرفاً پیشنهاد{result.model ? ` · مدل: ${result.model}` : ''}</div>
          {result.summaryFa && <div className="ai-suggest__summary">{result.summaryFa}</div>}
          {result.suggestions.length > 0 ? (
            <ul className="ai-suggestions">
              {result.suggestions.map((s, i) => (
                <li key={i} className={`ai-suggestion ai-suggestion--${s.severity}`}>
                  {s.field && <b className="ai-suggestion__field">{s.field}: </b>}
                  <span>{s.messageFa}</span>
                </li>
              ))}
            </ul>
          ) : (
            result.structured && <div className="ai-suggest__ok">پیشنهاد مشخصی برای این پیش‌نویس ثبت نشد.</div>
          )}
          {!result.structured && <pre className="ai-raw" dir="auto">{result.raw}</pre>}
          <div className="ai-note">{result.noteFa}</div>
        </div>
      )}
    </div>
  );
}
