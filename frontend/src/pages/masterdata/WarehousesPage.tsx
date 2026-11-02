import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { CrudPage } from '../../components/crud/CrudPage';
import { Badge } from '../../components/ui';
import { OPTION_SETS, faEx } from '../../lib/labels';

export function WarehousesPage() {
  return (
    <CrudPage
      title="انبارها"
      subtitle="انبارهای مواد اولیه، در جریان ساخت، محصول تکمیلی، ضایعات و ابزار"
      labelSingular="انبار"
      resourcePath="/master-data/warehouses"
      permissionManage="masterdata.manage"
      searchPlaceholder="جستجوی کد یا نام انبار…"
      toolbarExtra={
        <Link to="/master-data/warehouse-locations" className="btn btn--ghost" title="مدیریت موقعیت‌های انبار">
          <MapPin size={15} /> موقعیت‌ها و قفسه‌ها
        </Link>
      }
      columns={[
        { key: 'code', label: 'کد', render: (r) => <b dir="ltr">{r.code}</b> },
        { key: 'nameFa', label: 'نام انبار' },
        { key: 'warehouseType', label: 'نوع', render: (r) => faEx(r.warehouseType) },
        { key: '_count.locations', label: 'تعداد موقعیت' },
        { key: 'isActive', label: 'وضعیت', render: (r) => <Badge tone={r.isActive ? 'ok' : 'muted'}>{r.isActive ? 'فعال' : 'غیرفعال'}</Badge> },
        { key: 'notes', label: 'توضیحات' },
      ]}
      filters={[{ key: 'warehouseType', label: 'نوع', options: OPTION_SETS.warehouseType }]}
      fields={[
        { key: 'code', label: 'کد انبار', required: true, placeholder: 'مثلاً WH-RM' },
        { key: 'nameFa', label: 'نام فارسی', required: true },
        { key: 'warehouseType', label: 'نوع انبار', type: 'select', options: OPTION_SETS.warehouseType, required: true },
        { key: 'notes', label: 'توضیحات', type: 'textarea', wide: true },
      ]}
    />
  );
}

export function WarehouseLocationsPage() {
  return (
    <CrudPage
      title="موقعیت‌های انبار"
      subtitle="قفسه‌ها و پالت‌های هر انبار — محل استقرار موجودی"
      labelSingular="موقعیت"
      resourcePath="/master-data/warehouse-locations"
      permissionManage="masterdata.manage"
      searchPlaceholder="جستجوی کد یا نام موقعیت…"
      columns={[
        { key: 'code', label: 'کد', render: (r) => <b dir="ltr">{r.code}</b> },
        { key: 'nameFa', label: 'نام موقعیت' },
        { key: 'warehouse.nameFa', label: 'انبار' },
        { key: 'capacityKg', label: 'ظرفیت (kg)', render: (r) => (r.capacityKg ? <span dir="ltr">{Number(r.capacityKg).toLocaleString('fa-IR')}</span> : <span className="cell-empty">—</span>) },
        { key: 'isActive', label: 'وضعیت', render: (r) => <Badge tone={r.isActive ? 'ok' : 'muted'}>{r.isActive ? 'فعال' : 'غیرفعال'}</Badge> },
      ]}
      fields={[
        { key: 'code', label: 'کد موقعیت', required: true, placeholder: 'مثلاً RM-A01' },
        { key: 'nameFa', label: 'نام فارسی', required: true },
        { key: 'capacityKg', label: 'ظرفیت (کیلوگرم)', type: 'number', step: '0.01' },
      ]}
      emptyHint="موقعیت‌ها به انبار وابسته‌اند؛ انبارها را از صفحه «انبارها» مدیریت کنید"
    />
  );
}
