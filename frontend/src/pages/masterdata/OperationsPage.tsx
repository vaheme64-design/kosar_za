import { CrudPage } from '../../components/crud/CrudPage';
import { Badge, Qty } from '../../components/ui';

export function OperationsPage() {
  return (
    <CrudPage
      title="عملیات تولید"
      subtitle="برش، خالی‌بری، خم، پرس/فرم، جوش پرس، جوش CO2، رنگ و مونتاژ — با زمان‌های استاندارد"
      labelSingular="عملیات"
      resourcePath="/master-data/operations"
      permissionManage="masterdata.manage"
      searchPlaceholder="جستجوی کد یا نام عملیات…"
      columns={[
        { key: 'code', label: 'کد', render: (r) => <b dir="ltr">{r.code}</b> },
        { key: 'nameFa', label: 'نام عملیات' },
        { key: 'nameEn', label: 'نام انگلیسی', render: (r) => <span dir="ltr">{r.nameEn}</span> },
        { key: 'defaultSetupTimeMin', label: 'راه‌اندازی (دقیقه)', render: (r) => <Qty value={r.defaultSetupTimeMin} /> },
        { key: 'defaultCycleTimeSec', label: 'سیکل (ثانیه)', render: (r) => <Qty value={r.defaultCycleTimeSec} /> },
        { key: 'requiresDie', label: 'قالب‌محور', render: (r) => <Badge tone={r.requiresDie ? 'info' : 'muted'}>{r.requiresDie ? 'بله' : 'خیر'}</Badge> },
        { key: 'isActive', label: 'وضعیت', render: (r) => <Badge tone={r.isActive ? 'ok' : 'muted'}>{r.isActive ? 'فعال' : 'غیرفعال'}</Badge> },
      ]}
      fields={[
        { key: 'code', label: 'کد عملیات', required: true, placeholder: 'مثلاً CUT' },
        { key: 'nameFa', label: 'نام فارسی', required: true },
        { key: 'nameEn', label: 'نام انگلیسی', required: true },
        { key: 'defaultSetupTimeMin', label: 'زمان راه‌اندازی (دقیقه)', type: 'number', step: '1' },
        { key: 'defaultCycleTimeSec', label: 'زمان سیکل (ثانیه)', type: 'number', step: '0.01' },
        { key: 'requiresDie', label: 'نیازمند قالب', type: 'checkbox', hint: 'اجرای این عملیات به قالب نیاز دارد' },
        { key: 'description', label: 'توضیحات', type: 'textarea', wide: true },
      ]}
    />
  );
}
