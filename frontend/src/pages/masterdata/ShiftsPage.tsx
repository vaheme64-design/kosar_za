import { CrudPage } from '../../components/crud/CrudPage';
import { Badge } from '../../components/ui';

export function ShiftsPage() {
  return (
    <CrudPage
      title="شیفت‌های کاری"
      subtitle="ساعت شروع و پایان شیفت‌ها — مبنای تقویم ظرفیت ماشین‌آلات"
      labelSingular="شیفت"
      resourcePath="/master-data/shifts"
      permissionManage="masterdata.manage"
      searchPlaceholder="جستجوی کد یا نام شیفت…"
      columns={[
        { key: 'code', label: 'کد', render: (r) => <b dir="ltr">{r.code}</b> },
        { key: 'nameFa', label: 'نام شیفت' },
        { key: 'startTime', label: 'ساعت شروع', render: (r) => <span dir="ltr">{r.startTime}</span> },
        { key: 'endTime', label: 'ساعت پایان', render: (r) => <span dir="ltr">{r.endTime}</span> },
        { key: 'isActive', label: 'وضعیت', render: (r) => <Badge tone={r.isActive ? 'ok' : 'muted'}>{r.isActive ? 'فعال' : 'غیرفعال'}</Badge> },
      ]}
      fields={[
        { key: 'code', label: 'کد شیفت', required: true, placeholder: 'SH1' },
        { key: 'nameFa', label: 'نام فارسی', required: true },
        { key: 'startTime', label: 'ساعت شروع (HH:MM)', required: true, placeholder: '06:00' },
        { key: 'endTime', label: 'ساعت پایان (HH:MM)', required: true, placeholder: '14:00' },
      ]}
    />
  );
}
