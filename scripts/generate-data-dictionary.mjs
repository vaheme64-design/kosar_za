#!/usr/bin/env node
/**
 * KPIMS — generate docs/DATA-DICTIONARY.md from prisma/schema.prisma.
 *
 * Parses the schema (models, fields, @map/@db attributes, /// doc comments,
 * relations, @@index/@@unique) and renders a Persian data dictionary so the
 * documentation can never drift from the actual schema.
 *
 *   node scripts/generate-data-dictionary.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(root, 'backend', 'prisma', 'schema.prisma');
const outPath = path.join(root, 'docs', 'DATA-DICTIONARY.md');

const schema = fs.readFileSync(schemaPath, 'utf8');

// ------------------------------------------------------------------ parsing
function stripComments(src) {
  return src.replace(/^\s*\/\/[^/].*$/gm, '');
}

const DOMAINS = {
  'CONTROL — داده‌های کنترلی': ['User', 'Role', 'Permission', 'RolePermission', 'AuditLog', 'DocumentSequence', 'SystemSetting'],
  'SNAPSHOTS — تصاویر محاسباتی': ['MrpSnapshot'],
  'MASTER DATA — اطلاعات پایه': ['UnitOfMeasure', 'Material', 'PartMaterialRequirement', 'Part', 'Customer', 'Operation', 'PartRoute', 'PartRouteStep', 'Machine', 'MachineCapability', 'Die', 'MachineDieCompatibility', 'Warehouse', 'WarehouseLocation', 'Shift'],
  'PRODUCTION DATA — داده‌های تولید': ['CustomerOrder', 'CustomerOrderLine', 'ProductionPlan', 'ProductionPlanLine', 'PlanLineOperation', 'PlanLineMaterialShortage', 'ManufacturingOrder', 'ProductionOperation', 'ProductionReport', 'ProductionScrap', 'ProductionTransfer', 'MachineAssignment'],
  'INVENTORY DATA — داده‌های انبار': ['InventoryDocument', 'InventoryDocumentLine', 'InventoryTransaction', 'InventoryReservation', 'StockBalance', 'MaterialLot', 'MaterialContract', 'MaterialContractTransaction'],
};

function parseBlocks(src) {
  const blocks = {};
  const lines = src.split('\n');
  let docLines = [];
  let current = null; // { kind, name, bodyLines }
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('///')) {
      docLines.push(line.replace(/^\/\/\/\s?/, ''));
      continue;
    }
    const header = line.match(/^(model|enum)\s+(\w+)\s*\{$/);
    if (header) {
      current = { kind: header[1], name: header[2], bodyLines: [] };
      continue;
    }
    if (current) {
      if (line === '}') {
        blocks[current.name] = { kind: current.kind, doc: docLines.join(' '), body: current.bodyLines.join('\n') };
        current = null;
        docLines = [];
      } else {
        current.bodyLines.push(raw);
      }
    } else {
      docLines = [];
    }
  }
  return blocks;
}

function parseModel(name, body) {
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('@@') && !l.startsWith('//'));
  const fields = [];
  const tableAttrs = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (t.startsWith('@@')) tableAttrs.push(t.replace(/\s+$/, ''));
  }
  for (const line of lines) {
    const attrStart = line.indexOf('@');
    if (attrStart === -1) continue;
    let doc = '';
    const decl = line.slice(0, attrStart).trim();
    const attrs = line.slice(attrStart).trim();
    const parts = decl.split(/\s+/);
    const fieldName = parts[0];
    const type = parts.slice(1).join(' ');
    const mapMatch = attrs.match(/@map\("([^"]+)"\)/);
    const dbTypeMatch = attrs.match(/@db\.(\w+(?:\(\d+(?:,\s*\d+)?\))?)/);
    const defMatch = attrs.match(/@default\(([^)]+)\)/);
    const uniqueInline = /@unique/.test(attrs);
    const isId = /@id/.test(attrs);
    fields.push({
      name: fieldName,
      type,
      column: mapMatch ? mapMatch[1] : fieldName,
      dbType: dbTypeMatch ? dbTypeMatch[1] : '',
      def: defMatch ? defMatch[1] : '',
      required: !type.endsWith('?'),
      isRelation: type && /^[A-Z]/.test(type.replace(/\[\]|\?/g, '')) && !['String', 'Int', 'Boolean', 'Decimal', 'DateTime', 'Json', 'Float'].some((t) => type.startsWith(t)),
      isId,
      uniqueInline,
      attrs,
    });
  }
  return { fields, tableAttrs };
}

const blocks = parseBlocks(stripComments(schema));

function mdEsc(s) {
  return String(s ?? '').replace(/\|/g, '\\|');
}

let md = `# KPIMS — دیکشنری داده (Data Dictionary)

> این سند **به‌صورت خودکار** از \`backend/prisma/schema.prisma\` تولید شده است
> (\`npm run docs:dictionary\`). همیشه با نسخه‌ی فعلی اسکیما هم‌خوان است.

**قراردادهای کلی:**

- کلید اصلی همه جداول: \`id UUID\` (تولید سمت کلاینت Prisma).
- نام جداول/ستون‌ها snake_case (برای سازگاری با SQL خام و یکپارچگی ERP).
- مقادیر کمیتی و وزن: \`DECIMAL\` (بدون float) — معمولاً \`DECIMAL(18,4)\`.
- زمان‌ها UTC با \`TIMESTAMPTZ(6)\`؛ تاریخ‌های کاری \`DATE\` (نمایش تقویم جلالی در لایه نمایش).
- وضعیت گردش کار (\`status\`) از وضعیت قطع‌بوش (\`posting_status\`) جدا است.
- تراکنش‌های انبار (\`inventory_transactions\`) تغییرناپذیرند؛ اصلاح فقط با سند ابطال.
`;

let totalFields = 0;
let totalModels = 0;

for (const [domain, models] of Object.entries(DOMAINS)) {
  md += `\n---\n\n## ${domain}\n`;
  for (const modelName of models) {
    const block = blocks[modelName];
    if (!block) {
      console.error(`model not found in schema: ${modelName}`);
      continue;
    }
    const { fields, tableAttrs } = parseModel(modelName, block.body);
    totalModels += 1;
    totalFields += fields.length;

    const tableMap = tableAttrs.find((a) => a.startsWith('@@map'));
    const tableName = tableMap ? tableMap.match(/@@map\("([^"]+)"\)/)?.[1] : modelName;

    md += `\n### ${modelName} → \`${tableName}\`\n`;
    if (block.doc) md += `\n${block.doc}\n`;

    md += `\n| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |\n`;
    md += `|---|---|---|---|:-:|---|---|\n`;
    for (const f of fields) {
      if (f.isRelation) {
        const isList = f.type.endsWith('[]');
        md += `| — | ${mdEsc(f.name)} | — | رابطه ← ${mdEsc(f.type)} | ${f.required && !isList ? '✓' : ''} | | |
`;
        continue;
      }
      const dbType = f.dbType || f.type;
      let def = '';
      if (/@default\(uuid\(\)\)/.test(f.attrs)) def = 'uuid()';
      else if (/@default\(now\(\)\)/.test(f.attrs)) def = 'now()';
      else if (f.def) def = mdEsc(f.def.replace(/dbgenerated|Prisma\./g, ''));
      const notes = [];
      if (f.isId) notes.push('PK');
      if (f.uniqueInline) notes.push('UNIQUE');
      md += `| \`${mdEsc(f.column)}\` | ${mdEsc(f.name)} | ${mdEsc(dbType)} | ${mdEsc(f.type)} | ${f.required ? '✓' : ''} | ${def} | ${notes.join(', ')} |\n`;
    }

    const indexes = tableAttrs.filter((a) => a.startsWith('@@index') || (a.startsWith('@@unique')));
    if (indexes.length) {
      md += `\n**ایندکس‌ها/یکتایی‌های سطح جدول:**\n\n`;
      for (const ix of indexes) md += `- \`${mdEsc(ix)}\`\n`;
    }
  }
}

md += `\n---\n\n## آمار\n\n- تعداد مدل‌ها: **${totalModels}**\n- تعداد فیلدها: **${totalFields}**\n- دیتابیس: PostgreSQL 15+ (توسعه: 17.11)\n`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, md, 'utf8');
console.log(`data dictionary written: ${outPath} (${totalModels} models, ${totalFields} fields)`);
