/** Single source of truth for the KPIMS module map (mirrored in the frontend for icons). */
export interface ModuleInfo {
  key: string;
  titleFa: string;
  titleEn: string;
  status: 'ready' | 'planned';
}

export const MODULES: ModuleInfo[] = [
  { key: 'dashboard', titleFa: 'داشبورد', titleEn: 'Dashboard', status: 'ready' },
  { key: 'master-data', titleFa: 'اطلاعات پایه', titleEn: 'Master Data', status: 'ready' },
  { key: 'inventory', titleFa: 'انبار', titleEn: 'Inventory', status: 'ready' },
  { key: 'production', titleFa: 'تولید', titleEn: 'Production', status: 'ready' },
  { key: 'wip', titleFa: 'قطعات در جریان ساخت', titleEn: 'WIP', status: 'ready' },
  { key: 'production-planning', titleFa: 'برنامه‌ریزی تولید', titleEn: 'Production Planning', status: 'ready' },
  { key: 'machines', titleFa: 'ماشین‌آلات و ظرفیت', titleEn: 'Machines and Capacity', status: 'ready' },
  { key: 'sapco-materials', titleFa: 'قراردادها و مواد تأمین‌کننده', titleEn: 'Supplier Materials & Contracts', status: 'ready' },
  { key: 'reports', titleFa: 'گزارش‌ها', titleEn: 'Reports', status: 'ready' },
  { key: 'settings', titleFa: 'کاربران و تنظیمات', titleEn: 'Users and Settings', status: 'ready' },
];
