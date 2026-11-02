import { CrudPage } from '../../components/crud/CrudPage';
import { Qty } from '../../components/ui';
import { useLookups } from '../../lib/lookups';

export function BomPage() {
  const { lookups } = useLookups();
  const partOptions = lookups.parts.map((p) => ({ value: p.id, label: `${p.partNumber} — ${p.nameFa}` }));
  const materialOptions = lookups.materials.map((m) => ({ value: m.id, label: `${m.materialCode} — ${m.nameFa}` }));

  return (
    <CrudPage
      title="سرانه مصرف (BOM)"
      subtitle="مصرف ماده اولیه به ازای هر عدد قطعه — ورودی محاسبه کسری مواد در برنامه‌ریزی تولید"
      labelSingular="سرانه مصرف"
      resourcePath="/master-data/bom"
      permissionManage="masterdata.manage"
      searchPlaceholder="جستجو در توضیحات…"
      pageSizeDefault={50}
      columns={[
        { key: 'part.partNumber', label: 'شماره قطعه', render: (r) => <b dir="ltr">{r.part?.partNumber}</b> },
        { key: 'part.nameFa', label: 'قطعه' },
        { key: 'material.materialCode', label: 'کد ماده', render: (r) => <span dir="ltr">{r.material?.materialCode}</span> },
        { key: 'material.nameFa', label: 'ماده اولیه' },
        { key: 'quantityPerUnit', label: 'مقدار در هر عدد', render: (r) => <Qty value={r.quantityPerUnit} /> },
        { key: 'weightKgPerUnit', label: 'وزن در هر عدد (kg)', render: (r) => <Qty value={r.weightKgPerUnit} unit="kg" /> },
        { key: 'notes', label: 'توضیحات' },
      ]}
      fields={[
        { key: 'partId', label: 'قطعه', type: 'select', options: partOptions, required: true, wide: true },
        { key: 'materialId', label: 'ماده اولیه', type: 'select', options: materialOptions, required: true, wide: true },
        { key: 'quantityPerUnit', label: 'مقدار مصرف در هر عدد قطعه', type: 'number', step: '0.0001', required: true },
        { key: 'weightKgPerUnit', label: 'وزن معادل (کیلوگرم در هر عدد)', type: 'number', step: '0.0001' },
        { key: 'notes', label: 'توضیحات', type: 'textarea', wide: true },
      ]}
      rowToForm={(row) => ({
        partId: row.partId ?? '',
        materialId: row.materialId ?? '',
      })}
      emptyHint="برای محاسبه کسری مواد در برنامه‌ریزی، ابتدا سرانه مصرف هر قطعه را تعریف کنید"
    />
  );
}
