/**
 * KPIMS — Phase 4: Production Planning service
 *
 * سرویس برنامه‌ریزی تولید — بارگذاری داده، اجرای موتور و ثبت برنامه پیشنهادی
 *
 * Honesty rules:
 *  • The plan is a PROPOSAL: it never mutates production transactions or
 *    inventory. MOs are created later by an explicit user action.
 *  • Everything is computed server-side inside ONE database transaction
 *    (consistent snapshot).
 *  • Missing information surfaces in `missingInfo` — nothing is assumed.
 */
import { Prisma } from '@prisma/client';
import { db } from '../../config/db';
import { ApiError } from '../../lib/http';
import { recordAudit } from '../../lib/audit';
import { generateDocumentNumber } from '../../services/documentNumber.service';
import {
  computeGrossDemand,
  computeFgAvailability,
  splitReservations,
  netLine,
  netWipAcrossOperations,
  computeMaterialShortages,
  shiftMinutesPerDay,
  evaluateMachine,
  rankCandidates,
  fmt,
  type OrderLineInput,
  type MachineCandidate,
  type WipOpSnapshot,
} from './planning.logic';
import type {
  RunPlanningInput,
  CreateCustomerOrderInput,
  PlanningFilters,
} from './planning.schemas';

type Tx = Prisma.TransactionClient;
type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const Q0 = new D(0);
const dec = (v: Prisma.Decimal.Value | null | undefined): Dec => new D(v ?? 0);

const dateAtUtc = (yyyyMmDd: string): Date => new Date(`${yyyyMmDd}T00:00:00Z`);

// ---------------------------------------------------------------------------
// customer orders (planning input)
// ---------------------------------------------------------------------------

export async function createCustomerOrder(input: CreateCustomerOrderInput, userId: string, meta: { ip?: string; ua?: string }) {
  return db.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
    if (!customer || !customer.isActive) {
      throw new ApiError(422, 'Customer not found or inactive', 'مشتری یافت نشد یا غیرفعال است', 'customer_invalid');
    }
    const partIds = input.lines.map((l) => l.partId);
    const parts = await tx.part.findMany({ where: { id: { in: partIds } }, select: { id: true, status: true, partNumber: true } });
    for (const pid of partIds) {
      const part = parts.find((p) => p.id === pid);
      if (!part) throw new ApiError(422, 'Part not found', 'قطعه یافت نشد', 'part_not_found');
      if (part.status !== 'ACTIVE') throw new ApiError(422, `Part ${part.partNumber} is not active`, `قطعه ${part.partNumber} فعال نیست`, 'part_inactive');
    }

    const orderNumber = await generateDocumentNumber(tx, 'CO');
    const order = await tx.customerOrder.create({
      data: {
        orderNumber,
        customerId: input.customerId,
        orderDate: dateAtUtc(input.orderDate),
        dueDate: input.dueDate ? dateAtUtc(input.dueDate) : null,
        status: 'CONFIRMED', // planning consumes confirmed orders (explicitly shown in UI)
        description: input.description ?? null,
        lines: {
          create: input.lines.map((l, i) => ({
            lineNo: i + 1,
            partId: l.partId,
            quantity: l.quantity,
            dueDate: l.dueDate ? dateAtUtc(l.dueDate) : input.dueDate ? dateAtUtc(input.dueDate) : null,
            status: 'OPEN',
            notes: l.notes ?? null,
          })),
        },
      },
      include: { lines: { include: { part: { select: { partNumber: true, nameFa: true } } } } },
    });
    await recordAudit(tx, {
      userId,
      action: 'CREATE',
      entityType: 'CustomerOrder',
      entityId: order.id,
      changes: { orderNumber, lines: input.lines.length },
      ipAddress: meta.ip,
      userAgent: meta.ua,
    });
    return order;
  });
}

export async function listCustomerOrders(filters: { openOnly?: boolean; take?: number }) {
  const orders = await db.customerOrder.findMany({
    where: filters.openOnly ? { status: { in: ['CONFIRMED', 'IN_PRODUCTION', 'PARTIALLY_DELIVERED'] } } : undefined,
    orderBy: { createdAt: 'desc' },
    take: filters.take ?? 50,
    include: {
      customer: { select: { nameFa: true, code: true } },
      lines: {
        include: {
          part: { select: { partNumber: true, nameFa: true, baseUnit: { select: { code: true } } } },
        },
      },
    },
  });
  return orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    customer: o.customer,
    orderDate: o.orderDate,
    dueDate: o.dueDate,
    status: o.status,
    description: o.description,
    createdAt: o.createdAt,
    lines: o.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      part: l.part,
      quantity: dec(l.quantity).toFixed(4),
      deliveredQuantity: dec(l.deliveredQuantity).toFixed(4),
      remaining: dec(l.quantity).minus(dec(l.deliveredQuantity)).toFixed(4),
      dueDate: l.dueDate,
      status: l.status,
      unit: l.part.baseUnit.code,
    })),
  }));
}

// ---------------------------------------------------------------------------
// planning run
// ---------------------------------------------------------------------------

interface WipKey { partId: string; operationId: string }

export async function runPlanning(input: RunPlanningInput, userId: string, meta: { ip?: string; ua?: string }) {
  const now = new Date();
  const plan = await db.$transaction(async (tx) => {
    // ------------------------------------------------------------- 0) scope
    const orderWhere: Prisma.CustomerOrderWhereInput = {
      status: { in: ['CONFIRMED', 'IN_PRODUCTION', 'PARTIALLY_DELIVERED'] },
      ...(input.orderIds?.length ? { id: { in: input.orderIds } } : {}),
    };
    const orders = await tx.customerOrder.findMany({
      where: orderWhere,
      include: {
        customer: { select: { nameFa: true } },
        lines: {
          where: {
            status: { in: ['OPEN', 'IN_PRODUCTION'] },
            ...(input.partIds?.length ? { partId: { in: input.partIds } } : {}),
            ...(input.dueFrom || input.dueTo
              ? { dueDate: { ...(input.dueFrom ? { gte: dateAtUtc(input.dueFrom) } : {}), ...(input.dueTo ? { lte: dateAtUtc(input.dueTo) } : {}) } }
              : {}),
          },
          include: { part: { select: { id: true, partNumber: true, nameFa: true, baseUnit: { select: { code: true } } } } },
        },
      },
    });

    const orderLines: OrderLineInput[] = orders.flatMap((o) =>
      o.lines.map((l) => ({
        lineId: l.id,
        orderId: o.id,
        orderNumber: o.orderNumber,
        customerId: o.customerId,
        customerNameFa: o.customer.nameFa,
        lineNo: l.lineNo,
        partId: l.partId,
        quantity: l.quantity,
        deliveredQuantity: l.deliveredQuantity,
        dueDate: l.dueDate,
        lineStatus: l.status,
        orderStatus: o.status,
      })),
    );

    const demand = computeGrossDemand(orderLines);
    const partIds = [...demand.byPart.keys()];

    // ------------------------------------------------- 1) reference context
    const bomMaterialIds = (
      await tx.partMaterialRequirement.findMany({
        where: partIds.length ? { partId: { in: partIds } } : undefined,
        select: { materialId: true },
      })
    ).map((r) => r.materialId);

    const [fgWarehouses, allMachines, capabilities, dieCompats, activeShifts, bomRows, openMos, materialBalances, openContracts] = await Promise.all([
      tx.warehouse.findMany({ where: { warehouseType: 'FINISHED_GOODS', isActive: true }, select: { id: true } }),
      tx.machine.findMany({ select: { id: true, code: true, nameFa: true, machineType: true, tonnage: true, status: true } }),
      tx.machineCapability.findMany({ select: { machineId: true, operationId: true, standardRatePerHour: true } }),
      tx.machineDieCompatibility.findMany({ select: { machineId: true, dieId: true } }),
      tx.shift.findMany({ where: { isActive: true } }),
      tx.partMaterialRequirement.findMany({
        where: partIds.length ? { partId: { in: partIds } } : undefined,
        include: { material: { select: { id: true, materialCode: true, nameFa: true, baseUnit: { select: { code: true } } } } },
      }),
      tx.manufacturingOrder.findMany({
        where: { status: { in: ['PLANNED', 'RELEASED', 'IN_PROGRESS'] }, ...(partIds.length ? { partId: { in: partIds } } : {}) },
        include: { operations: { orderBy: { sequence: 'asc' }, include: { routeStep: { select: { cycleTimeSec: true } } } } },
      }),
      tx.stockBalance.findMany({
        where: partIds.length ? { OR: [{ partId: { in: partIds } }, { materialId: { in: bomMaterialIds } }] } : undefined,
        select: { partId: true, materialId: true, quantity: true, weightKg: true, ownership: true, qualityStatus: true },
      }),
      tx.materialContract.findMany({ where: { status: { in: ['OPEN', 'PARTIALLY_RECEIVED'] } }, include: { transactions: { select: { quantity: true } } } }),
    ]);

    const fgWhIds = new Set(fgWarehouses.map((w) => w.id));
    const capRate = new Map<string, Prisma.Decimal | null>(); // `${machineId}:${operationId}` → rate
    for (const c of capabilities) capRate.set(`${c.machineId}:${c.operationId}`, c.standardRatePerHour);
    const dieCompatMap = new Map<string, Set<string>>(); // dieId → machineIds
    for (const c of dieCompats) {
      const set = dieCompatMap.get(c.dieId) ?? new Set<string>();
      set.add(c.machineId);
      dieCompatMap.set(c.dieId, set);
    }
    const capacity = shiftMinutesPerDay(activeShifts.map((s) => ({ id: s.id, code: s.code, nameFa: s.nameFa, startTime: s.startTime, endTime: s.endTime })));

    // ------------------------------------------------- 2) WIP snapshot
    // per (partId, operationId): actual WIP (readyForTransfer / arriving) and
    // committed remaining output of open MOs
    const wipMap = new Map<string, { readyForTransfer: Dec; arriving: Dec; committed: Dec; mos: Set<string> }>();
    const plannedMosByPart = new Map<string, { moNumber: string; remaining: Dec }[]>();
    for (const mo of openMos) {
      const lastOp = mo.operations[mo.operations.length - 1];
      if (mo.status === 'PLANNED') {
        // not started — its full quantity is still expected as final output
        const list = plannedMosByPart.get(mo.partId) ?? [];
        list.push({ moNumber: mo.moNumber, remaining: dec(mo.quantity).minus(lastOp ? dec(lastOp.producedQuantity) : Q0) });
        plannedMosByPart.set(mo.partId, list);
      }
      for (const op of mo.operations) {
        const key = `${mo.partId}:${op.operationId}`;
        const entry = wipMap.get(key) ?? { readyForTransfer: Q0, arriving: Q0, committed: Q0, mos: new Set<string>() };
        entry.readyForTransfer = entry.readyForTransfer.plus(dec(op.producedQuantity).minus(dec(op.transferredOutQuantity)));
        entry.arriving = entry.arriving.plus(dec(op.receivedQuantity).plus(dec(op.reworkQuantity)).minus(dec(op.inputQuantity)));
        entry.committed = entry.committed.plus(
          dec(op.plannedQuantity).minus(dec(op.producedQuantity)).minus(dec(op.scrappedQuantity)).minus(dec(op.rejectedQuantity)),
        );
        entry.mos.add(mo.moNumber);
        wipMap.set(key, entry);
      }
    }

    // --------------------------------------- 3) machine workload (estimated)
    const workload = new Map<string, number>(); // machineId → estimated minutes
    for (const mo of openMos) {
      for (const op of mo.operations) {
        if (!op.machineId) continue;
        const remaining = dec(op.plannedQuantity).minus(dec(op.producedQuantity)).minus(dec(op.scrappedQuantity)).minus(dec(op.rejectedQuantity));
        if (remaining.comparedTo(0) <= 0) continue;
        const secondsPerUnit =
          op.routeStep?.cycleTimeSec != null
            ? dec(op.routeStep.cycleTimeSec)
            : capRate.get(`${op.machineId}:${op.operationId}`) != null && capRate.get(`${op.machineId}:${op.operationId}`)!.comparedTo(0) > 0
              ? new D(3600).div(capRate.get(`${op.machineId}:${op.operationId}`)!)
              : dec(0);
        const minutes = secondsPerUnit.comparedTo(0) > 0 ? remaining.mul(secondsPerUnit).div(60).toNumber() : 0;
        workload.set(op.machineId, (workload.get(op.machineId) ?? 0) + minutes);
      }
    }

    // ------------------------------------------------- 4) run engine per part
    const planLinesData: {
      lineNo: number;
      partId: string;
      plannedQuantity: Dec;
      customerOrderLineId: string | null;
      routeId: string | null;
      routeVersion: number | null;
      dueDate: Date | null;
      grossQuantity: Dec;
      coveredByStock: Dec;
      coveredByReservations: Dec;
      coveredByWip: Dec;
      coveredByPlannedMos: Dec;
      feasible: boolean;
      detail: unknown;
      operations: {
        sequence: number;
        operationId: string;
        routeStepId: string | null;
        requiredOutput: Dec;
        wipQuantity: Dec;
        wipUsed: Dec;
        mustProduce: Dec;
        requiredInput: Dec;
        arrivingQuantity: Dec;
        timeSource: string | null;
        estimatedHours: Dec | null;
        setupMinutes: number | null;
        setupSource: string | null;
        feasible: boolean;
        infeasibleReasons: string[];
        missingInfo: string[];
        recommendedMachineId: string | null;
        recommendedDieId: string | null;
        recommendedMachineCode: string | null;
        recommendedDieCode: string | null;
        recommendedRank: number | null;
        candidates: unknown;
      }[];
      shortages: {
        materialId: string;
        severity: string;
        requiredQuantity: Dec;
        availableQuantity: Dec;
        consignmentQuantity: Dec;
        shortageQuantity: Dec;
        coveredByOpenContracts: Dec;
        contractInfo: unknown;
        notes: string | null;
      }[];
    }[] = [];

    let totalShortages = 0;
    let totalInfeasible = 0;
    let totalNetRequirement = Q0;
    const globalWarnings: string[] = [];

    for (const [partId, demandEntry] of demand.byPart) {
      const part = orders.flatMap((o) => o.lines).find((l) => l.partId === partId)?.part;
      const partMeta = part ?? { id: partId, partNumber: '?', nameFa: '?', baseUnit: { code: '' } };

      // --- inventory supply (finished goods)
      const fgRows = (await tx.stockBalance.findMany({
        where: { partId, warehouseId: { in: [...fgWhIds] }, quantity: { gt: 0 } },
        select: { quantity: true, ownership: true, qualityStatus: true },
      })) as { quantity: Prisma.Decimal.Value; ownership: string; qualityStatus: string }[];
      const fg = computeFgAvailability(fgRows.map((r) => ({ partId, quantity: r.quantity, ownership: r.ownership, qualityStatus: r.qualityStatus })));

      const reservationRows = await tx.inventoryReservation.findMany({
        where: { partId, status: { in: ['ACTIVE', 'EXPIRED', 'RELEASED', 'CONSUMED'] } },
        select: { id: true, quantity: true, status: true, expiresAt: true, forCustomerOrderLineId: true, forManufacturingOrderId: true },
      });

      // --- route (ACTIVE, latest version)
      const route = await tx.partRoute.findFirst({
        where: { partId, status: 'ACTIVE' },
        orderBy: { version: 'desc' },
        include: { steps: { orderBy: { sequence: 'asc' }, include: { operation: true, die: true } } },
      });

      // --- per-line netting (reservations for the line first, then FIFO free stock)
      let freeRemaining = fg.usable;
      const netted: {
        lineResult: ReturnType<typeof netLine>['result'];
        reservationSplit: ReturnType<typeof splitReservations>;
      }[] = [];
      for (const line of demandEntry.lines) {
        const split = splitReservations(reservationRows, line.lineId);
        const { result, freeRemaining: updated } = netLine({ line, reservedForThisLine: split.forThisLine }, freeRemaining);
        freeRemaining = updated;
        netted.push({ lineResult: result, reservationSplit: split });
      }

      // aggregate per part across lines (each line becomes its own plan line;
      // FG-stock coverage was allocated FIFO across the sorted lines)
      const partGross = demandEntry.gross;
      const partCoveredByStock = netted.reduce((acc, n) => acc.plus(n.lineResult.coveredByStock), Q0);
      const partCoveredByReservations = netted.reduce((acc, n) => acc.plus(n.lineResult.coveredByReservations), Q0);
      const partNetBeforeMos = netted.reduce((acc, n) => acc.plus(n.lineResult.netRequirement), Q0);

      const committedMos = plannedMosByPart.get(partId) ?? [];
      const committedTotal = committedMos.reduce((acc, m) => acc.plus(m.remaining), Q0);

      // --- WIP netting across operations (stage-based backward pass)
      const wipOps: WipOpSnapshot[] = route
        ? route.steps.map((step) => {
            const w = wipMap.get(`${partId}:${step.operationId}`);
            return {
              sequence: step.sequence,
              operationId: step.operationId,
              operationCode: step.operation.code,
              operationNameFa: step.operation.nameFa,
              readyForTransfer: w?.readyForTransfer ?? Q0,
              arriving: w?.arriving ?? Q0,
              committedRemaining: w?.committed ?? Q0,
              scrapFactorPct: step.scrapFactorPct,
            };
          })
        : [];
      const wipNet = netWipAcrossOperations(partNetBeforeMos, wipOps);

      // planned-quantity for the proposed MO = new final production needed
      const proposedMoQty = wipNet.mustProduceFinal;

      // ------------------------------------------------ machine recommendations
      const opPlans: typeof planLinesData[number]['operations'] = [];
      const missingInfo: string[] = [];
      const warnings: string[] = [...globalWarnings];
      let opsFeasible = true;

      for (const step of route?.steps ?? []) {
        const chain = wipNet.operations.find((o) => o.operationId === step.operationId);
        const mustProduce = chain ? dec(chain.mustProduce) : Q0;
        const candidates: MachineCandidate[] = [];
        let timeSource: string | null = null;
        let estimatedHours: Dec | null = null;
        let setupMinutes: number | null = null;
        let setupSource: string | null = null;
        const opMissing: string[] = [];
        const opInfeasible: string[] = [...(chain?.infeasibleReasons ?? [])];

        if (mustProduce.comparedTo(0) > 0) {
          for (const machine of allMachines) {
            const die = step.die ?? null;
            const candidate = evaluateMachine({
              machine: {
                id: machine.id,
                code: machine.code,
                nameFa: machine.nameFa,
                machineType: machine.machineType,
                tonnage: machine.tonnage,
                status: machine.status,
              },
              operation: {
                id: step.operation.id,
                code: step.operation.code,
                nameFa: step.operation.nameFa,
                requiresDie: step.operation.requiresDie,
                defaultSetupTimeMin: step.operation.defaultSetupTimeMin,
                defaultCycleTimeSec: step.operation.defaultCycleTimeSec,
              },
              routeStep: {
                dieId: step.dieId,
                requiredTonnage: step.requiredTonnage,
                setupTimeMin: step.setupTimeMin,
                cycleTimeSec: step.cycleTimeSec,
                machineId: step.machineId,
              },
              capabilityRatePerHour: capRate.get(`${machine.id}:${step.operationId}`) ?? null,
              die: die ? { id: die.id, code: die.code, nameFa: die.nameFa, status: die.status } : null,
              compatibleDieMachineIds: step.dieId ? dieCompatMap.get(step.dieId) ?? new Set() : new Set(),
              minutesPerDay: capacity.minutes,
              workloadMinutes: workload.get(machine.id) ?? 0,
              quantity: mustProduce,
              now,
            });
            candidates.push(candidate);
          }
          rankCandidates(candidates, { routeStepMachineId: step.machineId });

          const best = candidates.find((c) => c.rank === 1) ?? null;
          if (best) {
            timeSource = best.timeSource;
            estimatedHours = best.requiredHours;
            setupMinutes = best.setupMinutes;
            setupSource = best.setupSource;
          } else {
            opsFeasible = false;
            opInfeasible.push('هیچ ماشین واجد شرایطی برای این عملیات یافت نشد');
          }
          for (const c of candidates) {
            if (c.eligible) {
              for (const w of c.warningsFa) if (!opMissing.includes(w)) opMissing.push(w);
            }
          }
        } else if (!chain) {
          opMissing.push('این عملیات در زنجیره قطع‌بوش WIP یافت نشد');
        }

        opPlans.push({
          sequence: step.sequence,
          operationId: step.operationId,
          routeStepId: step.id,
          requiredOutput: chain ? dec(chain.requiredOutput) : Q0,
          wipQuantity: chain ? dec(chain.wipQuantity) : Q0,
          wipUsed: chain ? dec(chain.wipUsed) : Q0,
          mustProduce,
          requiredInput: chain ? dec(chain.requiredInput) : Q0,
          arrivingQuantity: chain ? dec(chain.arrivingQuantity) : Q0,
          timeSource,
          estimatedHours,
          setupMinutes,
          setupSource,
          feasible: opInfeasible.length === 0,
          infeasibleReasons: opInfeasible,
          missingInfo: opMissing,
          recommendedMachineId: candidates.find((c) => c.rank === 1)?.machineId ?? null,
          recommendedDieId: step.dieId,
          recommendedMachineCode: candidates.find((c) => c.rank === 1)?.machineCode ?? null,
          recommendedDieCode: step.die?.code ?? null,
          recommendedRank: candidates.find((c) => c.rank === 1)?.rank ?? null,
          candidates: candidates.map((c) => ({
            ...c,
            estimatedStart: c.estimatedStart?.toISOString() ?? null,
            estimatedEnd: c.estimatedEnd?.toISOString() ?? null,
          })),
        });
        if (opMissing.length) missingInfo.push(...opMissing);
      }

      if (!route) {
        missingInfo.push('مسیر تولید ACTIVE برای این قطعه تعریف نشده است — امکان محاسبه عملیات و ماشین نیست');
        opsFeasible = false;
      }

      // ------------------------------------------------- material shortages
      const shortageRows: typeof planLinesData[number]['shortages'] = [];
      let materialHardShortage = false;
      if (route && wipNet.firstOpRequiredInput.comparedTo(0) > 0) {
        const bom = bomRows.filter((b) => b.partId === partId);
        const materialIds = bom.map((b) => b.materialId);
        const partMaterialBalance = materialBalances.filter((b) => materialIds.includes(b.materialId as string));
        const { shortages } = computeMaterialShortages(
          wipNet.firstOpRequiredInput,
          bom.map((b) => ({
            materialId: b.materialId,
            materialCode: b.material.materialCode,
            materialNameFa: b.material.nameFa,
            unitCode: b.material.baseUnit.code,
            quantityPerUnit: b.quantityPerUnit,
            weightKgPerUnit: b.weightKgPerUnit,
          })),
          partMaterialBalance.map((s) => ({ materialId: s.materialId as string, quantity: s.quantity, ownership: s.ownership, qualityStatus: s.qualityStatus })),
          openContracts.map((c) => ({
            id: c.id,
            contractNumber: c.contractNumber,
            materialId: c.materialId,
            totalQuantity: c.totalQuantity,
            receivedQuantity: c.transactions.reduce((acc, t) => acc.plus(dec(t.quantity)), Q0),
            expectedDeliveryDate: c.expectedDeliveryDate,
            status: c.status,
          })),
        );
        for (const s of shortages) {
          shortageRows.push({
            materialId: s.materialId,
            severity: s.severity,
            requiredQuantity: dec(s.requiredQuantity),
            availableQuantity: dec(s.availableQuantity),
            consignmentQuantity: dec(s.consignmentQuantity),
            shortageQuantity: dec(s.shortageQuantity),
            coveredByOpenContracts: dec(s.coveredByOpenContracts),
            contractInfo: s.contractInfo,
            notes: s.notes.join(' | ') || null,
          });
          if (s.severity === 'SHORTAGE') materialHardShortage = true;
          if (s.severity !== 'OK') totalShortages += 1;
        }
        if (bom.length === 0 && partMeta) {
          missingInfo.push('سرانه مصرف مواد (BOM) برای این قطعه تعریف نشده است — محاسبه کسری مواد انجام نشد');
        }
      }

      const feasible = opsFeasible && !materialHardShortage;
      if (!feasible) totalInfeasible += 1;
      totalNetRequirement = totalNetRequirement.plus(proposedMoQty);

      const primaryLine = netted[0]?.lineResult.line ?? null;
      planLinesData.push({
        lineNo: 0, // assigned at insert time
        partId,
        plannedQuantity: proposedMoQty,
        customerOrderLineId: netted.length === 1 ? primaryLine?.lineId ?? null : null,
        routeId: route?.id ?? null,
        routeVersion: route?.version ?? null,
        dueDate: netted[0]?.lineResult.line.dueDate ?? null,
        grossQuantity: partGross,
        coveredByStock: partCoveredByStock,
        coveredByReservations: partCoveredByReservations,
        coveredByWip: wipNet.coveredByWip,
        coveredByPlannedMos: wipNet.coveredByCommittedMos,
        feasible,
        detail: {
          part: { partNumber: partMeta.partNumber, nameFa: partMeta.nameFa, unit: partMeta.baseUnit.code },
          demandLines: netted.map((n) => ({
            ...n.lineResult.line,
            coveredByReservations: fmt(n.lineResult.coveredByReservations),
            coveredByStock: fmt(n.lineResult.coveredByStock),
            netRequirement: fmt(n.lineResult.netRequirement),
            reservationIgnored: n.reservationSplit.ignored,
          })),
          finishedGoods: {
            usable: fmt(fg.usable),
            quarantined: fmt(fg.quarantined),
            consignment: fmt(fg.consignment),
            breakdown: fg.breakdown,
          },
          committedOpenMos: committedMos.map((m) => ({ moNumber: m.moNumber, remainingFinalOutput: fmt(m.remaining) })),
          wipChain: wipNet.operations,
          wipWithoutRouteStep: [...wipMap.entries()]
            .filter(([key, w]) => key.startsWith(`${partId}:`) && w.readyForTransfer.comparedTo(0) > 0 && !route?.steps.some((s) => s.operationId === key.split(':')[1]))
            .map(([key, w]) => ({ operationId: key.split(':')[1], readyForTransfer: fmt(w.readyForTransfer), note: 'WIP در عملیاتی خارج از مسیر تولید جاری — در قطع‌بوش لحاظ نشد' })),
          missingInfo: [...new Set(missingInfo)],
          warnings,
        },
        operations: opPlans,
        shortages: shortageRows,
      });
    }

    if (demand.skippedLines.length > 0) {
      globalWarnings.push(`${demand.skippedLines.length} ردیف سفارش از تقاضا حذف شد (تحویل‌شده/لغوشده/پیش‌نویس) — جزئیات در detail`);
    }

    // ------------------------------------------------- 5) persist plan snapshot
    const planNumber = await generateDocumentNumber(tx, 'PP');
    const lastPlan = await tx.productionPlan.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, version: true } });
    const version = (lastPlan?.version ?? 0) + 1;

    // supersede existing DRAFT plans (versioning: a new run replaces drafts)
    await tx.productionPlan.updateMany({ where: { status: 'DRAFT' }, data: { status: 'SUPERSEDED' } });

    const periodStart = now;
    const horizonDays = input.horizonDays ?? 30;
    const periodEnd = new Date(now.getTime() + horizonDays * 24 * 3600 * 1000);

    const created = await tx.productionPlan.create({
      data: {
        planNumber,
        title: `برنامه پیشنهادی تولید — نسخه ${version}`,
        periodStart,
        periodEnd,
        status: 'DRAFT',
        description: input.notes ?? null,
        createdById: userId,
        version,
        revisionOfId: lastPlan?.id ?? null,
        planningRunAt: now,
        planningParams: {
          orderIds: input.orderIds ?? null,
          partIds: input.partIds ?? null,
          dueFrom: input.dueFrom ?? null,
          dueTo: input.dueTo ?? null,
          horizonDays,
          shiftMinutesPerDay: capacity.minutes,
          shiftsUsed: capacity.shifts.map((s) => s.code),
        },
        summary: {
          partsPlanned: planLinesData.length,
          feasibleLines: planLinesData.filter((l) => l.feasible).length,
          infeasibleLines: totalInfeasible,
          materialShortageRows: totalShortages,
          totalGrossDemand: fmt([...demand.byPart.values()].reduce((acc, e) => acc.plus(e.gross), Q0)),
          totalCoveredByStock: fmt(planLinesData.reduce((acc, l) => acc.plus(l.coveredByStock), Q0)),
          totalCoveredByReservations: fmt(planLinesData.reduce((acc, l) => acc.plus(l.coveredByReservations), Q0)),
          totalCoveredByWip: fmt(planLinesData.reduce((acc, l) => acc.plus(l.coveredByWip), Q0)),
          totalCoveredByOpenMos: fmt(planLinesData.reduce((acc, l) => acc.plus(l.coveredByPlannedMos), Q0)),
          totalNetRequirement: fmt(totalNetRequirement),
          warnings: globalWarnings,
          generatedAt: now.toISOString(),
        },
        lines: {
          create: planLinesData.map((l, i) => ({
            lineNo: i + 1,
            partId: l.partId,
            plannedQuantity: l.plannedQuantity,
            customerOrderLineId: l.customerOrderLineId,
            routeId: l.routeId,
            routeVersion: l.routeVersion,
            dueDate: l.dueDate,
            grossQuantity: l.grossQuantity,
            coveredByStock: l.coveredByStock,
            coveredByReservations: l.coveredByReservations,
            coveredByWip: l.coveredByWip,
            coveredByPlannedMos: l.coveredByPlannedMos,
            feasible: l.feasible,
            detail: l.detail as Prisma.InputJsonValue,
            planOperations: {
              create: l.operations.map((op) => ({
                sequence: op.sequence,
                operationId: op.operationId,
                routeStepId: op.routeStepId,
                requiredOutput: op.requiredOutput,
                wipQuantity: op.wipQuantity,
                wipUsed: op.wipUsed,
                mustProduce: op.mustProduce,
                requiredInput: op.requiredInput,
                arrivingQuantity: op.arrivingQuantity,
                timeSource: op.timeSource,
                estimatedHours: op.estimatedHours,
                setupMinutes: op.setupMinutes,
                setupSource: op.setupSource,
                feasible: op.feasible,
                infeasibleReasons: op.infeasibleReasons as Prisma.InputJsonValue,
                missingInfo: op.missingInfo as Prisma.InputJsonValue,
                recommendedMachineId: op.recommendedMachineId,
                recommendedDieId: op.recommendedDieId,
                recommendedMachineCode: op.recommendedMachineCode,
                recommendedDieCode: op.recommendedDieCode,
                recommendedRank: op.recommendedRank,
                candidates: op.candidates as Prisma.InputJsonValue,
              })),
            },
            materialShortages: {
              create: l.shortages.map((s) => ({
                materialId: s.materialId,
                severity: s.severity,
                requiredQuantity: s.requiredQuantity,
                availableQuantity: s.availableQuantity,
                consignmentQuantity: s.consignmentQuantity,
                shortageQuantity: s.shortageQuantity,
                coveredByOpenContracts: s.coveredByOpenContracts,
                contractInfo: s.contractInfo as Prisma.InputJsonValue,
                notes: s.notes,
              })),
            },
          })),
        },
      },
      include: { lines: { include: { part: { select: { partNumber: true, nameFa: true } } } } },
    });

    await recordAudit(tx, {
      userId,
      action: 'PLANNING_RUN',
      entityType: 'ProductionPlan',
      entityId: created.id,
      changes: { planNumber, version, parts: planLinesData.length },
      ipAddress: meta.ip,
      userAgent: meta.ua,
    });

    return created;
  });

  return plan;
}

// ---------------------------------------------------------------------------
// plan queries + workflow
// ---------------------------------------------------------------------------

export async function listPlans(take = 30) {
  const plans = await db.productionPlan.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      createdBy: { select: { username: true, fullName: true } },
      revisionOf: { select: { planNumber: true, version: true } },
      _count: { select: { lines: true } },
    },
  });
  return plans.map((p) => ({
    id: p.id,
    planNumber: p.planNumber,
    title: p.title,
    version: p.version,
    status: p.status,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    planningRunAt: p.planningRunAt,
    summary: p.summary,
    revisionOf: p.revisionOf,
    createdBy: p.createdBy,
    lineCount: p._count.lines,
    createdAt: p.createdAt,
  }));
}

export async function getPlan(id: string) {
  const plan = await db.productionPlan.findUnique({
    where: { id },
    include: {
      createdBy: { select: { username: true, fullName: true } },
      confirmedBy: { select: { username: true, fullName: true } },
      revisionOf: { select: { id: true, planNumber: true, version: true } },
      revisions: { select: { id: true, planNumber: true, version: true, status: true } },
      lines: {
        orderBy: { lineNo: 'asc' },
        include: {
          part: { select: { partNumber: true, nameFa: true, baseUnit: { select: { code: true } } } },
          route: { select: { version: true, name: true } },
          planOperations: {
            orderBy: { sequence: 'asc' },
            include: { operation: { select: { code: true, nameFa: true } } },
          },
          materialShortages: {
            include: { material: { select: { materialCode: true, nameFa: true, baseUnit: { select: { code: true } } } } },
          },
        },
      },
    },
  });
  if (!plan) throw new ApiError(404, 'Plan not found', 'برنامه تولید یافت نشد', 'plan_not_found');
  return plan;
}

export async function confirmPlan(id: string, userId: string, meta: { ip?: string; ua?: string }) {
  return db.$transaction(async (tx) => {
    const plan = await tx.productionPlan.findUnique({ where: { id } });
    if (!plan) throw new ApiError(404, 'Plan not found', 'برنامه تولید یافت نشد', 'plan_not_found');
    if (plan.status !== 'DRAFT') {
      throw new ApiError(409, 'Only DRAFT plans can be confirmed', 'فقط برنامه‌های پیش‌نویس قابل تأیید هستند', 'plan_status');
    }
    const updated = await tx.productionPlan.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: userId },
    });
    await recordAudit(tx, { userId, action: 'CONFIRM', entityType: 'ProductionPlan', entityId: id, changes: { planNumber: plan.planNumber, version: plan.version }, ipAddress: meta.ip, userAgent: meta.ua });
    return updated;
  });
}

export async function cancelPlan(id: string, userId: string, meta: { ip?: string; ua?: string }) {
  return db.$transaction(async (tx) => {
    const plan = await tx.productionPlan.findUnique({ where: { id } });
    if (!plan) throw new ApiError(404, 'Plan not found', 'برنامه تولید یافت نشد', 'plan_not_found');
    if (plan.status !== 'DRAFT') {
      throw new ApiError(409, 'Only DRAFT plans can be cancelled', 'فقط برنامه‌های پیش‌نویس قابل ابطال هستند', 'plan_status');
    }
    const updated = await tx.productionPlan.update({ where: { id }, data: { status: 'CANCELLED' } });
    await recordAudit(tx, { userId, action: 'CANCEL', entityType: 'ProductionPlan', entityId: id, changes: { planNumber: plan.planNumber, version: plan.version }, ipAddress: meta.ip, userAgent: meta.ua });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// planning dashboard
// ---------------------------------------------------------------------------

export async function getPlanningDashboard(filters: PlanningFilters = {}) {
  const openOrders = await db.customerOrder.count({ where: { status: { in: ['CONFIRMED', 'IN_PRODUCTION', 'PARTIALLY_DELIVERED'] } } });
  const openLines = await db.customerOrderLine.findMany({
    where: {
      status: { in: ['OPEN', 'IN_PRODUCTION'] },
      order: { status: { in: ['CONFIRMED', 'IN_PRODUCTION', 'PARTIALLY_DELIVERED'] } },
      ...(filters.partIds?.length ? { partId: { in: filters.partIds } } : {}),
      ...(filters.dueFrom || filters.dueTo
        ? { dueDate: { ...(filters.dueFrom ? { gte: dateAtUtc(filters.dueFrom) } : {}), ...(filters.dueTo ? { lte: dateAtUtc(filters.dueTo) } : {}) } }
        : {}),
    },
    select: { partId: true, quantity: true, deliveredQuantity: true },
  });
  const demandByPart = new Map<string, Dec>();
  for (const l of openLines) {
    demandByPart.set(l.partId, (demandByPart.get(l.partId) ?? Q0).plus(dec(l.quantity).minus(dec(l.deliveredQuantity))));
  }
  const latestPlan = await db.productionPlan.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { lines: true } } },
  });
  const openMos = await db.manufacturingOrder.count({ where: { status: { in: ['PLANNED', 'RELEASED', 'IN_PROGRESS'] } } });
  const activeMachines = await db.machine.count({ where: { status: 'ACTIVE' } });
  const totalMachines = await db.machine.count();

  return {
    openOrders,
    openLines: openLines.length,
    demandParts: demandByPart.size,
    totalRemainingDemand: fmt([...demandByPart.values()].reduce((acc, v) => acc.plus(v), Q0)),
    latestPlan: latestPlan
      ? {
          id: latestPlan.id,
          planNumber: latestPlan.planNumber,
          version: latestPlan.version,
          status: latestPlan.status,
          planningRunAt: latestPlan.planningRunAt,
          summary: latestPlan.summary,
          lineCount: latestPlan._count.lines,
        }
      : null,
    openMos,
    machines: { active: activeMachines, total: totalMachines },
    generatedAt: new Date().toISOString(),
  };
}
