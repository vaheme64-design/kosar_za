import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Boxes,
  Coins,
  Cog,
  Factory,
  ListTree,
  MapPin,
  Ruler,
  Users,
  Warehouse,
  Workflow,
  Wrench,
} from 'lucide-react';
import { Page, Card } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

interface HubItem {
  to: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  managePermission?: string;
}

/**
 * Master-data hub — every entity is one click away. Each screen ships with
 * server-side search, Excel import and Excel export (جستجو، ورودی و خروجی در
 * همه‌جا — inspired by TAP production-planning software UX).
 */
export function MasterDataHomePage() {
  const { can } = useAuth();

  const items: HubItem[] = [
    { to: '/master-data/parts', title: 'قطعات (کالا)', desc: 'تعریف قطعه، واحد پایه، وزن استاندارد، ماده اصلی و مشتری', icon: <Boxes size={19} />, managePermission: 'masterdata.manage' },
    { to: '/master-data/materials', title: 'مواد اولیه و کویل', desc: 'ورق/کویل/رنگ با گرید، ابعاد، وزن واحد و تأمین‌کننده', icon: <Coins size={19} />, managePermission: 'masterdata.manage' },
    { to: '/master-data/bom', title: 'سرانه مصرف (BOM)', desc: 'مصرف ماده اولیه به ازای هر عدد قطعه — ورودی محاسبه کسری', icon: <ListTree size={19} />, managePermission: 'masterdata.manage' },
    { to: '/master-data/routes', title: 'مسیرهای تولید', desc: 'نسخه‌بندی مسیر و ترتیب عملیات، ماشین و قالب هر مرحله', icon: <Workflow size={19} />, managePermission: 'masterdata.manage' },
    { to: '/master-data/operations', title: 'عملیات تولید', desc: 'برش، خالی‌بری، خم، پرس، جوش، رنگ و مونتاژ با زمان‌های استاندارد', icon: <Cog size={19} />, managePermission: 'masterdata.manage' },
    { to: '/master-data/warehouses', title: 'انبارها و موقعیت‌ها', desc: 'انبارهای مواد/WIP/محصول/ضایعات و قفسه‌ها', icon: <Warehouse size={19} />, managePermission: 'masterdata.manage' },
    { to: '/master-data/units', title: 'واحدهای شمارش', desc: 'عدد، کیلوگرم، متر، مترمربع و برگ', icon: <Ruler size={19} />, managePermission: 'masterdata.manage' },
    { to: '/master-data/shifts', title: 'شیفت‌های کاری', desc: 'ساعت شروع و پایان شیفت‌ها — مبنای تقویم ظرفیت', icon: <Factory size={19} />, managePermission: 'masterdata.manage' },
    { to: '/master-data/customers', title: 'مشتریان', desc: 'شرکت‌های خودروساز و اطلاعات تماس', icon: <Users size={19} />, managePermission: 'masterdata.manage' },
    { to: '/machines', title: 'ماشین‌آلات و ظرفیت', desc: 'پرس‌ها و ایستگاه‌ها، توانمندی‌ها، قالب‌ها و ظرفیت', icon: <Wrench size={19} />, managePermission: 'capacity.manage' },
  ];

  return (
    <Page
      title="اطلاعات پایه"
      subtitle="کلیه تعاریف پایه سامانه — همه صفحه‌ها جستجوی زنده، خروجی اکسل و ورود گروهی دارند"
    >
      <Card>
        <div className="hub-grid">
          {items.map((item) => {
            const canOpen = !item.managePermission || can(item.managePermission) || can(item.managePermission.replace('.manage', '.view'));
            if (!canOpen) return null;
            return (
              <Link key={item.to} to={item.to} className="card hub-card">
                <div className="hub-card__head">
                  <span className="hub-card__icon" aria-hidden>{item.icon}</span>
                  <h3>{item.title}</h3>
                </div>
                <p className="hub-card__desc">{item.desc}</p>
                <span className="hub-card__link">
                  <MapPin size={12} aria-hidden />
                  ورود به بخش
                  <ArrowLeft size={12} aria-hidden />
                </span>
              </Link>
            );
          })}
        </div>
      </Card>
    </Page>
  );
}
