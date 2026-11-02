import { CrudPage } from '../../components/crud/CrudPage';
import { Badge } from '../../components/ui';
import { OPTION_SETS, faEx } from '../../lib/labels';

export function DiesPage() {
  return (
    <CrudPage
      title="قالب‌ها"
      subtitle="قالب‌های خالی‌بری، فرم و خم — سازگاری هر قالب با ماشین‌ها از صفحه ماشین‌آلات تنظیم می‌شود"
      labelSingular="قالب"
      resourcePath="/master-data/dies"
      permissionManage="capacity.manage"
      searchPlaceholder="جستجوی کد، نام یا محل نگهداری قالب…"
      columns={[
        { key: 'code', label: 'کد قالب', render: (r) => <b dir="ltr">{r.code}</b> },
        { key: 'nameFa', label: 'نام قالب' },
        { key: 'status', label: 'وضعیت', render: (r) => <Badge tone={r.status === 'ACTIVE' ? 'ok' : r.status === 'MAINTENANCE' ? 'warn' : 'muted'}>{faEx(r.status)}</Badge> },
        { key: 'storageLocation', label: 'محل نگهداری' },
        { key: '_count.dieCompatibilities', label: 'ماشین سازگار' },
        { key: '_count.routeSteps', label: 'مراحل مسیر' },
        { key: 'description', label: 'توضیحات' },
      ]}
      filters={[{ key: 'status', label: 'وضعیت', options: OPTION_SETS.dieStatus }]}
      fields={[
        { key: 'code', label: 'کد قالب', required: true, placeholder: 'DIE-101' },
        { key: 'nameFa', label: 'نام فارسی', required: true },
        { key: 'status', label: 'وضعیت', type: 'select', options: OPTION_SETS.dieStatus },
        { key: 'storageLocation', label: 'محل نگهداری', placeholder: 'انبار قالب - قفسه A' },
        { key: 'description', label: 'توضیحات', type: 'textarea', wide: true },
      ]}
    />
  );
}
