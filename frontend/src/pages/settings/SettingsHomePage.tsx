import { Link } from 'react-router-dom';
import { ArrowLeft, FileClock, Hash, ScrollText, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { getAiStatus, type AiStatus } from '../../lib/ai';
import { useEffect, useState } from 'react';
import { Card, Loading, Page } from '../../components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function SettingsHomePage() {
  const [data, setData] = useState<any>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<any>('/settings/overview')
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        /* hub tiles degrade gracefully */
      });
    getAiStatus()
      .then((res) => {
        if (!cancelled) setAi(res);
      })
      .catch(() => {
        /* AI tile degrades gracefully */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const items = [
    { to: '/settings/users', title: 'کاربران', desc: 'ایجاد کاربر، نقش، فعال/غیرفعال‌سازی و خروجی اکسل', icon: <Users size={19} />, count: data ? `${data.activeUsers} فعال از ${data.users}` : undefined },
    { to: '/settings/roles', title: 'نقش‌ها و مجوزها', desc: 'کنترل دسترسی ماژول‌محور (RBAC) با ماتریس مجوزها', icon: <ShieldCheck size={19} />, count: data ? `${data.roles} نقش، ${data.permissions} مجوز` : undefined },
    { to: '/settings/document-sequences', title: 'شماره‌گذاری اسناد', desc: 'پیشوند و شماره بعدی هر نوع سند', icon: <Hash size={19} />, count: data ? `${data.sequences} دنباله` : undefined },
    { to: '/settings/system', title: 'تنظیمات سامانه', desc: 'پیکربندی کلی — مقادیر محرمانه پنهان می‌مانند', icon: <ScrollText size={19} />, count: data ? `${data.settings} تنظیم` : undefined },
    { to: '/settings/ai', title: 'هوش مصنوعی', desc: 'دستیار هوشمند و گزارش هوشمند — Ollama محلی یا سرویس سازگار با OpenAI', icon: <Sparkles size={19} />, count: ai ? (ai.enabled ? (ai.reachable ? 'متصل' : 'فعال — قطع') : 'غیرفعال') : undefined },
    { to: '/settings/audit-logs', title: 'لاگ حسابرسی', desc: 'رویدادهای حساس با جستجو، فیلتر تاریخ و خروجی اکسل', icon: <FileClock size={19} />, count: data ? `${data.auditToday} رویداد در ۲۴ ساعت` : undefined },
  ];

  return (
    <Page title="کاربران و تنظیمات" subtitle="مدیریت دسترسی، شماره‌گذاری اسناد، پیکربندی و ردگیری رویدادها">
      <Card>
        <div className="hub-grid">
          {items.map((item) => (
            <Link key={item.to} to={item.to} className="card hub-card">
              <div className="hub-card__head">
                <span className="hub-card__icon" aria-hidden>{item.icon}</span>
                <h3>{item.title}</h3>
              </div>
              <p className="hub-card__desc">{item.desc}</p>
              <span className="hub-card__link">
                {item.count ?? '…'}
                <ArrowLeft size={12} aria-hidden />
              </span>
            </Link>
          ))}
        </div>
        {!data && <Loading label="در حال دریافت خلاصه…" />}
      </Card>
    </Page>
  );
}
