// KPIMS — Phase 9 design document (Persian RTL)
// Follows docx skill: cover recipe R1 (adapted for RTL — same proven mechanics
// as gen-deploy-doc.mjs), palette GO-1, 3-section architecture (cover / TOC
// roman / body arabic), TOC + refresh hint.
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Header, Footer,
  AlignmentType, HeadingLevel, PageNumber, BorderStyle, WidthType, ShadingType,
  TableLayoutType, SectionType, NumberFormat, TableOfContents, VerticalAlign,
} from 'docx';
import fs from 'node:fs';

// ---------- palette (GO-1 — Graphite Orange, same family as previous KPIMS doc) ----------
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
        children: [fa('KPIMS — طراحی فاز ۹: BOM پیشرفته و تولید موازی', { size: 17, color: P.secondary })],
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

// ---------- cover config ----------
const coverConfig = {
  title: 'طراحی فاز ۹ — BOM پیشرفته چندسطحی و تولید موازی قطعات',
  subtitle: 'خط مصرف چندمؤلفه‌ای، شاخه‌های شکست و اتصال در مسیر تولید، قطعه جفتی چپ و راست، سری تولید و لیبل ردیابی، جستجوی سریع محصول — سند طراحی برای تأیید مشترک',
  englishLabel: 'KPIMS PHASE 9 DESIGN',
  metaLines: [
    'سامانه برنامه‌ریزی تولید و مدیریت موجودی کوثر',
    'نسخه سند: ۱٫۰ — پیش‌نویس طراحی برای تأیید',
    'تاریخ: ۱۴۰۵/۰۸/۱۲',
  ],
  footerLeft: 'KPIMS',
  footerRight: 'سند داخلی پروژه — محرمانه',
  palette: P,
};

// ---------- content ----------
const bodyChildren = [];

// ==== ۱. خلاصه اجرایی ====
bodyChildren.push(h1('۱. خلاصه اجرایی'));
bodyChildren.push(body('این سند پاسخ طراحی KPIMS به چهار کمبودی است که مطرح کردید: نخست، BOM قطعاتی مانند ضد سرقت که از چند ورق — حتی دو نوع ورق متفاوت — ساخته می‌شود و ورق‌ها وسط مسیر به هم جوش می‌خورند و هر مؤلفه دستور تولید جداگانه می‌خواهد، افزون بر قطعاتی که پیچ و مهره مصرف می‌کنند؛ دوم، منطق تولید موازی برای قطعات چپ و راست که در یک قالب و تا مرحله آخر با هم تولید و سپس جدا می‌شوند، و برای ورق‌هایی که وسط مسیر به دو نیم‌ساخت شکسته می‌شوند، روی هر شاخه چند مرحله کار می‌شود و در پایان دوباره به هم جوش می‌خورند؛ سوم، کد شناسایی برای هر سری تولید به‌همراه لیبل قابل چاپ بر اساس مشخصات قطعه و مرحله؛ و چهارم، پیدا کردن سریع محصول در صفحه مسیرهای تولید.'));
bodyChildren.push(body('رویکرد طراحی، توسعه روی همان زیرساخت‌های آزموده‌شده فازهای قبل است: دفتر کل تغییرناپذیر انبار، انتقال صریح کمیت بین عملیات، تساوی اجباری ورودی و خروجی‌ها در گزارش تولید، و موتور MRP و رزرو ضدتخصیص مضاعف فاز ۸. هیچ مکانیزم موازی با این اصول ساخته نمی‌شود؛ یعنی حتی در مسیرهای شاخه‌ای هم هیچ کمیدی بدون سند صریح جابه‌جا نمی‌شود و همه سدها با کد خطای مشخص و آزمون خودکار محافظت می‌شوند.'));
bodyChildren.push(body('تصمیم‌های کلیدی طراحی در یک نگاه: (۱) خطوط BOM دو نوع می‌شوند — خط ماده و خط مؤلفه — و پیچ و مهره به‌صورت ماده از نوع مصرفی تعریف می‌شود تا همه زیرساخت قرارداد و لوت و MRP بی‌درنگ کار کند؛ (۲) مسیر تولید سه نوع گام جدید می‌گیرد: شاخه، گام شکست و گام اتصال، بدون شکستن هیچ مسیر موجودی؛ (۳) برای چپ و راستِ یک قالب، یک قطعه مجازیِ جفتی تعریف می‌شود که مسیر مشترک را حمل می‌کند و در پایان به دو محصول واقعی جداشده تبدیل می‌شود و هرگز انبار نمی‌شود؛ (۴) به‌جای سریال تک‌تک قطعات، «سری تولید» با کد یکتا و لیبل چاپی معرفی می‌شود — با ساختاری آماده برای ارتقای بعدی به سریال واحد؛ و (۵) صفحه مسیرها به‌پیش‌فرض فقط نسخه فعال هر قطعه را نشان می‌دهد و با انتخاب‌گر قطعه و فیلتر عملیات، رسیدن به محصول در چند ثانیه انجام می‌شود.'));
bodyChildren.push(body('اجرای این طراحی در سه زیرفاز پیشنهاد شده است: فاز ۹a برای BOM پیشرفته، فاز ۹b برای تولید موازی و فاز ۹c برای سری و لیبل و بهبود جستجو. هر زیرفاز با مجموعه آزمون خودکار خود — از جمله بازسازی عددی هر سه سناریوی واقعی کارخانه — پذیرش می‌شود و هیچ ادعای تولیدی‌بودن بدون سبزشدن کامل آن آزمون‌ها و آزمون‌های ۱۲۸گانه فعلی مطرح نمی‌شود. این سند، سند طراحی است؛ پیاده‌سازی پس از تأیید شما آغاز می‌شود.'));

// ==== ۲. وضعیت موجود و شکاف‌ها ====
bodyChildren.push(h1('۲. وضعیت موجود سامانه و شکاف‌ها'));
bodyChildren.push(body('در وضعیت فعلی، BOM تک‌سطحی است: جدول سرانه مصرف فقط ماده خام می‌گیرد — یک ردیف برای هر (قطعه، ماده) با مقدار و وزن در هر عدد. این مدل ورودی موتور برنامه‌ریزی، گزارش مصرف در مقابل سرانه و بررسی مواد پیش از حواله فاز ۸ است و برای قطعه‌هایی که فقط یک ورق مصرف می‌کنند کاملاً کار می‌کند؛ اما مؤلفه‌ای به‌معنای زیرقطعه‌ای که خودش مسیر و دستور کار دارد ندارد، نمی‌تواند بگوید هر ورق در کدام مرحله مصرف می‌شود و برای پیچ و مهره هم باید دستی در توضیحات نوشته شود.'));
bodyChildren.push(body('مسیر تولید هم خطی است: مراحل یک‌به‌یک پشت هم با شماره ترتیب، WIP به‌تفکیک هر عملیات، و جابه‌جایی کمیت فقط با گزارش تولید و سند انتقال صریح. این طراحی سخت‌گیرانه باعث شده اعداد تولید همیشه سازگار بمانند، اما برای سه وضعیت شما جواب ندارد: چپ و راستِ یک قالب که تا آخر با هم‌اند؛ ورقی که وسط مسیر دو تکه می‌شود و هر تکه مسیر خودش را می‌رود؛ و دوباره پیوستن شاخه‌ها در یک عملیات جوش. امروز تنها راه، تعریف قطعات جدا و ثبت دستی بیرون از سامانه است که ردیابی و سازگاری مقادیر را می‌شکند.'));
bodyChildren.push(body('در حوزه شناسایی، سامانه فقط لوت ماده اولیه دارد (ردیابی ورق و رول دریافتی) و برای تولید هیچ کد سری یا لیبلی صادر نمی‌شود. در جستجوی مسیرها هم جستجوی متنی وجود دارد و شماره و نام قطعه را می‌گردد، اما صفحه به‌پیش‌فرض همه نسخه‌های همه قطعات را کنار هم می‌چیند و راه میان‌بری از صفحه قطعات به مسیر آن قطعه نیست؛ نتیجه همان تجربه‌ای است که گفتید: برای رسیدن به محصول خودتان باید زیاد بگردید.'));
bodyChildren.push(tableCaption('جدول ۱ — چهار نیاز در برابر وضعیت موجود'));
bodyChildren.push(tbl(
  ['نیاز شما', 'وضعیت امروز', 'پاسخ طراحی'],
  [
    ['BOM چند ورقی و چند نوع ورقه با جوش وسط مسیر', 'BOM تک‌سطحی؛ فقط ماده خام؛ بدون ترتیب مصرف', 'خط BOM از نوع مؤلفه + مرحله مصرف + انفجار چندسطحی در MRP'],
    ['دستور تولید جداگانه برای هر مؤلفه', 'هر قطعه مسیر و MO خودش را دارد، اما ارتباط BOM بین آن‌ها نیست', 'خط مؤلفه، نیاز کودک را در MRP و بررسی پیش از حواله می‌آورد'],
    ['پیچ و مهره در BOM', 'جای تعریف ندارد', 'ماده از نوع مصرفی + خط BOM با مرحله مصرف مونتاژ'],
    ['چپ/راست یک قالب، شکاف و اتصال وسط مسیر', 'مسیر فقط خطی؛ چنین ساختاری مدل نمی‌شود', 'شاخه + گام شکست + گام اتصال روی همان مسیر نسخه‌بندی‌شده'],
    ['کد شناسایی سری تولید و لیبل مرحله‌ای', 'فقط لوت ماده اولیه؛ بدون لیبل تولید', 'سری تولید با کد یکتا، اتصال به گزارش/انتقال و لیبل چاپی'],
    ['پیدا کردن سریع محصول در مسیرها', 'جستجوی متنی ساده روی فهرست شلوغ همه نسخه‌ها', 'پیش‌فرض نسخه فعال، انتخاب‌گر قطعه، فیلتر عملیات و میان‌بر از صفحه قطعات'],
  ],
  [30, 33, 37],
));
// ==== ۳. ماژول A — مدل BOM پیشرفته چندسطحی ====
bodyChildren.push(h1('۳. ماژول A — مدل BOM پیشرفته چندسطحی'));
bodyChildren.push(h2('۳.۱. تصمیم ساختاری: ارتقای همان جدول، نه جدول موازی'));
bodyChildren.push(body('سرانه مصرف امروز روی جدول part_material_requirements نشسته و پنج گزارش و موتور MRP از آن تغذیه می‌شوند. به همین دلیل به‌جای ساخت جدول دوم، همان جدول با چند ستون جدید به «خط BOM» ارتقا پیدا می‌کند: ستون نوع خط که ماده یا مؤلفه بودن را مشخص می‌کند، ستون قطعه مؤلفه برای خطوطی که زیرقطعه‌ای با مسیر و BOM خودش را مصرف می‌کنند، ستون مرحله مصرف که می‌گوید این خط در کدام مرحله از مسیر والد مصرف می‌شود، و ضریب خرج اختیاری. رکوردهای فعلی همه به‌صورت خط ماده مهاجرت می‌کنند و هیچ مقداری عوض نمی‌شود؛ بنابراین گزارش‌های فاز ۵ و بررسی پیش از حواله بی‌درنگ و بدون تغییر رفتار کار می‌کنند.'));
bodyChildren.push(tableCaption('جدول ۲ — ستون‌های جدید خط BOM (روی همان جدول part_material_requirements)'));
bodyChildren.push(tbl(
  ['ستون', 'نوع', 'معنا و قاعده'],
  [
    ['lineType', 'enum: MATERIAL یا COMPONENT', 'نوع خط؛ پیش‌فرض MATERIAL تا رکوردهای موجود دست‌نخورده بمانند'],
    ['componentPartId', 'UUID اختیاری — کلید خارجی قطعه', 'فقط در خط COMPONENT؛ زیرقطعه‌ای که خودش مسیر و BOM دارد'],
    ['materialId', 'UUID اختیاری (موجود)', 'فقط در خط MATERIAL؛ قاعده: در هر خط دقیقاً یکی از ماده یا مؤلفه پر باشد (قید CHECK)'],
    ['consumeAtSequence', 'عدد صحیح اختیاری', 'شماره مرحله مسیر والد که خط در آن مصرف می‌شود؛ پیش‌فرض مرحله اول؛ برای پیچ و مهره معمولاً مرحله مونتاژ'],
    ['scrapFactorPct', 'درصد — پیش‌فرض صفر', 'ضریب خرج اختیاری خط (مثلاً پیچ اضافه برای تست)؛ در انفجار MRP اعمال می‌شود'],
  ],
  [22, 26, 52],
));
bodyChildren.push(body('کلید یکتای فعلی (قطعه، ماده) با دو ایندکس یکتای جزئی جایگزین می‌شود: برای خطوط ماده، ترکیب (قطعه، ماده) یکتاست و برای خطوط مؤلفه، ترکیب (قطعه، مؤلفه). به این ترتیب همان ورق با مقدار دو برگ فقط یک خط با مقدار ۲ می‌شود و دو نوع ورق متفاوت دو خط جدا می‌گیرند — دقیقاً وضعیت ضد سرقت شما. ممنوعیت حلقه در لایه سرویس اعمال می‌شود: هنگام ذخیره خط مؤلفه، از والد تا برگ‌ها پیمایش می‌شود و اگر قطعه در اجدادش دیده شود یا عمق از ده فراتر رود، ذخیره با خطای bom_cycle رد می‌شود.'));
bodyChildren.push(h2('۳.۲. پیچ و مهره: ماده مصرفی، نه قطعه جدید'));
bodyChildren.push(body('برای پیچ و مهره دو راه وجود داشت: تعریف آن‌ها به‌صورت قطعه خریداری، یا ماده از نوع مصرفی. طراحی دوم انتخاب شده است، به این دلایل: تمام زیرساخت ماده — قرارداد تأمین، لوت، مالکیت مالی/امانی، رزرو و ATP، ماتریس حساب تأمین‌کننده و کسری با پوشش قرارداد — بدون یک خط کد جدید برای ماده مصرفی کار می‌کند؛ در حالی که قطعه خریداری یعنی ساختن مفهوم «خرید» برای قطعات که در KPIMS اصلاً وجود ندارد و رسید قطعه امروز فقط مسیر تولید دارد. بنابراین پیچ M8 و مهره، ماده‌ای با نوع مصرفی و واحد عدد تعریف می‌شود و در BOM با خط ماده و مرحله مصرف مونتاژ می‌آید. در MRP و گزارش‌ها هم نوع مصرفی به‌صراحت نمایش داده می‌شود تا با ورق اشتباه نشود.'));
bodyChildren.push(h2('۳.۳. مثال: BOM قطعه ضد سرقت'));
bodyChildren.push(tableCaption('جدول ۳ — نمونه خطوط BOM برای ضد سرقت (دو ورق + مؤلفه جوشی + پیچ و مهره)'));
bodyChildren.push(tbl(
  ['خط', 'نوع', 'مؤلفه/ماده', 'مقدار در هر عدد', 'مرحله مصرف'],
  [
    ['۱', 'ماده', 'ورق ST12 ضخامت ۲ — گرید A', '۱ برگ', '۱ — خالی‌بری'],
    ['۲', 'ماده', 'ورق ST12 ضخامت ۳ — گرید B', '۱ برگ', '۱ — خالی‌بری'],
    ['۳', 'مؤلفه', 'پایه جوشی نیم‌ساخت (مسیر و BOM خودش)', '۱ عدد', '۴ — جوش پرس'],
    ['۴', 'ماده', 'پیچ M8 (مصرفی)', '۴ عدد', '۶ — مونتاژ'],
    ['۵', 'ماده', 'مهره M8 (مصرفی)', '۴ عدد', '۶ — مونتاژ'],
  ],
  [8, 12, 46, 16, 18],
));
bodyChildren.push(body('نکته مهم این مدل انعطاف در منشأ ورق‌هاست: اگر ورق‌ها خام از انبار می‌آیند و فقط در جوش پرس به هم می‌رسند، خط‌های ۱ و ۲ ماده می‌مانند؛ اما اگر هر ورق خودش چند مرحله برش و فرم دارد، همان ورق به قطعه نیم‌ساخت با مسیر خودش تبدیل می‌شود و خط آن به‌صورت مؤلفه ثبت می‌گردد. در هر دو حال، دستور تولید مؤلفه‌ها از MRP یا مستقیم در ماژول تولید صادر می‌شود و موجودی آن‌ها در انبار می‌نشیند تا دستور کار والد در مرحله جوش مصرفشان کند — همین چرخه‌ای که خواستید: هر مؤلفه دستور جداگانه، والد مونتاژکننده.'));
bodyChildren.push(h2('۳.۴. مهاجرت و قواعد حفاظتی'));
bodyChildren.push(body('مهاجرت در یک اسکریپت SQL قابل بازبینی انجام می‌شود: مقداردهی خط = ماده برای همه رکوردهای موجود، ساخت دو ایندکس جزئی، حذف کلید یکتای قدیمی پس از ساخت ایندکس جدید، و افزودن قید CHECK. پیش از اجرا پشتیبان کامل گرفته می‌شود. دو قاعده حفاظتی هم در سرویس اضافه می‌شود: قطعه‌ای که خط BOM دارد با حذف کامل ردیف‌هایش مانع نمی‌شود (حذف خط آزاد است) اما خط والدِ دارای مصرفِ قطعی‌شده فقط با سند ابطال اصلاح می‌شود — یعنی تغییر BOM اثر آینده‌نگر دارد و گزارش تطبیق سرانه همیشه سرانه‌ای را مقایسه می‌کند که در لحظه گزارش معتبر بوده است؛ برای نسخه‌بندی تاریخی BOM در صورت نیاز بعدی، ساختار آماده است.'));

// ==== ۴. اثر BOM پیشرفته بر MRP و بررسی پیش از حواله ====
bodyChildren.push(h1('۴. اثر BOM پیشرفته بر MRP و بررسی پیش از حواله'));
bodyChildren.push(h2('۴.۱. انفجار بازگشتی با تقصیر (netting) هر سطح'));
bodyChildren.push(body('موتور MRP فاز ۸ تک‌سطحی منفجر می‌کند: نیاز قطعه × سرانه = نیاز ماده. نسخه جدید همان انفجار را بازگشتی می‌کند و در هر سطح، مثل سطح محصول، تقصیر می‌زند: نیاز ناخالص مؤلفه = نیاز ساخت والد × مقدار در هر عدد؛ نیاز خالص مؤلفه = نیاز ناخالص − (موجودی قطعی مؤلفه − رزروهای فعال − تعهد دستور کارهای باز خود مؤلفه − WIP مؤلفه). اگر بعد از تقصیر نیاز ساخت باقی بماند، MRP به‌جای سکوت، آن را به‌عنوان «پیشنهاد دستور کار زیرمونتاژ» با مقدار پیشنهادی نشان می‌دهد — باز هم فقط‌خواندنی؛ هیچ سندی خودکار ساخته نمی‌شود — و انفجار با همان نیاز خالص در سطح بعدی ادامه می‌یابد تا به مواد برسد. عمق پیمایش حداکثر ده و تشخیص حلقه همان سازوکار سرویس BOM است.'));
bodyChildren.push(body('خروجی صفحه MRP سه بخش شفاف می‌شود: نیاز مواد (مجموعِ به‌ریشه‌رسیده، شامل پیچ و مهره با برچسب نوع مصرفی)، نیاز ساخت زیرمونتاژ (به‌تفکیک قطعه کودک با نیاز ناخالص، موجودی، WIP، تعهد و پیشنهاد MO)، و همان بخش کسری با پوشش قرارداد که امروز دارید. بررسی مواد پیش از حواله (checkMoMaterials) هم دو لایه می‌شود: برای خطوط ماده همان محاسبه فعلی، و برای خطوط مؤلفه: نیاز = سرانه × مقدار دستور کار، مصرف‌شده = حواله‌های قطعه مؤلفه با مرجع همین دستور کار، و آزاد = موجودی قطعی مؤلفه − رزرو دیگران. کسری مؤلفه پیام روشنی می‌گیرد: «نیاز به دستور کار زیرمونتاژ» — چون مؤلفه با قرارداد خرید جور نمی‌شود، با تولید جور می‌شود.'));
bodyChildren.push(h2('۴.۲. رابط کاربری BOM'));
bodyChildren.push(body('صفحه BOM از فهرست خطی به نمای درختی برای یک قطعه تبدیل می‌شود: انتخاب قطعه با جستجوی هم‌زمان روی کد و نام، نمایش درخت چندسطحی با باز و بسته شدن هر گره، و در هر ردیف نوع خط، مقدار، وزن، مرحله مصرف و ضریب خرج. ویرایش هر خط در پنجره جدا انجام می‌شود و دکمه «کجا مصرف شده؟» (where-used) برعکس می‌پرسد: این ماده یا این زیرمونتاژ در کدام قطعه‌ها خط BOM دارند — پاسخش برای برنامه‌ریزی خرید و اثر تغییر گرید ورق حیاتی است. از جستجوی سراسری Ctrl+K هم می‌شود مستقیم به درخت BOM یک قطعه رسید.'));
bodyChildren.push(tableCaption('جدول ۴ — آزمون‌های پذیرش فاز ۹a'));
bodyChildren.push(tbl(
  ['آزمون', 'نتیجه مورد انتظار'],
  [
    ['BOM دو سطحی ضد سرقت (دو ورق + مؤلفه + پیچ)', 'ذخیره کامل خطوط؛ قیود یکتا خطای تکراری را رد می‌کند'],
    ['انفجار MRP با نیاز ۱۰۰ عدد والد', 'نیاز ماده = ۱۰۰×سرانه هر ورق؛ پیشنهاد MO مؤلفه بعد از تقصیر با موجودی و WIP کودک'],
    ['ثبت حلقه BOM (قطعه‌ای که در اجدادش است)', 'خطای ۴۲۲ با کد bom_cycle'],
    ['بررسی پیش از حواله دستور کار والد', 'ردیف‌های ماده و مؤلفه با مقدار درست؛ کسری مؤلفه با پیام نیاز به دستور کار زیرمونتاژ'],
    ['سازگاری با گزارش مصرف در مقابل سرانه', 'جمع مواد BOM جدید دقیقاً برابر خروجی مدل قبلی برای داده مهاجرت‌شده'],
    ['مهاجرت رکوردهای موجود', 'همه ردیف‌ها خط ماده با همان مقدار؛ هیچ ردیفی از دست نمی‌رود'],
  ],
  [46, 54],
));

// ==== ۵. ماژول B — منطق تولید موازی: شاخه، شکست و اتصال ====
bodyChildren.push(h1('۵. ماژول B — منطق تولید موازی: شاخه، شکست و اتصال'));
bodyChildren.push(h2('۵.۱. چرا «دستور کار جدا برای هر نیم‌قطعه» کافی نیست'));
bodyChildren.push(body('قبل از انتخاب مدل، گزینه ساده‌تر بررسی شد: هر نیم‌قطعه قطعه‌ای مستقل با مسیر خودش و دو دستور کار جدا. این مدل برای «بعد از جداسازی» کار می‌کند، اما هسته مشکل شما را حل نمی‌کند: در قالب مشترک، هر سیکل قالب هم‌زمان یک چپ و یک راست می‌دهد و مقدار دو دستور کار به‌صورت ذاتی گره‌خورده است؛ اگر دو MO جدا بزنید، نصف‌شدن سیکل‌ها، ضایعات مشترک قالب و مونتاژ دوباره در جوش، در هیچ‌کدام از دو MO درست ثبت نمی‌شود و داشبورد WIP تصویر درستی از «وسط مسیر» نمی‌دهد. پس مدل باید «هم‌تولیدی» را یک‌پارچه مدل کند.'));
bodyChildren.push(h2('۵.۲. مدل داده: شاخه، گام شکست، گام اتصال'));
bodyChildren.push(body('سه مفهوم به مسیر نسخه‌بندی‌شده موجود اضافه می‌شود و هیچ‌کدام مسیرهای فعلی را نمی‌شکنند، چون همه مقادیر پیش‌فرض دارند: هر گام مسیر یک کلید شاخه می‌گیرد که پیش‌فرضش شاخه اصلی است؛ دو نوع گام جدید تعریف می‌شود — گام شکست (مثلاً برش وسط یا جداسازی قالب) و گام اتصال (مثل جوش پرس که دو شاخه را به هم می‌رساند) — و جدول کوچکی به نام شاخه‌های مسیر، هر شاخه را با برچسب فارسی، قطعه خروجی اختیاری و ضریب تشکیل معرفی می‌کند.'));
bodyChildren.push(tableCaption('جدول ۵ — اجزای جدید مدل تولید موازی'));
bodyChildren.push(tbl(
  ['جزء', 'محل', 'معنا'],
  [
    ['RouteBranch', 'جدول جدید route_branches', 'هر شاخه: کلید (مثل L و R)، برچسب فارسی (چپ/راست)، قطعه خروجی اختیاری، ضریب تشکیل (پیش‌فرض ۱)'],
    ['stepKind', 'ستون جدید گام و عملیات اجرایی', 'STANDARD / SPLIT / JOIN — پیش‌فرض STANDARD برای همه مسیرهای موجود'],
    ['branchKey', 'ستون جدید گام و عملیات اجرایی', 'شاخه‌ای که گام به آن تعلق دارد؛ پیش‌فرض MAIN'],
    ['joinSources', 'ستون گام اتصال', 'فهرست شاخه‌های مبدأ اتصال، مثل L و R؛ در نسخه اول حداکثر یک شکست و یک اتصال در هر نسخه مسیر مجاز است'],
    ['شاخه در انتقال', 'ستون‌های جدید سند انتقال', 'شاخه مبدأ و شاخه مقصد؛ و امکان انتقال به نام قطعه خروجی شاخه'],
  ],
  [20, 30, 50],
));
bodyChildren.push(h2('۵.۳. مکانیک اجرا گام به گام'));
bodyChildren.push(body('تا گام شکست، همه چیز مثل امروز است: تغذیه از انبار یا عملیات قبل، گزارش تولید با تساوی اجباری، انتقال صریح. از لحظه شکست قواعد جدید وارد می‌شود و مهم است که هیچ‌کدام کمیت را بی‌سند جابه‌جا نمی‌کنند:'));
bodyChildren.push(step('۱.', 'گام شکست یک عملیات عادی از نظر گزارش است؛ ورودی و تولید و ضایعاتش با همان تساوی اجباری ثبت می‌شود. تولیدِ این گام بر حسب «سیکل» است — هر سیکل قالب، به تعداد ضریب هر شاخه، قطعه در آن شاخه می‌سازد.'));
bodyChildren.push(step('۲.', 'خروج گام شکست با سند انتقال به مقصد هر شاخه است: مقدار سند بر حسب واحد مبدأ (سیکل) است و در مقصد به ضریب همان شاخه ضرب می‌شود؛ جمع انتقال‌ها هرگز از تولید گام شکست بیشتر نمی‌شود — همان سد آماده‌به‌انتقال امروز. اگر شاخه قطعه خروجی دارد، سند به نام همان قطعه ثبت می‌شود و از این نقطه به بعد همه گزارش‌ها و موجودی آن شاخه به آن قطعه تعلق می‌گیرد.'));
bodyChildren.push(step('۳.', 'هر شاخه از این به بعد مسیر مستقل خودش را می‌رود: گزارش تولید، ضایعات، مردود و بازکار به‌تفکیک همان شاخه و اگر قطعه خروجی داشته باشد به نام همان قطعه.'));
bodyChildren.push(step('۴.', 'گام اتصال دو شاخه را می‌گیرد: سد تغذیه آن، مقدار تغذیه را به کوچک‌ترین «آماده هر شاخه مبدأ» محدود می‌کند — یعنی با شاخه‌های نامتوازن نمی‌شود جفت جعل کرد. درون گزارش اتصال همان تساوی اجباری برقرار است.'));
bodyChildren.push(step('۵.', 'پایان شاخه‌های بدون اتصال، انتقال از آخرین عملیات شاخه به انبار محصول است؛ اگر شاخه قطعه خروجی دارد، رسید تولید به نام همان قطعه صادر می‌شود. قطعه والد اگر مجازی باشد در هیچ حالتی رسید انبار نمی‌گیرد و سد صریح دارد.'));
bodyChildren.push(tableCaption('جدول ۶ — قواعد سخت اجرای موازی و کد خطاها'));
bodyChildren.push(tbl(
  ['قاعده', 'کد خطا', 'اثر'],
  [
    ['انتقال از گام شکست بیش از تولیدش', 'not_ready_for_transfer (موجود)', 'همان سد امروز؛ جمع خروجی شاخه‌ها ≤ تولید شکست'],
    ['تغذیه گام اتصال بیش از کوچک‌ترین آماده شاخه‌ها', 'join_unbalanced_feed', 'جفت‌سازی صادقانه؛ با شاخه ناتمام نمی‌شود ورودی ساخت'],
    ['مقصد انتقال در شاخه‌ای غیر از شاخه مبدأ (به‌جز شکست)', 'branch_mismatch', 'کمیت از شاخه‌ای به شاخه دیگر بی‌سند نمی‌پرد'],
    ['قطعه سند انتقال ≠ قطعه خروجی شاخه مبدأ', 'branch_part_mismatch', 'رسید و WIP همیشه به قطعه درست تعلق می‌گیرد'],
    ['رسید انبار برای قطعه مجازی', 'virtual_part_not_stockable', 'قطعه جفتی هرگز موجودی نمی‌شود'],
    ['تکمیل MO جفتی با شاخه ناتمام', 'mo_terminal_incomplete', 'هر شاخه پایانی باید تا مقدار دستور برسد'],
    ['بیش از یک شکست یا اتصال در نسخه مسیر', 'route_multiple_splits', 'پیچیدگی نسخه اول کنترل می‌شود؛ تعمیم بعداً'],
  ],
  [44, 26, 30],
));
bodyChildren.push(h2('۵.۴. قاعده تکمیل دستور کار موازی'));
bodyChildren.push(body('امروز تکمیل MO یعنی تولید عملیات آخر به مقدار دستور. در مسیر شاخه‌ای، مجموعه «پایان‌ها» تعریف می‌شود: اگر مسیر با اتصال تمام شود، همان عملیات آخرِ بعد از اتصال معیار است و رفتار امروز برقرار است؛ اگر شاخه‌های پایانیِ دارای قطعه خروجی وجود داشته باشد، شرط تکمیل این است که تولید آخرین عملیات هر شاخه پایانی به مقدار دستور ضرب‌در ضریب همان شاخه رسیده باشد. مثال: دستور کار جفتی ۱۰۰ سیکل یعنی انتظار حداقل ۱۰۰ چپ و حداقل ۱۰۰ راست؛ تا یکی نرسد، دستور کار کامل نمی‌شود و پیام دقیقاً می‌گوید کدام شاخه چند کم دارد. مسیرهای تک‌شاخه موجود دقیقاً با همین قاعده به رفتار امروز برمی‌گردند.'));

// ==== ۶. نگاشت سه سناریوی کارخانه با مثال عددی ====
bodyChildren.push(h1('۶. نگاشت سه سناریوی کارخانه با مثال عددی'));
bodyChildren.push(h2('۶.۱. سناریو ۱ — چپ و راست در یک قالب، جداسازی در مرحله آخر'));
bodyChildren.push(body('یک قطعه مجازی جفتی تعریف می‌شود (مثلاً «ضد سرقت چپ+راست») و دو محصول واقعی «ضد سرقت چپ» و «ضد سرقت راست». مسیر قطعه مجازی: خالی‌بری با قالب مشترک، پرس و فرم با قالب مشترک، و گام شکستِ جداسازی در آخر. جدول شاخه‌ها دو ردیف دارد: شاخه L با قطعه خروجی چپ و شاخه R با قطعه خروجی راست — و اگر بعد از جداسازی، رنگ یا مونتاژ پیچ جداگانه هم لازم باشد، همان عملیات‌ها به‌عنوان گام‌های شاخه اضافه می‌شوند و پایان هر شاخه به انبار محصول می‌رود. BOM قطعه مجازی همان ورق‌هاست و BOM چپ و راست خالی می‌ماند، چون آن‌ها ساخته نمی‌شوند؛ از والد جدا می‌شوند.'));
bodyChildren.push(body('جریان عددی با دستور کار ۱۰۰ سیکل: تغذیه ۱۰۲ ورق برای جبران ضایعات، خالی‌بری و فرم با ضایعات ۲ عدد، گام جداسازی تولید ۱۰۰ سیکل را اعلام می‌کند؛ دو سند انتقال ۱۰۰ عددی ثبت می‌شود — یکی به شاخه چپ و یکی به شاخه راست — و مقصدش یا انبار محصول به نام هر قطعه است یا عملیات شاخه. شرط تکمیل: تولید پایانی هر دو شاخه به ۱۰۰ رسیده باشد. در این مدل، «یک سیکل قالب = یک چپ + یک راست» در همان سند شکست ثبت شده است، نه در ذهن اپراتور.'));
bodyChildren.push(h2('۶.۲. سناریو ۲ — ورق، شکست وسط مسیر، دو نیم‌ساخت، اتصال در پایان'));
bodyChildren.push(body('محصول نهایی یک قطعه واحد است (مثلاً تقویت‌کننده‌ای که دو لبه‌اش جدا کار می‌شود و در جوش پرس دوباره به هم می‌رسند). مسیر: برش، فرم اولیه، گام شکست (برش وسط)، سپس دو شاخه بدون قطعه خروجی — چون هر دو شاخه هنوز همان محصول‌اند، فقط در دو شاخه — با هر چند گام لازم روی هر شاخه (مثلاً خم و آماده‌سازی لبه)، سپس گام اتصال (جوش پرس) با مبدأ دو شاخه، و در پایان رنگ و کنترل در شاخه اصلی. WIP هر شاخه جدا دیده می‌شود و داشبورد نشان می‌دهد مثلاً شاخه راست عقب است.'));
bodyChildren.push(body('جریان عددی: ۱۰۰ ورق وارد گام شکست می‌شود، تولید ۹۸ با دو ضایعه؛ انتقال ۹۸ به هر دو شاخه؛ شاخه چپ ۹۷ تولید می‌کند (یک ضایعه) و ۹۷ به اتصال می‌فرستد؛ شاخه راست ۹۶ تولید می‌کند و ۹۶ می‌فرستد؛ سد اتصال تغذیه را حداکثر ۹۶ می‌بندد (کوچک‌ترین آماده)؛ اتصال ۹۵ تولید می‌کند با یک ضایعه؛ نتیجه: ۹۵ محصول تکمیلی از ۱۰۰ ورق و ۵ ضایعه به‌تفکیک هر مرحله — سازگاری کل با جمع صریح.'));
bodyChildren.push(h2('۶.۳. سناریو ۳ — ورق وسط مسیر به چپ و راست تبدیل می‌شود و هر شاخه مراحل خودش را دارد'));
bodyChildren.push(body('این حالت ترکیبی از دو مورد قبل است: مسیر تا گام شکست مشترک است و بعد از آن هر شاخه قطعه خروجی خودش (چپ/راست) و چند گام ادامه دارد، بدون اتصال. تفاوتش با سناریو ۱ فقط جای شکست در مسیر است — وسط به‌جای آخر — و مکانیک دقیقاً همان است: انتقال به نام قطعه شاخه، گزارش شاخه‌ای، و تکمیل MO وقتی هر دو شاخه به مقدار رسیدند. جدول زیر سه سناریو را کنار هم می‌گذارد.'));
bodyChildren.push(tableCaption('جدول ۷ — نگاشت سه سناریو به مدل'));
bodyChildren.push(tbl(
  ['سناریو', 'ساختار مسیر', 'شاخه‌ها', 'شرط تکمیل MO'],
  [
    ['۱ — چپ/راست یک قالب، جدا در آخر', 'خالی‌بری ← فرم (قالب مشترک) ← شکستِ جداسازی', 'L و R با قطعه خروجی؛ بدون اتصال', 'تولید پایانی چپ ≥ مقدار و راست ≥ مقدار'],
    ['۲ — شکست وسط، دو نیم‌ساخت، اتصال آخر', 'برش ← فرم ← شکست ← گام‌های هر شاخه ← اتصال ← رنگ', 'L و R بدون قطعه خروجی؛ با اتصال', 'تولید آخرین گام بعد از اتصال ≥ مقدار'],
    ['۳ — شکست وسط، چپ/راست با مراحل جدا', 'برش ← فرم ← شکست ← گام‌های هر شاخه تا پایان', 'L و R با قطعه خروجی؛ بدون اتصال', 'تولید پایانی هر دو شاخه ≥ مقدار'],
  ],
  [26, 32, 22, 20],
));
bodyChildren.push(...callout('نکته محافظتی مشترک', 'در هر سه سناریو، هیچ کمیتی بی‌سند جابه‌جا نمی‌شود: شکست با گزارش و انتقال، اتصال با سد جفتی و گزارش، و رسید محصول با سند انتقال به انبار. برگشت خطا هم همان قاعده امروز است — سند ابطالی — و ابطال انتقال شکست، مقادیر هر دو شاخه مقصد را با هم برمی‌گرداند.'));

// ==== ۷. اثر تولید موازی بر برنامه‌ریزی، MRP و WIP ====
bodyChildren.push(h1('۷. اثر تولید موازی بر برنامه‌ریزی، MRP و داشبورد WIP'));
bodyChildren.push(body('تعلق WIP تصحیح می‌شود: در محاسبه موجودی آزاد و netting، WIP گام‌های شاخه‌ای که قطعه خروجی دارند به همان قطعه تعلق می‌گیرد، نه به قطعه دستور کار؛ این دقیقاً همان چیزی است که MRP برای جلوگیری از پیشنهاد دستور کار اضافه برای چپ یا راست لازم دارد. گام‌های شاخه‌ای بدون قطعه خروجی و همه گام‌های شاخه اصلی مثل امروز به قطعه دستور کار تعلق می‌گیرند.'));
bodyChildren.push(body('پیشنهاد دستور کار جفتی: وقتی نیاز خالص چپ و راست از تقاضای باز مشتری بیرون می‌آید، MRP تعداد سیکل لازم را از بزرگ‌ترین نیاز شاخه‌ها می‌گیرد — سقف تقسیم بر ضریب هر شاخه، گرد به بالا — و پیشنهاد را با توضیح صریح نشان می‌دهد: «MO جفتی برای قطعه مجازی X، به دلیل نیاز چپ A و راست B». این پیشنهاد فقط‌خواندنی است و ساخت MO همچنان اقدام دستی برنامه‌ریز در ماژول تولید است؛ فقط فرم ساخت MO اجازه انتخاب قطعه مجازی را هم می‌دهد.'));
bodyChildren.push(body('یک محدودیت را صادقانه همین‌جا ثبت می‌کنیم: تخمین زمان و ظرفیت فاز ۴ جمع زمان همه گام‌هاست؛ در مسیر شاخه‌ای، زمان گام‌های موازیِ دو شاخه که عملاً در همان سیکل قالب انجام می‌شوند جمع می‌شود و تخمین بالاتر از واقعیت درمی‌آید. در فاز ۹b این مسیرها در خروجی‌های ظرفیت با برچسب «تخمینی» نمایش داده می‌شوند — هماهنگ با قاعده صادق‌بودن برچسب‌ها — و اصلاح ظریف آن (تفکیک زمان مشترک قالب از زمان انحصاری شاخه) به فاز بعدی موکول می‌شود، چون به داده زمان‌سنجی واقعی از خط نیاز دارد.'));
bodyChildren.push(body('داشبورد WIP ستون شاخه می‌گیرد: ردیف‌ها به‌تفکیک شاخه با برچسب فارسی (چپ/راست/اصلی) گروه می‌شوند و جمع هر شاخه جدا گزارش می‌شود؛ قداره هر عملیات مثل امروز از زمان اولین WIP محاسبه می‌شود. گزارش تولید و انتقال هم در صفحه جزئیات دستور کار با نشان شاخه نمایش داده می‌شوند تا اپراتور بداند کدام سند به کدام شاخه مربوط است.'));

// ==== ۸. ماژول C — سری تولید، لیبل شناسایی و ردیابی ====
bodyChildren.push(h1('۸. ماژول C — سری تولید، لیبل شناسایی و ردیابی'));
bodyChildren.push(h2('۸.۱. تصمیم: سری تولید به‌جای سریال تک‌قطعه'));
bodyChildren.push(body('دو گزینه بررسی شد: سریال یکتا برای هر عدد قطعه، یا سری تولید برای هر بسته/پالت از یک دستور کار. گزینه دوم انتخاب شد چون با واقعیت خط پرس سازگارتر است — صد و پنجاه قطعه در یک سیکل تولید با یک قالب معمولاً در پالت‌های هم‌نوامیساز منتقل و ذخیره می‌شوند و سریال‌کردن تک‌تک، بدون اسکنر و زیرساخت بارکدخوانی در هر ایستگاه، عملاً ثبت دستی و پرخطا می‌شود — و چون ساختار سری به‌سمت سریال واحد قابل ارتقا است: اگر بعداً ردیابی قطعه‌به‌قطعه لازم شد، همان مدل با دانه‌بندی ریزتر تکرار می‌شود بدون تغییر مفاهیم.'));
bodyChildren.push(tableCaption('جدول ۸ — مدل سری تولید (ProductionLot) و اتصال‌ها'));
bodyChildren.push(tbl(
  ['جزء', 'معنا'],
  [
    ['lotNumber', 'کد یکتا از توالی اسناد سامانه با پیشوند LOT — مثل LOT-2605-0012؛ خوانا، یکتا و قابل چاپ درشت'],
    ['moId و partId و branchKey', 'دستور کار مبدا، قطعه (برای شاخه دارای قطعه خروجی، همان قطعه) و شاخه — سری همیشه داخل یک دستور و یک شاخه است'],
    ['quantity', 'مقدار سری؛ مجموع سری‌های یک شاخه نمی‌تواند از تولید آماده همان شاخه بیشتر شود — سری به تولید واقعی گره می‌خورد، نه عدد اعلامی'],
    ['status', 'باز / بسته / ابطال — بستن سری با تحویل کامل مقدارش؛ ابطال فقط پیش از هر سند وابسته'],
    ['اتصال‌ها', 'گزارش تولید (اختیاری per سری)، سند انتقال و رسید محصول از مسیر انتقال — ردیابی بدون تغییر در دفتر کل انبار'],
  ],
  [28, 72],
));
bodyChildren.push(h2('۸.۲. صدور سری و لیبل چاپی'));
bodyChildren.push(body('صدور سری از صفحه جزئیات دستور کار انجام می‌شود — دکمه «صدور سری تولید» با انتخاب شاخه (اگر مسیر شاخه دارد)، مقدار و توضیح. سامانه مقدار را با تولید آماده همان شاخه مقایسه می‌کند و از مقدار بیشتر جلوگیری می‌کند. پس از صدور، دکمه «چاپ لیبل» یک صفحه چاپی خودکار باز می‌کند: کارت‌های لیبل در اندازه حدود ده در پانزده سانتی‌متر، چیدمان راست‌به‌چپ، با کد سری درشت در بالا برای خوانایی از فاصله، و جدول مشخصات پایین.'));
bodyChildren.push(tableCaption('جدول ۹ — محتوای لیبل شناسایی'));
bodyChildren.push(tbl(
  ['قسمت لیبل', 'محتوا'],
  [
    ['سرصفحه', 'کد سری تولید درشت + کد QR (در صورت تأیید شما؛ محتوا: همان کد سری برای اسکن با موبایل)'],
    ['مشخصات قطعه', 'شماره قطعه، نام فارسی، نوع (تکمیلی/نیم‌ساخت)، مشتری اصلی'],
    ['مبدا', 'شماره دستور کار، نسخه مسیر، شاخه (چپ/راست/اصلی) در صورت وجود'],
    ['مرحله', 'عملیات جاری یا عملیات مقصد انتقال — لیبل هم هنگام خروج از عملیات و هم هنگام رسیدن به انبار قابل چاپ است'],
    ['مقدار و تاریخ', 'مقدار سری با واحد، تاریخ جلالی صدور، نام کاربر صادرکننده'],
  ],
  [24, 76],
));
bodyChildren.push(h2('۸.۳. صفحه ردیابی سری'));
bodyChildren.push(body('صفحه «ردیابی سری» با جستجوی کد سری یا انتخاب قطعه/دستور کار، خط زمانی کامل می‌سازد: گزارش‌های هر عملیات با ماشین و شیفت و تاریخ، انتقال‌های بین عملیات، رسید انبار محصول، و حواله‌های ماده مرتبط با همان دستور کار — همه از رکوردهای قطعی‌شده، نه ورودی دستی. کد سری به جستجوی سراسری Ctrl+K هم اضافه می‌شود تا در انبار و سالن با یک جستجو پیدا شود. مجوز صدور سری با اجازه مدیریت تولید و مشاهده لیبل و ردیابی با اجازه مشاهده تولید کنترل می‌شود.'));

// ==== ۹. ماژول D — جستجوی سریع محصول در مسیرهای تولید ====
bodyChildren.push(h1('۹. ماژول D — جستجوی سریع محصول در مسیرهای تولید'));
bodyChildren.push(body('مشکل فعلی، ضعف موتور جستجو نیست — جستجوی متنی فعلی شماره و نام قطعه را هم می‌گردد — بلکه ساختار صفحه است: همه نسخه‌های همه قطعات در یک فهرست بلند چیده می‌شوند و هیچ میان‌بری از «قطعه» به «مسیر قطعه» وجود ندارد. به همین دلیل راه‌حل عمدتاً رابط کاربری است و دو فیلتر کوچک سمت سرور می‌خواهد. با این تغییرها، رسیدن به مسیر هر محصول حداکثر دو حرکت است: انتخاب قطعه از انتخاب‌گر با جستجوی هم‌زمان، یا رسیدن از خود صفحه قطعات.'));
bodyChildren.push(tableCaption('جدول ۱۰ — بهبودهای جستجو و ناوبری مسیرها'));
bodyChildren.push(tbl(
  ['بهبود', 'توضیح'],
  [
    ['پیش‌فرض: فقط نسخه فعال هر قطعه', 'کلید تغییرپذیر «نمایش همه نسخه‌ها» برای موارد خاص؛ فهرست پیش‌فرض به تعداد قطعات فعال کوتاه می‌شود'],
    ['انتخاب‌گر قطعه با جستجوی هم‌زمان', 'جعبه انتخاب با تایپ هم‌زمان روی کد و نام قطعه؛ پس از انتخاب، فقط مسیرهای همان قطعه'],
    ['فیلتر «شامل عملیات»', 'مثلاً همه مسیرهایی که جوش CO2 دارند — برای یافتن قطعات قابل ساخت روی یک ایستگاه'],
    ['گروه‌بندی نمایش بر اساس قطعه', 'یک ردیف به‌ازای هر قطعه با نشان نسخه‌ها؛ نسخه فعال برجسته'],
    ['میان‌بر از صفحه قطعات', 'در هر ردیف قطعه دکمه «مسیر تولید» که صفحه مسیرها را فیلترشده باز می‌کند'],
    ['جستجوی سراسری با رفتار درست', 'نتیجه «مسیر» در Ctrl+K به‌جای لینک بی‌مقصد، صفحه مسیرها را روی همان قطعه باز می‌کند'],
  ],
  [32, 68],
));
bodyChildren.push(body('سمت سرور دو پارامتر به فهرست مسیرها اضافه می‌شود: نمایش فقط جدیدترین نسخه فعال هر قطعه (پرس‌وجوی پنجره‌ای ساده) و فیلتر شناسه عملیات. هیچ تغییر ساختاری در دیتابیس لازم نیست و همان ایندکس‌های موجود کافی است، چون تعداد مسیرها در حد ده‌ها نسخه است. همین الگو بعداً به صفحه BOM و دستور کارها هم منتقل می‌شود تا کل سامانه یک زبان جستجوی مشترک داشته باشد.'));

// ==== ۱۰. برنامه اجرا، آزمون‌ها و ریسک‌ها ====
bodyChildren.push(h1('۱۰. برنامه اجرا، آزمون‌ها و ریسک‌ها'));
bodyChildren.push(body('اجرا در سه زیرفاز پیشنهاد می‌شود و ترتیبش مهم است: فاز ۹a (BOM پیشرفته) اول می‌آید، چون MRP جفتی فاز ۹b برای محاسبه نیاز ورقِ قطعه جفتی و مؤلفه‌ها به انفجار چندسطحی نیاز دارد؛ فاز ۹c (سری و لیبل و جستجو) مستقل است و هر وقت بخواهید می‌تواند جلو بیفتد، ولی به‌طور پیش‌فرض آخر می‌نشیند تا تغییر رابط کاربری تولید یک‌جا بیاید.'));
bodyChildren.push(tableCaption('جدول ۱۱ — محدوده، مهاجرت و آزمون هر زیرفاز'));
bodyChildren.push(tbl(
  ['زیرفاز', 'محدوده', 'مهاجرت', 'آزمون‌های کلیدی'],
  [
    ['۹a — BOM پیشرفته', 'ستون‌های خط BOM، قیود جدید، انفجار بازگشتی MRP، بررسی پیش از حواله دو لایه، درخت BOM و where-used', 'ستون‌های جدید + ایندکس جزئی + CHECK؛ مهاجرت رکوردها به خط ماده', 'شش آزمون جدول ۴ + سبزماندن آزمون‌های فعلی'],
    ['۹b — تولید موازی', 'شاخه و گام شکست/اتصال، اجرای شاخه‌ای، تکمیل MO، قطعه مجازی، WIP شاخه‌ای، MRP جفتی، ویرایشگر مسیر شاخه‌ای', 'ستون‌های پیش‌فرض‌دار روی گام/عملیات/انتقال + جدول شاخه‌ها؛ مسیرهای موجود همه MAIN/STANDARD', 'بازسازی عددی سه سناریو، سد اتصال نامتوازن، ممنوعیت رسید قطعه مجازی، ابطال انتقال شکست'],
    ['۹c — سری و لیبل و جستجو', 'مدل سری، صدور از MO، لیبل چاپی، صفحه ردیابی، بهبود جستجوی مسیرها', 'جدول سری + توالی LOT + دو فیلتر فهرست مسیرها', 'سری بیش از تولید آماده رد می‌شود، ردیابی سرتاسری یک سری، پیش‌فرض نسخه فعال'],
  ],
  [16, 34, 24, 26],
));
bodyChildren.push(h2('۱۰.۱. ریسک‌ها و راهکار'));
bodyChildren.push(body('ریسک‌های اصلی چهار تا هستند. نخست، تغییر کلید یکتای BOM: با پشتیبان پیش از migration و ایندکس‌های جزئی کنترل می‌شود و آزمون مهاجرت عدد ردیف‌ها را راستی‌آزمایی می‌کند. دوم، پیچیدگی موتور شاخه‌ها: همه قواعد جدید در لایه سرویس با کد خطای صریح پیاده و تک‌تک با آزمون پوشش داده می‌شوند — همان الگوی سدهای فاز ۳ و ۸. سوم، سازگاری گزارش‌ها: گزارش‌های فاز ۵ و ۸ باید روی داده شاخه‌ای هم جمع درستی بدهند؛ در آزمون پذیرش، تطبیق دفتر کل و موجودی رسمی بعد از اجرای سناریوهای موازی دوباره اجرا می‌شود. چهارم، اثر آموزشی روی اپراتورها: فرم گزارش تولید و انتقال فقط وقتی شاخه می‌گیرد که مسیر واقعاً شاخه داشته باشد؛ مسیرهای ساده امروز بدون هیچ تغییر ظاهری می‌مانند.'));
bodyChildren.push(h2('۱۰.۲. معیار پذیرش'));
bodyChildren.push(body('معیار پذیرش هر سه زیرفاز یکی است و قابل اندازه‌گیری: بازسازی عددی سه سناریوی این سند در آزمون‌های خودکار سبز شود، همه ۱۲۸ آزمون فعلی هم‌چنان سبز بمانند، و تطبیق دفتر کل با موجودی رسمی و با شمارش تولید سناریوها صفر اختلاف بدهد. هیچ زیرفازی «آماده تولید» اعلام نمی‌شود مگر این معیار کامل اجرا شده باشد — همان قاعده همیشگی پروژه.'));

// ==== ۱۱. پرسش‌های باز برای تأیید ====
bodyChildren.push(h1('۱۱. پرسش‌های باز برای تأیید شما'));
bodyChildren.push(body('پنج تصمیم جزئی، اجرا را روان‌تر می‌کند. پیشنهاد من کنار هر پرسش نوشته شده است؛ اگر تأیید کنید یا جایگزین بگویید، طراحی نهایی می‌شود:'));
bodyChildren.push(step('۱.', 'پیچ و مهره‌ها هم از تأمین‌کننده با قرارداد می‌آیند؟ اگر بله، در MRP کسری آن‌ها هم پوشش قرارداد می‌گیرد؛ پیشنهاد من بله، چون زیرساختش آماده است.'));
bodyChildren.push(step('۲.', 'آیا ممکن است گاهی چپ و راست به‌صورت جفتی هم تحویل داده شوند؟ اگر بله، قطعه جفتی را «مجازیِ شل» طراحی می‌کنم که در حالت استثنا بتواند انبار هم بگیرد؛ پیشنهاد من برای سادگی، مجازی سفت و تحویل فقط بعد از جداسازی.'));
bodyChildren.push(step('۳.', 'روی لیبل، کد QR لازم است یا کد سری درشت کافی است؟ و ابعاد لیبل همان ده در پانزده سانتی‌متر خوب است یا اندازه خاص پرینتر دارید؟'));
bodyChildren.push(step('۴.', 'زمان صدور سری: پیشنهاد من هنگام خروج از آخرین عملیات یا هنگام رسید به انبار است؛ اگر می‌خواهید از وسط مسیر هم سری صادر شود (برای تفکیک بین پالت‌ها)، در طراحی آماده است چون سری به شاخه گره خورده نه به پایان مسیر.'));
bodyChildren.push(step('۵.', 'ترتیب اجرا: پیشنهاد من ۹a سپس ۹b سپس ۹c است؛ اگر فشار روزانه جستجوی مسیرها بیشتر است، می‌توان بخش جستجوی ۹c را جدا و زودتر تحویل داد چون به هیچ‌کدام وابسته نیست.'));
bodyChildren.push(body('پس از تأیید این پنج مورد، کار را با فاز ۹a شروع می‌کنم و در پایان هر زیرفاز، گزارش پذیرش با نتیجه واقعی آزمون‌ها — نه ادعا — تحویل می‌شود.'));

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

const OUT = '/home/z/my-project/download/KPIMS-طراحی-BOM-پیشرفته-و-تولید-موازی.docx';
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log('WROTE', OUT, buf.length, 'bytes');
});
