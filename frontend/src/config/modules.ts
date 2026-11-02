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
    descriptionFa: 'قطعات، مواد و کویل، سرانه مصرف (BOM)، مسیر تولید نسخه‌بندی‌شده، عملیات، انبارها، شیفت‌ها و مشتریان — همه با جستجو، ورود و خروجی اکسل',
    icon: Database,
    status: 'ready',
    entities: ['قطعات', 'مواد اولیه', 'سرانه مصرف (BOM)', 'واحدهای شمارش', 'عملیات', 'مسیرهای تولید (نسخه‌بندی‌شده)', 'انبارها و موقعیت‌ها', 'شیفت‌ها', 'مشتریان'],
  },
  {
    key: 'inventory',
    path: '/inventory',
    titleFa: 'انبار',
    titleEn: 'Inventory',
    descriptionFa: 'رسید، حواله، انتقال، اصلاحیه، موجودی رسمی، رزرو و دفتر کل حرکت موجودی',
    icon: Boxes,
    status: 'ready',
    entities: ['سندهای انبار', 'ردیف‌های سند', 'تراکنش‌های دفتر کل', 'موجودی رسمی (Stock Balances)', 'رزرو موجودی', 'لوت‌های ماده اولیه'],
  },
  {
    key: 'production',
    path: '/production',
    titleFa: 'تولید',
    titleEn: 'Production',
    descriptionFa: 'دستور کارها، عملیات مسیر تولید، گزارش تولید، ضایعات و انتقالات بین عملیاتی',
    icon: Factory,
    status: 'ready',
    entities: ['سفارش‌های مشتری', 'دستور کار ساخت (MO)', 'عملیات اجرایی', 'گزارش‌های تولید', 'ضایعات', 'انتقالات بین عملیاتی', 'تخصیص ماشین'],
  },
  {
    key: 'wip',
    path: '/wip',
    titleFa: 'قطعات در جریان ساخت',
    titleEn: 'WIP',
    descriptionFa: 'موجودی در انتظار، در جریان پردازش، آماده انتقال و قداره در هر عملیات',
    icon: Workflow,
    status: 'ready',
    entities: ['موجودی WIP به تفکیک عملیات', 'انتقالات WIP', 'انبارهای در جریان ساخت'],
  },
  {
    key: 'production-planning',
    path: '/production-planning',
    titleFa: 'برنامه‌ریزی تولید',
    titleEn: 'Production Planning',
    descriptionFa: 'محاسبه نیاز خالص تولید از سفارش‌ها، موجودی، WIP و پیشنهاد ماشین هر عملیات با ذکر دلیل',
    icon: CalendarClock,
    status: 'ready',
    entities: ['سفارش‌های مشتری (ورودی برنامه)', 'برنامه‌های تولید نسخه‌بندی‌شده', 'قطع‌بوش تقاضا/موجودی/WIP', 'پیشنهاد دستور کار', 'پیشنهاد ماشین و ظرفیت', 'کسری مواد اولیه'],
  },
  {
    key: 'machines',
    path: '/machines',
    titleFa: 'ماشین‌آلات و ظرفیت',
    titleEn: 'Machines and Capacity',
    descriptionFa: 'پرس‌ها و ایستگاه‌ها با وضعیت عملیاتی، توانمندی ماشین–عملیات (نرخ استاندارد)، سازگاری قالب و نمای ظرفیت روزانه',
    icon: Gauge,
    status: 'ready',
    entities: ['ماشین‌آلات', 'توانمندی ماشین–عملیات', 'سازگاری قالب–ماشین', 'ظرفیت موجود شیفت‌ها'],
  },
  {
    key: 'sapco-materials',
    path: '/sapco-materials',
    titleFa: 'مواد SAPCO',
    titleEn: 'SAPCO Materials',
    descriptionFa: 'گزارش حساب ورق SAPCO (افتتاحیه/دریافت/مصرف/پایان دوره به کیلوگرم)، قراردادها و لوت‌های امانی',
    icon: Truck,
    status: 'ready',
    entities: ['قراردادهای ماده اولیه', 'تراکنش‌های قرارداد', 'لوت‌های دریافتی'],
  },
  {
    key: 'reports',
    path: '/reports',
    titleFa: 'گزارش‌ها',
    titleEn: 'Reports',
    descriptionFa: '۱۳ گزارش مدیریتی: برنامه در مقابل عملکرد، اقلای سفارش، Backlog، WIP و قداره، مصرف در مقابل سرانه، حساب SAPCO، ضایعات، بار ماشین، تأخیرها، حرکت و تطبیق موجودی',
    icon: BarChart3,
    status: 'ready',
    entities: ['برنامه در مقابل عملکرد', 'اقلای سفارش مشتری', 'کار در انتظار تولید', 'WIP و قداره', 'مصرف ماده در مقابل سرانه', 'حساب مواد SAPCO', 'ضایعات', 'بار و ظرفیت ماشین', 'تأخیرهای تولید', 'حرکت و تطبیق موجودی'],
  },
  {
    key: 'settings',
    path: '/settings',
    titleFa: 'کاربران و تنظیمات',
    titleEn: 'Users and Settings',
    descriptionFa: 'مدیریت کاربران و نقش‌ها (RBAC)، شماره‌گذاری اسناد، تنظیمات سامانه و لاگ حسابرسی با خروجی اکسل',
    icon: Settings,
    status: 'ready',
    entities: ['کاربران', 'نقش‌ها و مجوزها', 'دنباله‌های شماره سند', 'تنظیمات سامانه', 'لاگ حسابرسی'],
  },
];

export const getModule = (key: string): ModuleDef | undefined => MODULES.find((m) => m.key === key);
