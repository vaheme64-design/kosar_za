// KPIMS — deployment & AI options document (Persian RTL)
// Follows docx skill: cover recipe R1 (adapted for RTL), palette GO-1,
// 3-section architecture (cover / TOC roman / body arabic), TOC + refresh hint.
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Header, Footer,
  AlignmentType, HeadingLevel, PageNumber, BorderStyle, WidthType, ShadingType,
  TableLayoutType, SectionType, NumberFormat, TableOfContents, PageBreak, VerticalAlign,
} from 'docx';
import fs from 'node:fs';

// ---------- palette (GO-1 — Graphite Orange, proposals) ----------
const P = {
  bg: '1A2330', accent: 'D4875A',
  cover: { titleColor: 'FFFFFF', subtitleColor: 'B0B8C0', metaColor: '90989F', footerColor: '687078' },
  table: { headerBg: 'D4875A', headerText: 'FFFFFF', accentLine: 'D4875A', innerLine: 'DDD0C8', surface: 'F8F0EB' },
  primary: '1A2330', body: '2A2F38', secondary: '5A6068',
};
const FA_FONT = { ascii: 'Tahoma', hAnsi: 'Tahoma', cs: 'Tahoma', eastAsia: 'Tahoma' };

const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const allNoBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const cellNoBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE };

// ---------- helpers ----------
function fa(text, opts = {}) {
  return new TextRun({
    text,
    rightToLeft: true,
    font: FA_FONT,
    size: opts.size ?? 22,
    sizeComplexScript: opts.size ?? 22,
    bold: opts.bold ?? false,
    boldComplexScript: opts.bold ?? false,
    italics: opts.italics ?? false,
    color: opts.color ?? P.body,
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    bidirectional: true,
    alignment: AlignmentType.START,
    spacing: { before: 360, after: 160, line: 340, lineRule: 'atLeast' },
    children: [fa(text, { size: 30, bold: true, color: P.primary })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    bidirectional: true,
    alignment: AlignmentType.START,
    spacing: { before: 260, after: 120, line: 320, lineRule: 'atLeast' },
    children: [fa(text, { size: 25, bold: true, color: P.primary })],
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: opts.after ?? 120 },
    children: [fa(text, opts)],
  });
}

/** numbered body line (manual Persian numbering — no Word list numbering) */
function step(noFa, text) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: 100 },
    indent: { right: 240 },
    children: [fa(`${noFa} `, { bold: true, color: P.accent }), fa(text)],
  });
}

/** callout box: shaded paragraph with right accent border */
function callout(title, text) {
  return [
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.START,
      spacing: { before: 160, after: 40, line: 312 },
      shading: { type: ShadingType.CLEAR, fill: P.table.surface },
      border: { right: { style: BorderStyle.SINGLE, size: 24, color: P.accent, space: 8 } },
      indent: { right: 200, left: 200 },
      children: [fa(title, { bold: true, color: P.primary })],
    }),
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 160, line: 312 },
      shading: { type: ShadingType.CLEAR, fill: P.table.surface },
      border: { right: { style: BorderStyle.SINGLE, size: 24, color: P.accent, space: 8 } },
      indent: { right: 200, left: 200 },
      children: [fa(text, { size: 21 })],
    }),
  ];
}

/** RTL data table — header row + zebra surface rows, percentage widths */
function tbl(headers, rows, widths) {
  const mkCell = (content, { header = false, w, zebra = false } = {}) =>
    new TableCell({
      width: { size: w, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, fill: header ? P.table.headerBg : zebra ? P.table.surface : 'FFFFFF' },
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      verticalAlign: VerticalAlign.CENTER,
      children: [
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.START,
          spacing: { line: 280 },
          children: [fa(content, { size: header ? 21 : 20, bold: header, color: header ? P.table.headerText : P.body })],
        }),
      ],
    });
  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: P.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: P.table.accentLine },
      left: NONE, right: NONE,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: P.table.innerLine },
      insideVertical: NONE,
    },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((t, i) => mkCell(t, { header: true, w: widths[i] })) }),
      ...rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((t, i) => mkCell(t, { w: widths[i], zebra: ri % 2 === 1 })) })),
    ],
  });
}

function tableCaption(text) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.START,
    keepNext: true,
    spacing: { before: 160, after: 80 },
    children: [fa(text, { size: 20, bold: true, color: P.secondary })],
  });
}

const pageFooter = () =>
  new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: P.secondary, font: FA_FONT })],
      }),
    ],
  });

const pageHeader = () =>
  new Header({
    children: [
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.START,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: P.table.innerLine, space: 4 } },
        spacing: { after: 80 },
        children: [fa('KPIMS — راهکارهای استقرار و هوش مصنوعی', { size: 17, color: P.secondary })],
      }),
    ],
  });

// ---------- cover (R1 adapted to RTL — mandatory mechanics preserved) ----------
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([...'،؛:!؟', ...'-—–·/', ...' \t']);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) breakAt = charsPerLine;
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += ' ' + last;
  }
  return lines;
}

// Persian glyphs are narrower than CJK: char width ≈ pt × 12 twips (documented adaptation)
function calcTitleLayout(title, maxWidthTwips, preferredPt = 36, minPt = 24) {
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / (pt * 12));
  let titlePt = preferredPt;
  let lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    lines = splitTitleLines(title, charsPerLine(minPt));
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}

function calcCoverSpacing(params) {
  const {
    titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0,
  } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const safeRemaining = Math.max(usableHeight - contentHeight, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  return { topSpacing, midSpacing: Math.max(safeRemaining - topSpacing - bottomSpacing, 0), bottomSpacing };
}

function buildCoverR1RTL(config) {
  const C = config.palette;
  const padMain = 1200, padEdge = 800;
  const availableWidth = 11906 - padMain - padEdge - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 36, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentRight = { style: BorderStyle.SINGLE, size: 8, color: C.accent, space: 12 };
  const children = [];

  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));

  if (config.englishLabel) {
    children.push(new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.START,
      indent: { right: padMain, left: padEdge },
      spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split('').join(' '), size: 18, color: C.accent, font: FA_FONT, characterSpacing: 40 })],
    }));
  }

  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.START,
      indent: { right: padMain, left: padEdge },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: 'atLeast' },
      children: [fa(titleLines[i], { size: titleSize, bold: true, color: C.cover.titleColor })],
    }));
  }

  if (config.subtitle) {
    children.push(new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.START,
      indent: { right: padMain, left: padEdge },
      spacing: { after: 800, line: 400, lineRule: 'atLeast' },
      children: [fa(config.subtitle, { size: 24, color: C.cover.subtitleColor })],
    }));
  }

  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.START,
      indent: { right: padMain + 200, left: padEdge },
      spacing: { after: 80, line: 320, lineRule: 'atLeast' },
      border: { right: accentRight },
      children: [fa(line, { size: 24, color: C.cover.metaColor })],
    }));
  }

  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));

  children.push(new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.START,
    indent: { right: padMain, left: padEdge },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: C.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      fa(config.footerRight || '', { size: 16, color: C.cover.footerColor }),
      new TextRun({ text: '                                        ' }),
      fa(config.footerLeft || '', { size: 16, color: C.cover.footerColor }),
    ],
  }));

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: 'exact' },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: C.bg },
        borders: cellNoBorders,
        verticalAlign: VerticalAlign.TOP,
        children,
      })],
    })],
  })];
}

// ---------- content ----------
const coverConfig = {
  title: 'راهکارهای استقرار KPIMS روی رایانه کارخانه',
  subtitle: 'اتصال دستیار هوشمند رایگان و بدون فیلتر — پیشنهادها برای بررسی و تصمیم مشترک',
  englishLabel: 'KPIMS DEPLOYMENT AND AI',
  metaLines: [
    'سامانه برنامه‌ریزی تولید و مدیریت موجودی کوثر',
    'نسخه سند: ۱٫۰',
    'تاریخ: ۱۴۰۵/۰۸/۱۱',
  ],
  footerLeft: 'KPIMS',
  footerRight: 'سند داخلی پروژه — محرمانه',
  palette: P,
};

const bodyChildren = [];

// ==== ۱. خلاصه اجرایی ====
bodyChildren.push(h1('۱. خلاصه اجرایی'));
bodyChildren.push(body('این سند دو تصمیم فنی پیشِ روی پروژه KPIMS را برای بررسی مشترک آماده می‌کند: نخست، برنامه در کجا و چگونه روی رایانه کارخانه اجرا شود؛ دوم، کدام هوش مصنوعی به آن وصل شود. هر دو تصمیم به هم گره خورده‌اند، زیرا پیشنهاد اصلی این سند، اجرای مدل هوش مصنوعی روی همان سرورِ محلی برنامه است تا هم رایگان بماند، هم از داخل ایران بدون هیچ نگرانی فیلترینگ کار کند و هم داده‌های انبار و قراردادها هرگز از کارخانه خارج نشود.'));
bodyChildren.push(body('پیشنهاد فشرده این سند چنین است: یک دوره پایلوت دو هفته‌ای روی یک رایانه موجود (گزینه A) برای اعتبارسنجی داده‌های واقعی، و سپس استقرار قطعی روی یک سرور کوچک داخل کارخانه (گزینه B) با Docker و پشتیبان‌گیری خودکار. برای هوش مصنوعی، پیش‌فرض Ollama محلی با مدل qwen2.5:7b است؛ سوییچ به یک درگاه ایرانی سازگار با OpenAI در صورت تمایل، فقط با تغییر تنظیمات و بدون تغییر کد انجام می‌شود.'));
bodyChildren.push(body('همه پیش‌نیازهای نرم‌افزاری این تصمیم‌ها هم‌اکنون در KPIMS پیاده‌سازی و با آزمون خودکار تأیید شده است: لایه اتصال هوش مصنوعی با تنظیمات و آزمایش اتصال، پنل دستیار سراسری، بازبینی هوشمند پیش‌نویس سند، گزارش‌گیری با زبان طبیعی، و سناریوی کامل رول/کویل از قرارداد تا ردیابی مصرف. بنابراین آنچه مانده، purely تصمیم سخت‌افزاری و اجرایی است، نه توسعه جدید.'));

// ==== ۲. وضعیت امروز KPIMS ====
bodyChildren.push(h1('۲. وضعیت امروز KPIMS (پشتوانه فنی تصمیم)'));
bodyChildren.push(body('KPIMS در هفت فاز تکمیل شده است: اسکلت سامانه و پایه احراز هویت؛ طرح کامل دیتابیس با ۳۹ جدول؛ موتور انبار با دفتر کل تغییرناپذیر و ممنوعیت موجودی منفی؛ تولید و WIP با تساوی اجباری مقادیر و انتقال صریح بین عملیات؛ موتور برنامه‌ریزی با صلاحیت سخت ماشین‌آلات؛ پانزده گزارش مدیریتی فقط‌خواندنی با خروجی اکسل و تطبیق‌سنجی خودکار؛ و در تکمیل، CRUD کامل همه اطلاعات پایه، جستجوی سراسری (Ctrl+K) و ورود/خروجی اکسل در همه بخش‌ها.'));
bodyChildren.push(body('در همین واپسین به‌روزرسانی، سناریوی واقعی شما پیاده و آزمایش شد: سه رول می‌رسد و قرارداد ندارد — در همان فرم رسید، «قرارداد جدید (سریع)» ساخته می‌شود و رسید به آن گره می‌خورد؛ رول‌ها به انبار می‌روند با مالکیت امانی SAPCO؛ یکی از رول‌ها برای دو قطعه بیرون می‌آید و فقط وزنِ مصرف‌شده حواله می‌شود و باقی‌مانده رول به‌عنوان «رول ناقص» در انبار می‌ماند؛ دو قطعه با مرجع دستور کار در خط دیده می‌شوند و در داشبورد WIP معلوم است در کدام مرحله‌اند؛ و در انتها گزارش «موجودی رول‌ها» می‌گوید چند رول دارید و چند تا ناقص است و گزارش «ردیابی مصرف رول» می‌گوید هر رول برای چه قصدی، در چه تاریخی و با کدام سند مصرف شده است. اصلاح خطا هم فقط با سند ابطالی است.'));
bodyChildren.push(body('این رفتارها با ۱۱۷ آزمون خودکار پوشش داده شده‌اند و همه آزمون‌ها سبک هستند؛ یعنی موتور انبار و گزارش‌ها در برابر همین سناریو، عدد به عدد راستی‌آزمایی شده‌اند. نتیجه عملی: نرم‌افزار برای پایلوت روی سخت‌افزار واقعی آماده است و تصمیم باقی‌مانده، انتخاب محل اجرا و مدل هوش مصنوعی است.'));

// ==== ۳. هوش مصنوعی ====
bodyChildren.push(h1('۳. هوش مصنوعی رایگان و قابل استفاده از داخل ایران'));
bodyChildren.push(h2('۳.۱. معیارهای انتخاب'));
bodyChildren.push(body('چهار معیار، انتخاب را شکل می‌دهد: هزینه (رایگان یا حداقلی)؛ دسترس‌پذیری از IP ایران بدون تغییر IP؛ حریم داده (سفارش‌ها، قراردادها و موجودی نباید به سرور ناشناس برود)؛ و سادگی نگهداری توسط تیم داخلی. نکته مهم واقعیت محیطی است: بیشتر سرویس‌های خارجی معروف به دلیل تحریم‌ها، IP ایران را مسدود می‌کنند و استفاده از آن‌ها عملاً نیازمند تغییر IP است؛ بنابراین «رایگان بودن» آن‌ها در عمل بی‌معناست.'));
bodyChildren.push(tableCaption('جدول ۱ — مقایسه گزینه‌های هوش مصنوعی'));
bodyChildren.push(tbl(
  ['معیار', 'Ollama محلی (پیش‌فرض)', 'درگاه ایرانی سازگار OpenAI', 'سرویس‌های خارجی معروف'],
  [
    ['هزینه', 'کاملاً رایگان و متن‌باز', 'اعتبار رایگان محدود؛ سپس مصرفی ریالی', 'رایگان نیست یا قابل استفاده نیست'],
    ['دسترسی از ایران', 'کاملاً آفلاین — فیلترینگ بی‌معناست', 'دسترسی مستقیم داخل ایران', 'معمولاً IP ایران مسدود است'],
    ['حریم داده', 'داده هرگز از کارخانه خارج نمی‌شود', 'داده به سرور همان سرویس می‌رود', 'داده به سرورهای خارجی می‌رود'],
    ['نیاز سخت‌افزاری', 'رم ۸ گیگ برای مدل 7B (۱۶ گیگ توصیه‌شده)', 'هیچ', 'هیچ'],
    ['کیفیت فارسی', 'متوسط تا خوب (بسته به مدل)', 'خوب (مدل‌های بزرگ)', 'خوب، اما غیرقابل اتکا در دسترس'],
    ['نگهداری', 'نصب یک‌باره + دانلود مدل', 'مدیریت حساب و شارژ', 'مدیریت حساب + تغییر IP'],
  ],
  [16, 30, 28, 26],
));
bodyChildren.push(body('پیشنهاد: پیش‌فرض، Ollama محلی است — برنامه به آدرس داخلی 127.0.0.1:11434 وصل می‌شود و مدل روی همان سرور اجرا می‌شود؛ گزینه‌های مدلِ فارسی‌پسند و باز: qwen2.5:7b (پیش‌فرض)، gemma2:9b، llama3.1:8b و aya-expanse:8b. اگر بعداً کیفیت پاسخ‌ها رضایت‌بخش نبود، می‌توان بدون هیچ تغییر کدی، در صفحه تنظیمات، provider را به یک درگاه ایرانی سازگار با OpenAI (مانند AvalAI که طبق وب‌سایتش دسترسی داخلی و پرداخت ریالی دارد) تغییر داد — کافی است آدرس سرویس، نام مدل و کلید را وارد کنید. پیش از خرید هر بسته اعتباری، شرایط فعلی سرویس را مستقیم از سایت آن بررسی کنید.'));
bodyChildren.push(h2('۳.۲. آنچه در KPIMS پیاده شده است'));
bodyChildren.push(body('لایه هوش مصنوعی از ابتدا «مستقل از سرویس‌دهنده» طراحی شده است: هر سرویسی که رابط سازگار با OpenAI داشته باشد (Ollama به‌صورت پیش‌فرض همین رابط را می‌دهد) با تغییر تنظیمات وصل می‌شود. تنظیمات در مسیر «کاربران و تنظیمات ← هوش مصنوعی» است و دکمه «آزمایش اتصال» وضعیت واقعی سرویس را نشان می‌دهد؛ اگر سرویس در دسترس نباشد، سامانه صادقانه «قطع» را نمایش می‌دهد، نه وضعیت ساختگی.'));
bodyChildren.push(body('سه قابلیت روی این لایه سوار شده است: نخست، «پیشنهاد هوشمند» در فرم‌های رسید و حواله که پیش‌نویس سند را از نظر فیلدهای خالی، سازگاری وزن و مقدار، لوت و قرارداد بازبینی می‌کند؛ دوم، «دستیار سراسری» در همه صفحات برای پرسش و پاسخ درباره نحوه کار سامانه؛ و سوم، «گزارش هوشمند» که پرسش فارسی شما (مثلاً «چند رول ناقص دارم؟») را به یکی از گزارش‌های سامانه و فیلترهایش نگاشت می‌کند و همان گزارش واقعی را اجرا می‌کند.'));
bodyChildren.push(...callout('قواعد ایمنی دستیار هوشمند', 'دستیار هیچ‌گاه سندی ثبت یا قطع‌بوش نمی‌کند؛ خروجی آن همیشه با برچسب «صرفاً پیشنهاد» نمایش داده می‌شود. در «گزارش هوشمند» مدل فقط انتخاب گزارش و فیلتر را پیشنهاد می‌دهد و اعداد، همیشه از گزارش واقعی دیتابیس می‌آیند — گزارش یا فیلترِ نامعتبر از سوی مدل، رد می‌شود نه اینکه بی‌صدا نادیده گرفته شود. همه استفاده‌ها در لاگ حسابرسی ثبت می‌شود و کلید سرویس (در صورت استفاده از درگاه) به‌صورت مخفی ذخیره و در نمایش‌ها پوشانده می‌شود.'));

// ==== ۴. راهکارهای اجرا ====
bodyChildren.push(h1('۴. راهکارهای اجرای برنامه روی رایانه'));
bodyChildren.push(body('چهار راهکار عملی برای اجرای KPIMS در کارخانه وجود دارد. همه گزینه‌ها از یک کد مشترک استفاده می‌کنند و مهاجرت بین آن‌ها فقط انتقال پایگاه داده است؛ پس انتخاب اول لزوماً انتخاب آخر نیست.'));
bodyChildren.push(h2('۴.۱. گزینه A — یک رایانه (پایلوت تک‌کاربره)'));
bodyChildren.push(body('Node.js و PostgreSQL روی همان رایانه نصب می‌شود و برنامه هنگام روشن شدن سیستم به‌صورت خودکار بالا می‌آید (در ویندوز با NSSM یا Task Scheduler، در لینوکس با systemd). کاربران همان دستگاه را با مرورگر باز می‌کنند. این گزینه برای دوره آزمون دو هفته‌ای با یک یا دو کاربر عالی است، هزینه سخت‌افزاری ندارد و در چند ساعت راه می‌افتد. محدودیت‌ها: پایداری وابسته به همان رایانه است، هم‌زمانی بالاتر از دو سه کاربر راحت نیست و پشتیبان‌گیری باید دستی یا با اسکریپت ساده مدیریت شود.'));
bodyChildren.push(h2('۴.۲. گزینه B — سرور کوچک داخل کارخانه (پیشنهاد اصلی)'));
bodyChildren.push(body('یک مینی‌پی‌سی (مانند Intel NUC یا معادل ایرانی آن، رم ۱۶ گیگابایت و دیسک SSD) با سیستم‌عامل لینوکس، هر سه سرویس را با Docker Compose بالا می‌آورد: خود برنامه، PostgreSQL و Ollama. همه رایانه‌های دفتر، انبار و سالن با مرورگر به آدرس داخلی سرور وصل می‌شوند؛ پشتیبان‌گیری خودکار شبانه با pg_dump تنظیم می‌شود و مدل هوش مصنوعی روی همان دستگاه اجرا می‌شود. این گزینه پایداری ۲۴/۷، هزینه برق ناچیز و نگهداری کم دارد و برای ۵ تا ۲۰ کاربر هم‌زمان کافی است. هزینه اولیه فقط سخت‌افزار است و نرم‌افزار کاملاً رایگان می‌ماند.'));
bodyChildren.push(h2('۴.۳. گزینه C — NAS خانگی/اداری با Docker'));
bodyChildren.push(body('اگر از قبل NAS (مانند Synology) دارید، می‌توان KPIMS و PostgreSQL را همان‌جا با Docker اجرا کرد. مزیت، بی‌نیازی از سخت‌افزار جدید است؛ محدودیت، رم و پردازنده NAS است که معمولاً برای مدل‌های بزرگ هوش مصنوعی کافی نیست — در این حالت یا مدل کوچک‌تر ۳ میلیارد پارامتری را به کار می‌برید یا هوش مصنوعی را فعلاً غیرفعال می‌گذارید. برای کارخانه‌ای که اولویتش خودِ برنامه است و هوش مصنوعی مرحله دوم، گزینه‌ای منطقی است.'));
bodyChildren.push(h2('۴.۴. گزینه D — سرور ابری ایرانی'));
bodyChildren.push(body('سرور مجازی داخل ایران (مانند ابرآروان، پارس‌پک یا لیارا) برنامه را از بیرون کارخانه هم قابل دسترس می‌کند — برای مدیریت از خانه یا شعبه دوم. هزینه ماهانه دارد و داده روی زیرساخت شخص ثالث قرار می‌گیرد؛ برای یک کارگاه تک‌محله‌ای ضرورتی ندارد و اجرای مدل هوش مصنوعی روی سرور ابری بدون GPU هم کند است. پیشنهاد: این گزینه را به زمانی موکول کنید که دسترسی چندشعبه‌ای واقعاً لازم شود؛ همان‌وقت هم انتقال پایگاه داده سرراست است.'));
bodyChildren.push(tableCaption('جدول ۲ — مقایسه راهکارهای استقرار'));
bodyChildren.push(tbl(
  ['معیار', 'A: رایانه واحد', 'B: سرور کارخانه', 'C: NAS', 'D: ابر ایرانی'],
  [
    ['هزینه اولیه', 'تقریباً صفر', 'خرید مینی‌پی‌سی', 'اگر NAS دارید: صفر', 'بدون سخت‌افزار'],
    ['هزینه ماهانه', 'ندارد', 'برق (ناچیز)', 'برق (ناچیز)', 'اجاره ماهانه'],
    ['کاربر هم‌زمان', '۱ تا ۲', '۵ تا ۲۰', '۲ تا ۵', 'نامحدود'],
    ['اجرای مدل AI', 'امکان‌پذیر (رم کافی باشد)', 'روی همان سرور', 'محدود (مدل کوچک)', 'بدون GPU کند است'],
    ['پایداری ۲۴/۷', 'متوسط', 'خوب', 'خوب', 'بسیار خوب'],
    ['حریم داده', 'داخل کارخانه', 'داخل کارخانه', 'داخل کارخانه', 'روی زیرساخت ثالث'],
    ['پیچیدگی راه‌اندازی', 'کم', 'متوسط', 'متوسط', 'کم تا متوسط'],
  ],
  [20, 20, 20, 20, 20],
));
bodyChildren.push(...callout('توصیه', 'پایلوت دو هفته‌ای با گزینه A روی داده واقعی؛ در صورت تأیید خروجی‌ها (تطبیق موجودی رسمی با شمارش فیزیکی)، مهاجرت به گزینه B. چون هر دو گزینه با همان Docker Compose اجرا می‌شوند، مهاجرت فقط کپی پایگاه داده و تغییر آدرس است.'));

// ==== ۵. پشتیبان‌گیری و امنیت ====
bodyChildren.push(h1('۵. پشتیبان‌گیری، امنیت و نگهداری'));
bodyChildren.push(h2('۵.۱. پشتیبان‌گیری'));
bodyChildren.push(body('پایگاه داده، تنها دارایی حیاتی سامانه است. طرح پیشنهادی: پشتیبان کامل روزانه با pg_dump در ساعت کم‌ترافیک (مثلاً ساعت ۲ بامداد)، نگهداری چهارده نسخه آخر روی دیسک سرور و یک نسخه هفتگی روی دیسک خارجی جدا از سیستم، و یک بازیابی آزمایشی ماهانه تا مطمئن شوید نسخه‌های پشتیبان واقعاً باز می‌شوند. اسکریپت پشتیبان‌گیری به‌صورت یک وظیفه زمان‌بندی‌شده در همان سرور تنظیم می‌شود و لاگ موفقیت/شکست آن باید هفتگی بازبینی شود.'));
bodyChildren.push(h2('۵.۲. امنیت'));
bodyChildren.push(body('چهار اصل کافی است: نخست، در اولین راه‌اندازی واقعی، گذرواژه‌های نمونه (حساب‌های admin و planner و keeper) باید عوض شوند و JWT_SECRET به یک مقدار تصادفی حداقل ۳۲ نویسه‌ای تغییر کند. دوم، دسترسی به برنامه فقط از شبکه داخلی کارخانه باشد و پورت آن به اینترنت باز نشود؛ تا زمانی که دسترسی از بیرون لازم نشده، هیچ‌گونه باز کردن پورت توصیه نمی‌شود. سوم، هر کاربر کمترین نقش لازم را بگیرد — انباردار فقط انبار، برنامه‌ریز فقط برنامه‌ریزی و گزارش‌ها، و مدیریت کاربران و تنظیمات فقط با مدیر سامانه. چهارم، لاگ حسابرسی داخلی سامانه که هم‌اکنون همه رویدادهای حساس (ورود، قطع‌بوش سند، ابطال، استفاده از دستیار) را ثبت می‌کند، ماهانه مرور شود.'));
bodyChildren.push(h2('۵.۳. به‌روزرسانی'));
bodyChildren.push(body('هر نسخه جدید برنامه با چند ثانیه توقف سرویس جایگزین می‌شود؛ migrationهای پایگاه داده با فرمان استاندارد prisma migrate deploy اعمال می‌شوند و به همین دلیل، پیش از هر به‌روزرسانی باید یک نسخه پشتیبان کامل گرفته شود. توصیه می‌شود به‌روزرسانی‌ها در پایان هفته و بیرون از ساعت کاری انجام شود و پس از هر ارتقا، حداقل یک سند رسید و یک گزارش برای اطمینان بازبینی شود.'));

// ==== ۶. مسیر پیشنهادی اجرا ====
bodyChildren.push(h1('۶. مسیر پیشنهادی اجرا — گام به گام'));
bodyChildren.push(body('مسیر زیر طوری چیده شده که هر گام یک خروجی قابل بررسی داشته باشد و هیچ گامی به تصمیم بعدی وابسته به حدس نباشد:'));
bodyChildren.push(step('گام ۱.', 'بررسی و تأیید همین سند در جلسه مشترک؛ انتخاب گزینه استقرار (A تا D) و انتخاب مدل هوش مصنوعی اولیه. خروجی: تصمیم ثبت‌شده در همین سند.'));
bodyChildren.push(step('گام ۲.', 'آماده‌سازی رایانه گزینه A: نصب Node.js و PostgreSQL و اجرای خودکار برنامه؛ باز کردن برنامه از مرورگر روی همان دستگاه. خروجی: صفحه ورود KPIMS روی رایانه واقعی.'));
bodyChildren.push(step('گام ۳.', 'وارد کردن داده پایه واقعی از همان ورود اکسل: قطعات، مواد و کویل‌ها، انبارها و موقعیت‌ها، مشتریان و مسیرهای تولید. خروجی: اطلاعات پایه کامل و قابل جستجو.'));
bodyChildren.push(step('گام ۴.', 'نصب Ollama و دانلود مدل پیش‌فرض، و تنظیم و آزمایش اتصال در صفحه تنظیمات هوش مصنوعی. خروجی: نشانگر «متصل» با نام مدل و زمان پاسخ.'));
bodyChildren.push(step('گام ۵.', 'پایلوت دو هفته‌ای: ثبت اسناد رسید و حواله واقعی موازی با نظام فعلی کارخانه، همراه با دو یا سه کاربر کلیدی. خروجی: دفتر کل واقعی از اسناد روزهای پایلوت.'));
bodyChildren.push(step('گام ۶.', 'راستی‌آزمایی: شمارش فیزیکی چند رول و مقایسه با گزارش موجودی رول‌ها؛ مقایسه مصرف دوره با گزارش ردیابی مصرف. معیار پذیرش: تطبیق کامل اعداد گزارش با شمارش فیزیکی.'));
bodyChildren.push(step('گام ۷.', 'تصمیم استقرار قطعی روی گزینه B: خرید/تخصیص مینی‌پی‌سی، انتقال پایگاه داده، فعال‌سازی پشتیبان‌گیری خودکار شبانه و تعویض گذرواژه‌ها و JWT_SECRET. خروجی: سامانه رسمی کارخانه با پشتیبان خودکار.'));
bodyChildren.push(body('کل مسیر با فرض آماده بودن سخت‌افزار، دو تا سه هفته زمان می‌برد و هیچ مرحله‌ای به استقرار ابری یا اینترنت پایدار وابسته نیست.'));

// ==== ۷. پرسش‌های باز ====
bodyChildren.push(h1('۷. پرسش‌های باز برای تصمیم مشترک'));
bodyChildren.push(body('برای بستن تصمیم‌ها در جلسه بعدی، پاسخ این پرسش‌ها لازم است. پیشنهاد می‌کنم پیش از جلسه، پاسخ‌ها را کنار همین سند یادداشت کنید:'));
bodyChildren.push(step('۱.', 'رایانه‌ای که برای گزینه A در نظر دارید چه مشخصاتی دارد (ویندوز یا لینوکس، رم، دیسک) و آیا هم‌زمان برای کار دیگر استفاده می‌شود؟'));
bodyChildren.push(step('۲.', 'آیا خرید مینی‌پی‌سی برای گزینه B در بودجه هست؟ (این تنها هزینه اساسی مسیر پیشنهادی است.)'));
bodyChildren.push(step('۳.', 'هوش مصنوعی از روز اول فعال باشد یا بعد از پایلوت داده‌ها؟ (توصیه: از روز اول، چون فقط مصرف رم بیشتری می‌خواهد.)'));
bodyChildren.push(step('۴.', 'آیا دسترسی از بیرون کارخانه (مدیریت از خانه یا شعبه دیگر) لازم است؟ اگر بله، گزینه D یا یک راه‌اندازی امن دسترسی از راه دور بررسی می‌شود.'));
bodyChildren.push(step('۵.', 'چه کسی مسئول بازبینی هفتگی پشتیبان‌ها و لاگ حسابرسی باشد؟ (یک نفر مشخص، نه «همه».)'));
bodyChildren.push(step('۶.', 'کیفیت پاسخ‌های فارسی مدل ۷ میلیارد پارامتری پس از پایلوت رضایت‌بخش است یا درگاه ایرانی با مدل بزرگ‌تر امتحان شود؟'));
bodyChildren.push(body('با پاسخ این شش پرسش، برنامه استقرار نهایی را به‌صورت دستور کار دقیق (با زمان‌بندی و مسئول هر گام) تنظیم می‌کنم و اجرای گام ۲ را می‌توان همان هفته آغاز کرد.'));

// ---------- document ----------
const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: FA_FONT, size: 22, color: P.body },
        paragraph: { spacing: { line: 312 } },
      },
    },
  },
  features: { updateFields: true },
  sections: [
    { // Section 1: cover — margin 0, no footer/header
      properties: {
        page: { size: { width: 11906, height: 16838 }, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
      },
      children: buildCoverR1RTL(coverConfig),
    },
    { // Section 2: TOC — roman numerals
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, bottom: 1440, left: 1417, right: 1701 },
          pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN },
        },
      },
      headers: { default: pageHeader() },
      footers: { default: pageFooter() },
      children: [
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.CENTER,
          spacing: { before: 480, after: 360 },
          children: [fa('فهرست مطالب', { size: 32, bold: true, color: P.primary })],
        }),
        new TableOfContents('فهرست', { hyperlink: true, headingStyleRange: '1-2' }),
        new Paragraph({
          bidirectional: true,
          spacing: { before: 200 },
          children: [fa('توجه: این فهرست با کد فیلد ساخته می‌شود؛ پس از باز کردن سند در Word، برای به‌روزرسانی شماره صفحه‌ها روی فهرست راست‌کلیک کنید و «Update Field» را برگزینید.', { size: 18, italics: true, color: '888888' })],
        }),
        // NOTE: no trailing PageBreak here — section 3 starts with NEXT_PAGE;
        // adding both would create a blank page (postcheck rule).
      ],
    },
    { // Section 3: body — arabic numerals from 1
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, bottom: 1440, left: 1417, right: 1701 },
          pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
        },
      },
      headers: { default: pageHeader() },
      footers: { default: pageFooter() },
      children: bodyChildren,
    },
  ],
});

const OUT = '/home/z/my-project/download/KPIMS-استقرار-و-هوش-مصنوعی.docx';
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log('WROTE', OUT, buf.length, 'bytes');
});
