import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/**
 * Runtime system settings for the UI (تنظیمات سامانه — قابل شخصی‌سازی).
 * Nothing is hardcoded in components: default supplier name, factory name,
 * calendar … all come from SystemSetting via /settings/public and the user
 * can change them on the settings page at any time.
 */
export interface AppSettings {
  'factory.name': string;
  'materials.defaultSupplierName': string;
  'inventory.allowNegativeStock': string;
  'app.calendar': string;
}

const EMPTY: AppSettings = {
  'factory.name': '',
  'materials.defaultSupplierName': '',
  'inventory.allowNegativeStock': 'false',
  'app.calendar': 'jalali',
};

// module-level cache shared by every mounted hook (one fetch per session)
let cache: AppSettings | null = null;
let inflight: Promise<AppSettings> | null = null;

async function fetchSettings(): Promise<AppSettings> {
  if (cache) return cache;
  if (!inflight) {
    inflight = api<{ settings: AppSettings }>('/settings/public')
      .then((res) => {
        cache = res.settings;
        return res.settings;
      })
      .catch(() => EMPTY)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(cache ?? EMPTY);
  const [loading, setLoading] = useState(!cache);

  const reload = useCallback(async () => {
    cache = null;
    setLoading(true);
    const s = await fetchSettings();
    setSettings(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchSettings().then((s) => setSettings(s));
  }, []);

  return { settings, loading, reload };
}

/** One-shot read for non-component code. */
export function getAppSettings(): Promise<AppSettings> {
  return fetchSettings();
}
