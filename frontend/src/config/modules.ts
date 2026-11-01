import {
  LayoutDashboard,
  Database,
  Boxes,
  Factory,
  Workflow,
  CalendarClock,
  Gauge,
  Truck,
  BarChart3,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface ModuleDef {
  key: string;
  path: string;
  titleFa: string;
  titleEn: string;
  descriptionFa: string;
  icon: LucideIcon;
  status: 'ready' | 'planned';
  entities?: string[];
}

/**
 * KPIMS main navigation — mirrors backend/src/config/modules.ts.
 * Status flags reflect actual implementation state (no fake pages).
 */
export const MODULES: ModuleDef[] = [
  {
    key: 'dashboard',
    path: '/',
    titleFa: 'داشبورد',
    titleEn: 'Dashboard',
    descriptionFa: 'نمای کلی سامانه، شمارنده‌های زنده از دیتابیس',
    icon: LayoutDashboard,
    status: 'ready',
  },
  {
    key: 'master-data',
    path: '/master-data',
    titleFa: 'اطلاعات پایه',
    titleEn: 'Master Data',
    descriptionFa: 'قطعات، مواد، عملیات، مسیر تولید، ماشین‌آلات، قالب‌ها، انبارها، شیفت‌ها و مشتریان',
    icon: Database,
    status: 'planned',
    entities: ['قطعات', 'مواد اولیه', 'واحدهای شمارش', 'عملیات', 'مسیرهای تولید (نسخه‌بندی‌شده)', 'ماشین‌آلات', 'قالب‌ها', 'انبارها و موقعیت‌ها', 'شیفت‌ها', 'مشتریان'],
  },
  {
    key: 'inventory',
    path: '/inventory',
    titleFa: 'انبار',
    titleEn: 'Inventory',
    descriptionFa: 'سندهای انبار، تراکنش‌های تغییرناپذیر، موجودی رسمی و رزروها',
    icon: Boxes,
    status: 'planned',
    entities: ['سندهای انبار', 'ردیف‌های سند', 'تراکنش‌های دفتر کل', 'موجودی رسمی (Stock Balances)', 'رزرو موجودی', 'لوت‌های ماده اولیه'],
  },
  {
    key: 'production',
    path: '/production',
    titleFa: 'تولید',
    titleEn: 'Production',
    descriptionFa: 'سفارش‌های مشتری، دستور کارها، گزارش تولید، ضایعات و انتقالات',
    icon: Factory,
    status: 'planned',
    entities: ['سفارش‌های مشتری', 'دستور کار ساخت (MO)', 'عملیات اجرایی', 'گزارش‌های تولید', 'ضایعات', 'انتقالات بین عملیاتی', 'تخصیص ماشین'],
  },
  {
    key: 'wip',
    path: '/wip',
    titleFa: 'قطعات در جریان ساخت',
    titleEn: 'WIP',
    descriptionFa: 'پایش موجودی نیم‌ساخته در مراحل مختلف تولید',
    icon: Workflow,
    status: 'planned',
    entities: ['موجودی WIP به تفکیک عملیات', 'انتقالات WIP', 'انبارهای در جریان ساخت'],
  },
  {
    key: 'production-planning',
    path: '/production-planning',
    titleFa: 'برنامه‌ریزی تولید',
    titleEn: 'Production Planning',
    descriptionFa: 'برنامه‌های تولید دوره‌ای و پیوند با سفارش‌های مشتری (فازهای آینده)',
    icon: CalendarClock,
    status: 'planned',
    entities: ['برنامه‌های تولید', 'ردیف‌های برنامه', 'تولید خودکار دستور کار'],
  },
  {
    key: 'machines',
    path: '/machines',
    titleFa: 'ماشین‌آلات و ظرفیت',
    titleEn: 'Machines and Capacity',
    descriptionFa: 'پرس‌ها، ایستگاه‌های برش/جوش/رنگ، توانمندی‌ها و محاسبه ظرفیت',
    icon: Gauge,
    status: 'planned',
    entities: ['ماشین‌آلات', 'توانمندی ماشین–عملیات', 'سازگاری قالب–ماشین', 'ظرفیت موجود شیفت‌ها'],
  },
  {
    key: 'sapco-materials',
    path: '/sapco-materials',
    titleFa: 'مواد SAPCO',
    titleEn: 'SAPCO Materials',
    descriptionFa: 'قراردادهای خرید ورق، دریافت‌ها و ردیابی لوت‌ها',
    icon: Truck,
    status: 'planned',
    entities: ['قراردادهای ماده اولیه', 'تراکنش‌های قرارداد', 'لوت‌های دریافتی'],
  },
  {
    key: 'reports',
    path: '/reports',
    titleFa: 'گزارش‌ها',
    titleEn: 'Reports',
    descriptionFa: 'گزارش‌های موجودی، تولید، ضایعات و عملکرد ماشین‌آلات',
    icon: BarChart3,
    status: 'planned',
    entities: ['گزارش کارت موجودی', 'گزارش مصرف ورق', 'گزارش ضایعات', 'بازده ماشین‌آلات'],
  },
  {
    key: 'settings',
    path: '/settings',
    titleFa: 'کاربران و تنظیمات',
    titleEn: 'Users and Settings',
    descriptionFa: 'مدیریت کاربران، نقش‌ها، مجوزها، شماره‌گذاری اسناد و تنظیمات سامانه',
    icon: Settings,
    status: 'planned',
    entities: ['کاربران', 'نقش‌ها و مجوزها', 'دنباله‌های شماره سند', 'تنظیمات سامانه', 'لاگ حسابرسی'],
  },
];

export const getModule = (key: string): ModuleDef | undefined => MODULES.find((m) => m.key === key);
