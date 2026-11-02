import { CrudPage } from '../../components/crud/CrudPage';
import { Badge, Qty, fa } from '../../components/ui';
import { useLookups } from '../../lib/lookups';
import { OPTION_SETS, faEx } from '../../lib/labels';

export function MaterialsPage() {
  const { lookups } = useLookups();
  const unitOptions = lookups.units.map((u) => ({ value: u.id, label: `${u.nameFa} (${u.code})` }));

  return (
    <CrudPage
      title="مواد اولیه"
      subtitle="ورق، کویل، پروفیل، رنگ و مواد مصرفی — با ابعاد و وزن واحد به کیلوگرم"
      labelSingular="ماده اولیه"
      resourcePath="/master-data/materials"
      permissionManage="masterdata.manage"
      searchPlaceholder="جستجوی کد ماده، نام، گرید، تأمین‌کننده…"
      columns={[
        { key: 'materialCode', label: 'کد ماده', render: (r) => <b dir="ltr">{r.materialCode}</b> },
        { key: 'nameFa', label: 'نام ماده' },
        { key: 'materialType', label: 'نوع', render: (r) => faEx(r.materialType) },
        { key: 'grade', label: 'گرید', render: (r) => (r.grade ? <span dir="ltr">{r.grade}</span> : <span className="cell-empty">—</span>) },
        { key: 'thicknessMm', label: 'ضخامت (mm)', render: (r) => <Qty value={r.thicknessMm} /> },
        { key: 'widthMm', label: 'عرض (mm)', render: (r) => <Qty value={r.widthMm} /> },
        { key: 'lengthMm', label: 'طول (mm)', render: (r) => <Qty value={r.lengthMm} /> },
        { key: 'unitWeightKg', label: 'وزن واحد (kg)', render: (r) => <Qty value={r.unitWeightKg} unit="kg" /> },
        { key: 'baseUnit.nameFa', label: 'واحد' },
        { key: 'supplierName', label: 'تأمین‌کننده' },
        {
          key: 'status',
          label: 'وضعیت',
          render: (r) => <Badge tone={r.status === 'ACTIVE' ? 'ok' : 'warn'}>{fa(r.status)}</Badge>,
        },
      ]}
      filters={[
        { key: 'materialType', label: 'نوع', options: OPTION_SETS.materialType },
        { key: 'status', label: 'وضعیت', options: [{ value: 'ACTIVE', label: 'فعال' }, { value: 'INACTIVE', label: 'غیرفعال' }] },
      ]}
      fields={[
        { key: 'materialCode', label: 'کد ماده', required: true, placeholder: 'مثلاً SHEET-ST12-1.5' },
        { key: 'nameFa', label: 'نام فارسی', required: true },
        { key: 'nameEn', label: 'نام انگلیسی' },
        { key: 'materialType', label: 'نوع ماده', type: 'select', options: OPTION_SETS.materialType },
        { key: 'grade', label: 'گرید', placeholder: 'ST12' },
        { key: 'thicknessMm', label: 'ضخامت (mm)', type: 'number', step: '0.001' },
        { key: 'widthMm', label: 'عرض (mm)', type: 'number', step: '0.01' },
        { key: 'lengthMm', label: 'طول (mm)', type: 'number', step: '0.01' },
        { key: 'unitWeightKg', label: 'وزن واحد (kg)', type: 'number', step: '0.0001' },
        { key: 'baseUnitId', label: 'واحد پایه', type: 'select', options: unitOptions, required: true },
        { key: 'supplierName', label: 'تأمین‌کننده', placeholder: 'SAPCO' },
        { key: 'notes', label: 'توضیحات', type: 'textarea', wide: true },
      ]}
    />
  );
}
