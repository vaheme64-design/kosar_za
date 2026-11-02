/**
 * KPIMS — Phase 7: AI assistant tests.
 *
 * No real LLM is contacted: the provider boundary is exercised with an
 * unreachable local port (honest failure) and the NL→report mapping is tested
 * against the REAL report service with REAL database rows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApiError } from '../src/lib/http';
import {
  extractJsonObject,
  getAiConfig,
  checkAiStatus,
  resolveReportQuery,
} from '../src/modules/ai/ai.service';
import { coilInventory, lotConsumption } from '../src/modules/reports/reports.service';
import { REPORT_CATALOG } from '../src/modules/reports/reports.types';
import { db, buildFixtures, uniqueCode, type Fixtures } from './helpers';

const allowedByKey = Object.fromEntries(REPORT_CATALOG.map((r) => [r.key, r.filters]));

describe('AI — strict JSON extraction', () => {
  it('parses a plain JSON reply', () => {
    expect(extractJsonObject('{"reportKey":"backlog"}')).toEqual({ reportKey: 'backlog' });
  });

  it('parses JSON wrapped in markdown fences', () => {
    const fenced = '```json\n{"a":1,"nested":{"b":"x}y"}}\n```';
    expect(extractJsonObject(fenced)).toEqual({ a: 1, nested: { b: 'x}y' } });
  });

  it('parses JSON embedded in prose', () => {
    const prose = 'بله! پاسخ این است: {"reportKey":"coil-inventory","filters":{}} — امیدوارم کمک کرد.';
    expect(extractJsonObject(prose)).toEqual({ reportKey: 'coil-inventory', filters: {} });
  });

  it('rejects output without any JSON object', () => {
    expect(() => extractJsonObject('متأسفانه نمی‌دانم')).toThrowError(ApiError);
  });

  it('rejects incomplete JSON', () => {
    expect(() => extractJsonObject('{"a": 1')).toThrowError(ApiError);
  });
});

describe('AI — NL→report query guardrails (whitelist enforced)', () => {
  it('accepts a valid report key and passes allowed filters', () => {
    const resolved = resolveReportQuery(
      '{"reportKey":"coil-inventory","filters":{"q":"ورق"},"explanationFa":"موجودی رول‌ها با جستجو"}',
      allowedByKey,
    );
    expect(resolved.reportKey).toBe('coil-inventory');
    expect(resolved.filters.q).toBe('ورق');
  });

  it('rejects hallucinated report keys', () => {
    expect(() =>
      resolveReportQuery('{"reportKey":"everything-report","filters":{},"explanationFa":""}', allowedByKey),
    ).toThrowError(ApiError);
    expect(() => resolveReportQuery('{"reportKey":"","filters":{}}', allowedByKey)).toThrowError(ApiError);
  });

  it('rejects filters that the chosen report does not declare', () => {
    expect(() =>
      resolveReportQuery(
        '{"reportKey":"coil-inventory","filters":{"customerId":"e6c8ea19-11c4-4a4a-8d0d-2f2f2f2f2f2f"},"explanationFa":""}',
        allowedByKey,
      ),
    ).toThrowError(ApiError);
  });

  it('page context overrides AI-guessed filters (real UUIDs win)', () => {
    const materialId = '11111111-2222-4333-8444-555555555555';
    const resolved = resolveReportQuery(
      '{"reportKey":"lot-consumption","filters":{"materialId":"99999999-9999-4999-8999-999999999999"},"explanationFa":""}',
      allowedByKey,
      { materialId },
    );
    expect(resolved.filters.materialId).toBe(materialId);
  });
});

describe('AI — configuration & honest status', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const k of ['AI_ENABLED', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_KEY']) {
      originalEnv[k] = process.env[k];
    }
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await db.systemSetting.deleteMany({ where: { key: { startsWith: 'ai.' } } });
  });

  it('env fallback works and is reported as the source', async () => {
    process.env.AI_MODEL = 'test-model-env';
    const cfg = await getAiConfig();
    expect(cfg.model).toBe('test-model-env');
    expect(cfg.source).toBe('environment');
    expect(cfg.baseUrl).toContain('11434'); // Ollama default
  });

  it('database settings take precedence over environment', async () => {
    await db.systemSetting.upsert({
      where: { key: 'ai.model' },
      update: { value: 'test-model-db' },
      create: { key: 'ai.model', value: 'test-model-db', valueType: 'STRING', description: 'test' },
    });
    const cfg = await getAiConfig();
    expect(cfg.model).toBe('test-model-db');
    expect(cfg.source).toBe('database');
    await db.systemSetting.delete({ where: { key: 'ai.model' } });
  });

  it('status probe is honest: closed port means reachable=false, never fake success', async () => {
    process.env.AI_BASE_URL = 'http://127.0.0.1:59911/v1';
    const status = await checkAiStatus();
    expect(status.configured).toBe(true);
    expect(status.reachable).toBe(false);
    expect(status.errorFa).toBeTruthy();
    expect(status.models).toEqual([]);
  });

  it('disabled switch is respected', async () => {
    process.env.AI_ENABLED = 'false';
    const status = await checkAiStatus();
    expect(status.enabled).toBe(false);
    expect(status.reachable).toBe(false);
    delete process.env.AI_ENABLED;
  });
});

describe('AI — report-query executes the REAL report on real data', () => {
  let f: Fixtures;

  beforeAll(async () => {
    f = await buildFixtures();
    const contract = await db.materialContract.create({
      data: {
        contractNumber: uniqueCode('CT'),
        materialId: f.materialId,
        orderDate: new Date(),
        totalQuantity: 5,
        totalWeightKg: 10000,
      },
    });
    const doc = await db.inventoryDocument.create({
      data: {
        documentNumber: uniqueCode('DOC'),
        documentType: 'RECEIPT',
        status: 'CONFIRMED',
        postingStatus: 'POSTED',
        documentDate: new Date(),
        warehouseId: f.warehouseId,
        description: 'رسید آزمون هوش مصنوعی',
        createdById: f.adminId,
        postedAt: new Date(),
        lines: {
          create: {
            lineNo: 1,
            materialId: f.materialId,
            quantity: 1000,
            unitId: (await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'KG' } })).id,
            weightKg: 1000,
            toLocationId: f.locationAId,
            contractId: contract.id,
          },
        },
      },
    });
    const lot = await db.materialLot.create({
      data: {
        materialId: f.materialId,
        lotNumber: uniqueCode('AILOT'),
        receiptDate: new Date(),
        quantityReceived: 1000,
        quantityRemaining: 1000,
        weightReceivedKg: 1000,
        weightRemainingKg: 1000,
        ownership: 'SUPPLIER_CONSIGNMENT',
      },
    });
    await db.inventoryTransaction.create({
      data: {
        transactionNumber: uniqueCode('TX'),
        documentId: doc.id,
        type: 'RECEIPT',
        materialId: f.materialId,
        warehouseId: f.warehouseId,
        locationId: f.locationAId,
        lotId: lot.id,
        quantity: 1000,
        unitId: (await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'KG' } })).id,
        weightKg: 1000,
        ownership: 'SUPPLIER_CONSIGNMENT',
        qualityStatus: 'APPROVED',
      },
    });
    await db.stockBalance.create({
      data: {
        materialId: f.materialId,
        warehouseId: f.warehouseId,
        locationId: f.locationAId,
        lotId: lot.id,
        unitId: (await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'KG' } })).id,
        ownership: 'SUPPLIER_CONSIGNMENT',
        qualityStatus: 'APPROVED',
        balanceKey: `AI-${uniqueCode('K')}`,
        quantity: 1000,
        weightKg: 1000,
      },
    });
  });

  it('coil-inventory report (the AI target) reflects the seeded roll', async () => {
    const report = await coilInventory({ materialId: f.materialId, format: 'json' });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.weightRemainingKg).toBe('1000.000');
    expect(report.meta.notesFa.some((n) => n.includes('سالم 1'))).toBe(true);
  });

  it('lot-consumption report (the AI target) has the promised columns', async () => {
    const report = await lotConsumption({ materialId: f.materialId, format: 'json' });
    expect(report.key).toBe('lot-consumption');
    expect(report.columns.map((c) => c.key)).toContain('lotNumber');
    expect(report.columns.map((c) => c.key)).toContain('purpose');
    expect(report.rows).toHaveLength(0); // nothing consumed yet — honestly empty
  });
});
