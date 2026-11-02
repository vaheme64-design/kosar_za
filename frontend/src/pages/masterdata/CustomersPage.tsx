import { CrudPage } from '../../components/crud/CrudPage';
import { Badge } from '../../components/ui';

export function CustomersPage() {
  return (
    <CrudPage
      title="مشتریان"
      subtitle="شرکت‌های خودروساز و سفارش‌دهندگان قطعات"
      labelSingular="مشتری"
      resourcePath="/master-data/customers"
      permissionManage="masterdata.manage"
      searchPlaceholder="جستجوی کد، نام، رابط، تلفن…"
      columns={[
        { key: 'code', label: 'کد', render: (r) => <b dir="ltr">{r.code}</b> },
        { key: 'nameFa', label: 'نام فارسی' },
        { key: 'nameEn', label: 'نام انگلیسی', render: (r) => (r.nameEn ? <span dir="ltr">{r.nameEn}</span> : <span className="cell-empty">—</span>) },
        { key: 'contactPerson', label: 'رابط' },
        { key: 'phone', label: 'تلفن', render: (r) => (r.phone ? <span dir="ltr">{r.phone}</span> : <span className="cell-empty">—</span>) },
        { key: 'email', label: 'ایمیل', render: (r) => (r.email ? <span dir="ltr">{r.email}</span> : <span className="cell-empty">—</span>) },
        { key: 'isActive', label: 'وضعیت', render: (r) => <Badge tone={r.isActive ? 'ok' : 'muted'}>{r.isActive ? 'فعال' : 'غیرفعال'}</Badge> },
      ]}
      fields={[
        { key: 'code', label: 'کد مشتری', required: true, placeholder: 'CUST-001' },
        { key: 'nameFa', label: 'نام فارسی', required: true },
        { key: 'nameEn', label: 'نام انگلیسی' },
        { key: 'contactPerson', label: 'شخص رابط' },
        { key: 'phone', label: 'تلفن' },
        { key: 'email', label: 'ایمیل', type: 'text' },
        { key: 'address', label: 'آدرس', type: 'textarea', wide: true },
      ]}
    />
  );
}
