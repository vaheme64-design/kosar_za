/** Single source of truth for the KPIMS module map (mirrored in the frontend for icons). */
export interface ModuleInfo {
  key: string;
  titleFa: string;
  titleEn: string;
  status: 'ready' | 'planned';
}

export const MODULES: ModuleInfo[] = [
  { key: 'dashboard', titleFa: 'داشبورد', titleEn: 'Dashboard', status: 'ready' },
  { key: 'master-data', titleFa: 'اطلاعات پایه', titleEn: 'Master Data', status: 'planned' },
  { key: 'inventory', titleFa: 'انبار', titleEn: 'Inventory', status: 'planned' },
  { key: 'production', titleFa: 'تولید', titleEn: 'Production', status: 'planned' },
  { key: 'wip', titleFa: 'قطعات در جریان ساخت', titleEn: 'WIP', status: 'planned' },
  { key: 'production-planning', titleFa: 'برنامه‌ریزی تولید', titleEn: 'Production Planning', status: 'planned' },
  { key: 'machines', titleFa: 'ماشین‌آلات و ظرفیت', titleEn: 'Machines and Capacity', status: 'planned' },
  { key: 'sapco-materials', titleFa: 'مواد SAPCO', titleEn: 'SAPCO Materials', status: 'planned' },
  { key: 'reports', titleFa: 'گزارش‌ها', titleEn: 'Reports', status: 'planned' },
  { key: 'settings', titleFa: 'کاربران و تنظیمات', titleEn: 'Users and Settings', status: 'planned' },
];
