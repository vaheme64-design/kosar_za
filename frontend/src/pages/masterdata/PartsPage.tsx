import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { CrudPage } from '../../components/crud/CrudPage';
import { Badge, Qty, fa } from '../../components/ui';
import { useLookups } from '../../lib/lookups';
import { OPTION_SETS, faEx } from '../../lib/labels';

export function PartsPage() {
  const { lookups } = useLookups();
  const unitOptions = lookups.units.map((u) => ({ value: u.id, label: `${u.nameFa} (${u.code})` }));
  const materialOptions = lookups.materials.map((m) => ({ value: m.id, label: `${m.materialCode} — ${m.nameFa}` }));
  const customerOptions = lookups.customers.map((c) => ({ value: c.id, label: `${c.code} — ${c.nameFa}` }));

  return (
    <CrudPage
      title="قطعات (کالا)"
      subtitle="تعریف قطعات تولیدی — واحد پایه، وزن استاندارد، ماده اصلی و مشتری"
      labelSingular="قطعه"
      resourcePath="/master-data/parts"
      permissionManage="masterdata.manage"
      searchPlaceholder="جستجوی شماره قطعه، نام فارسی/انگلیسی…"
      toolbarExtra={
        <Link to="/master-data/bom" className="btn btn--ghost" title="مدیریت سرانه مصرف قطعات">
          <ClipboardList size={15} /> سرانه مصرف (BOM)
        </Link>
      }
      columns={[
        { key: 'partNumber', label: 'شماره قطعه', render: (r) => <b dir="ltr">{r.partNumber}</b> },
        { key: 'nameFa', label: 'نام قطعه' },
        { key: 'partType', label: 'نوع', render: (r) => faEx(r.partType) },
        { key: 'baseUnit.nameFa', label: 'واحد' },
        { key: 'standardWeightKg', label: 'وزن استاندارد (kg)', render: (r) => <Qty value={r.standardWeightKg} unit="kg" /> },
        { key: 'mainMaterial.nameFa', label: 'ماده اصلی' },
        { key: 'primaryCustomer.nameFa', label: 'مشتری اصلی' },
        {
          key: 'status',
          label: 'وضعیت',
          render: (r) => (
            <Badge tone={r.status === 'ACTIVE' ? 'ok' : r.status === 'PHASED_OUT' ? 'muted' : 'warn'}>{fa(r.status)}</Badge>
          ),
        },
      ]}
      filters={[
        { key: 'partType', label: 'نوع', options: OPTION_SETS.partType },
        { key: 'status', label: 'وضعیت', options: OPTION_SETS.partStatus },
      ]}
      fields={[
        { key: 'partNumber', label: 'شماره قطعه', required: true, placeholder: 'مثلاً KP-1234' },
        { key: 'nameFa', label: 'نام فارسی', required: true },
        { key: 'nameEn', label: 'نام انگلیسی' },
        { key: 'partType', label: 'نوع قطعه', type: 'select', options: OPTION_SETS.partType },
        { key: 'baseUnitId', label: 'واحد پایه', type: 'select', options: unitOptions, required: true },
        { key: 'standardWeightKg', label: 'وزن استاندارد (کیلوگرم)', type: 'number', step: '0.0001' },
        { key: 'mainMaterialId', label: 'ماده اصلی', type: 'select', options: materialOptions },
        { key: 'primaryCustomerId', label: 'مشتری اصلی', type: 'select', options: customerOptions },
        { key: 'description', label: 'توضیحات', type: 'textarea', wide: true },
      ]}
      rowToForm={(row) => ({
        mainMaterialId: row.mainMaterialId ?? '',
        primaryCustomerId: row.primaryCustomerId ?? '',
      })}
    />
  );
}
