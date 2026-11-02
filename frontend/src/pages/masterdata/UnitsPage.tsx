import { CrudPage } from '../../components/crud/CrudPage';
import { Badge } from '../../components/ui';
import { OPTION_SETS } from '../../lib/labels';

export function UnitsPage() {
  return (
    <CrudPage
      title="واحدهای شمارش"
      subtitle="عدد، کیلوگرم، متر، مترمربع، برگ و… — واحد پایه قطعات و مواد"
      labelSingular="واحد شمارش"
      resourcePath="/master-data/units"
      permissionManage="masterdata.manage"
      searchPlaceholder="جستجوی کد یا نام واحد…"
      columns={[
        { key: 'code', label: 'کد', render: (r) => <b dir="ltr">{r.code}</b> },
        { key: 'nameFa', label: 'نام فارسی' },
        { key: 'nameEn', label: 'نام انگلیسی', render: (r) => <span dir="ltr">{r.nameEn}</span> },
        { key: 'kind', label: 'نوع' },
        { key: 'isActive', label: 'وضعیت', render: (r) => <Badge tone={r.isActive ? 'ok' : 'muted'}>{r.isActive ? 'فعال' : 'غیرفعال'}</Badge> },
      ]}
      filters={[{ key: 'kind', label: 'نوع', options: OPTION_SETS.unitKind }]}
      fields={[
        { key: 'code', label: 'کد واحد', required: true, placeholder: 'مثلاً PCS' },
        { key: 'nameFa', label: 'نام فارسی', required: true },
        { key: 'nameEn', label: 'نام انگلیسی', required: true },
        { key: 'kind', label: 'نوع', type: 'select', options: OPTION_SETS.unitKind },
      ]}
    />
  );
}
