import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, FileSearch, ExternalLink, Send, Sparkles, X } from 'lucide-react';
import {
  aiAssistant,
  aiReportQuery,
  getAiStatus,
  type AiChatMessage,
  type AiReportQueryResponse,
  type AiStatus,
} from '../../lib/ai';
import { faNumber } from '../../lib/jalali';
import { Button, Loading, TextInput } from '../ui';

/**
 * Global floating AI assistant panel (mounted once inside AppLayout).
 * - «گفتگو با دستیار»: general Persian Q&A, keeps the last 8 messages as history
 * - «گزارش هوشمند»: natural-language question → the REAL whitelisted report runs
 *   on the backend and the AI only narrates it
 *
 * Every AI answer is clearly labelled «پاسخ دستیار هوشمند — صرفاً پیشنهاد» so it
 * can never be confused with system data. Setup guidance is shown honestly when
 * the assistant is disabled or unreachable.
 */
const REPORT_QUESTION_PLACEHOLDER = 'مثلاً: «چند رول ناقص دارم؟» یا «مصرف ورق ماه گذشته در مقابل سرانه چقدر بود؟»';

export function AIAssistantPanel() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'chat' | 'report'>('chat');

  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  // chat state
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [lastLatency, setLastLatency] = useState<number | null>(null);

  // report-query state
  const [question, setQuestion] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportResult, setReportResult] = useState<AiReportQueryResponse | null>(null);

  const msgsEndRef = useRef<HTMLDivElement | null>(null);

  const loadStatus = () => {
    setStatusLoading(true);
    setStatusError(null);
    getAiStatus()
      .then(setStatus)
      .catch((err) => setStatusError(err instanceof Error ? err.message : 'خطا در بررسی وضعیت دستیار'))
      .finally(() => setStatusLoading(false));
  };

  // probe the real status every time the panel opens
  useEffect(() => {
    if (open) loadStatus();
  }, [open]);

  // keep the latest message in view
  useEffect(() => {
    if (open && tab === 'chat') msgsEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, open, tab]);

  const aiUsable = Boolean(status && status.enabled && status.reachable);

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    setChatBusy(true);
    setChatError(null);
    // only the last 8 messages are kept as history
    const history = messages.slice(-8);
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setChatInput('');
    try {
      const res = await aiAssistant(text, history);
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply }]);
      setLastLatency(res.latencyMs);
    } catch (err) {
      const fa = (err as { messageFa?: string }).messageFa;
      setChatError(fa ?? (err instanceof Error ? err.message : 'ارسال پیام ناموفق بود'));
    } finally {
      setChatBusy(false);
    }
  };

  const askReport = async () => {
    const q = question.trim();
    if (q.length < 2 || reportBusy) return;
    setReportBusy(true);
    setReportError(null);
    setReportResult(null);
    try {
      setReportResult(await aiReportQuery(q));
    } catch (err) {
      const fa = (err as { messageFa?: string }).messageFa;
      setReportError(fa ?? (err instanceof Error ? err.message : 'پرسش گزارش ناموفق بود'));
    } finally {
      setReportBusy(false);
    }
  };

  const cellDisplay = (value: unknown): string => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'بله' : 'خیر';
    if (typeof value === 'object') return '—';
    return String(value);
  };

  if (!open) {
    return (
      <button className="ai-fab" onClick={() => setOpen(true)} aria-label="باز کردن دستیار هوشمند" type="button">
        <Sparkles size={20} />
        <span>دستیار هوشمند</span>
      </button>
    );
  }

  return (
    <section className="ai-panel" role="dialog" aria-label="دستیار هوشمند KPIMS">
      <div className="ai-panel__head">
        <div className="ai-panel__title">
          <Sparkles size={16} aria-hidden />
          <span>دستیار هوشمند KPIMS</span>
        </div>
        <button className="ai-panel__close" onClick={() => setOpen(false)} aria-label="بستن دستیار" type="button">
          <X size={16} />
        </button>
      </div>

      <div className="ai-panel__tabs" role="tablist">
        <button
          className={`ai-panel__tab${tab === 'chat' ? ' is-active' : ''}`}
          onClick={() => setTab('chat')}
          role="tab"
          aria-selected={tab === 'chat'}
          type="button"
        >
          <Bot size={14} /> گفتگو با دستیار
        </button>
        <button
          className={`ai-panel__tab${tab === 'report' ? ' is-active' : ''}`}
          onClick={() => setTab('report')}
          role="tab"
          aria-selected={tab === 'report'}
          type="button"
        >
          <FileSearch size={14} /> گزارش هوشمند
        </button>
      </div>

      <div className="ai-panel__body">
        {statusLoading && <Loading label="در حال بررسی وضعیت دستیار…" />}
        {statusError && (
          <div className="ai-warn">
            <div>{statusError}</div>
            <button className="link-btn" onClick={loadStatus} type="button">تلاش مجدد</button>
          </div>
        )}

        {!statusLoading && status && !aiUsable && (
          <div className="ai-warn">
            <b>دستیار هوشمند فعال نیست</b>
            <div>{status.errorFa ?? 'اتصال به مدل برقرار نشد'}</div>
            <div className="ai-warn__meta" dir="ltr">
              {status.provider} · {status.baseUrl} · {status.model}
            </div>
            <div>برای راه‌اندازی محلی (رایگان و بدون نیاز به اینترنت) به صفحه تنظیمات بروید.</div>
            <div className="ai-warn__actions">
              <Button variant="ghost" onClick={() => navigate('/settings/ai')} type="button">
                تنظیمات هوش مصنوعی
              </Button>
              <button className="link-btn" onClick={loadStatus} type="button">بررسی مجدد</button>
            </div>
          </div>
        )}

        {!statusLoading && status && aiUsable && (
          <div className="ai-status-strip">
            <span className="ai-status-strip__dot" aria-hidden />
            متصل — مدل: <b dir="ltr">{status.model}</b>
            {status.provider === 'ollama' && ' (محلی/Ollama)'}
            {status.latencyMs != null && <> · {faNumber(status.latencyMs)} ms</>}
            {lastLatency != null && tab === 'chat' && <> · آخرین پاسخ: {faNumber(lastLatency)} ms</>}
          </div>
        )}

        {/* ------------------------------------------------ chat tab */}
        {!statusLoading && status && aiUsable && tab === 'chat' && (
          <>
            <div className="ai-msgs">
              {messages.length === 0 && (
                <div className="ai-msgs__empty">
                  سؤالی درباره KPIMS بپرسید؛ مثلاً «لوت‌های امانی SAPCO چی هستند؟» یا «قطع‌بوش سند یعنی چه؟»
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`ai-msg ai-msg--${m.role}`}>
                  {m.role === 'assistant' && <div className="ai-answer-label">پاسخ دستیار هوشمند — صرفاً پیشنهاد</div>}
                  <div className="ai-msg__bubble">{m.content}</div>
                </div>
              ))}
              {chatBusy && <Loading label="دستیار در حال نوشتن…" />}
              <div ref={msgsEndRef} />
            </div>
            {chatError && <div className="alert alert--error">{chatError}</div>}
            <div className="ai-input">
              <TextInput
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendChat();
                  }
                }}
                placeholder="پیام خود را بنویسید…"
                aria-label="پیام به دستیار هوشمند"
                disabled={chatBusy}
              />
              <Button onClick={() => void sendChat()} disabled={chatBusy || chatInput.trim().length === 0} type="button" aria-label="ارسال پیام">
                <Send size={15} />
              </Button>
            </div>
          </>
        )}

        {/* ------------------------------------------------ report tab */}
        {!statusLoading && status && aiUsable && tab === 'report' && (
          <div className="ai-report">
            <textarea
              className="input ai-report__question"
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={REPORT_QUESTION_PLACEHOLDER}
              aria-label="پرسش گزارش به زبان طبیعی"
            />
            <Button onClick={() => void askReport()} disabled={reportBusy || question.trim().length < 2} type="button">
              <FileSearch size={15} /> {reportBusy ? 'در حال اجرای گزارش…' : 'پرسش از گزارش‌ها'}
            </Button>
            <p className="ai-report__hint">
              پرسش شما به یکی از گزارش‌های واقعی سامانه نگاشت می‌شود؛ اعداد همیشه از گزارش رسمی خوانده می‌شوند و دستیار فقط آن را روایت می‌کند.
            </p>

            {reportError && <div className="alert alert--error">{reportError}</div>}

            {reportResult && (
              <div className="ai-report__result">
                <div className="ai-answer-label">پاسخ دستیار هوشمند — صرفاً پیشنهاد</div>
                <div className="ai-note">{reportResult.explanationFa}</div>

                {reportResult.aiSummary && (
                  <div className="ai-report__summary">
                    <b>خلاصه دستیار</b>
                    <p>{reportResult.aiSummary}</p>
                  </div>
                )}

                {reportResult.table.rows.length === 0 ? (
                  <div className="empty">
                    <div className="empty__title">داده‌ای یافت نشد</div>
                    <div className="empty__hint">فیلترهای نگاشت‌شده نتیجه‌ای نداشتند</div>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table className="table table--dense">
                      <thead>
                        <tr>
                          {reportResult.table.columns.map((c) => (
                            <th key={c.key}>{c.labelFa}{c.unit ? ` (${c.unit})` : ''}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {reportResult.table.rows.map((row, i) => (
                          <tr key={i}>
                            {reportResult.table.columns.map((c) => (
                              <td key={c.key}>{cellDisplay(row[c.key])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="ai-report__meta muted">
                  جدول از گزارش نگاشت‌شده «{reportResult.table.titleFa}» خوانده شد · {reportResult.table.meta.generatedAtFa}
                </div>

                {reportResult.table.meta.notesFa.length > 0 && (
                  <ul className="report-notes">
                    {reportResult.table.meta.notesFa.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}

                <button className="link-btn" onClick={() => navigate(`/reports/${reportResult.reportKey}`)} type="button">
                  <ExternalLink size={13} /> نمایش کامل در صفحه گزارش‌ها
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
