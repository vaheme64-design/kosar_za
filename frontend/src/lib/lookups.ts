import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/** Compact master-data lookups for the operational forms (read-only endpoint). */
export interface Lookups {
  parts: { id: string; partNumber: string; nameFa: string; baseUnitId: string; standardWeightKg: string | null; partType: string }[];
  materials: { id: string; materialCode: string; nameFa: string; baseUnitId: string; unitWeightKg: string | null; supplierName: string; materialType: string }[];
  warehouses: { id: string; code: string; nameFa: string; warehouseType: string }[];
  locations: { id: string; warehouseId: string; code: string; nameFa: string }[];
  units: { id: string; code: string; nameFa: string; kind: string }[];
  lots: { id: string; materialId: string; lotNumber: string; quantityRemaining: string; weightRemainingKg: string; ownership: string; status: string }[];
  contracts: { id: string; contractNumber: string; materialId: string; supplierName: string; status: string }[];
  shifts: { id: string; code: string; nameFa: string }[];
  machines: { id: string; code: string; nameFa: string; machineType: string }[];
  customers: { id: string; code: string; nameFa: string }[];
  routes: { id: string; partId: string; version: number; name: string | null }[];
  operations: { id: string; code: string; nameFa: string }[];
  dies: { id: string; code: string; nameFa: string; status: string }[];
}

const EMPTY: Lookups = {
  parts: [], materials: [], warehouses: [], locations: [], units: [],
  lots: [], contracts: [], shifts: [], machines: [], customers: [], routes: [], operations: [], dies: [],
};

/** Fetch (and cache per mount) the master-data lookups. `reload` re-fetches (e.g. after creating a contract). */
export function useLookups() {
  const [lookups, setLookups] = useState<Lookups>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<Lookups>('/master-data/lookups');
      setLookups(res);
      setError(null);
      return res;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در دریافت اطلاعات پایه');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  return { lookups, loading, error, reload: fetchAll };
}
