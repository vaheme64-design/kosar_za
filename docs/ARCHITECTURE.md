# KPIMS — معماری سامانه (Architecture)

**KPIMS — Kosar Production & Inventory Management System**
سامانه برنامه‌ریزی تولید و مدیریت موجودی — کارخانه قطعات فلزی خودرویی

## ۱) نمای کلی

```
┌────────────────────────────┐        ┌─────────────────────────────────┐
│  Frontend (React SPA)      │  HTTP  │  Backend (Express REST API)     │
│  React 19 + TypeScript     │──────▶ │  Node.js + Express 5 + Zod      │
│  Vite · RTL · Vazirmatn    │ /api/* │  JWT Auth · RBAC · Services     │
│  Jalali display (Intl)     │        │  Prisma Client                  │
└────────────────────────────┘        └───────────────┬─────────────────┘
                                                      │ Prisma ORM
                                              ┌───────▼────────┐
                                              │  PostgreSQL 17 │
                                              │  39 جدول — 4 دامنه │
                                              └────────────────┘
```

- **Frontend**: فقط نمایش و ورودی داده؛ **هیچ محاسبه‌ای از موجودی رسمی در فرانت انجام نمی‌شود**.
- **Backend**: تمام تراکنش‌های انبار و تولید، اعتبارسنجی Zod، RBAC، شماره‌گذاری اسناد و
  به‌روزرسانی موجودی رسمی (در فازهای بعد) همه سمت سرور.
- **Database**: منبع یکتای حقیقت؛ قیدهای یکپارچگی در سطح دیتابیس (FK / UNIQUE / CHECK).

## ۲) لایه‌ها و مرز مسئولیت‌ها

| لایه | مسیر | مسئولیت | ممنوع |
|---|---|---|---|
| UI | `frontend/src` | ناوبری، فرم‌ها، نمایش جلالی، state کلاینت | محاسبه موجودی، دسترسی مستقیم DB |
| API | `backend/src/routes`, `modules/*` | HTTP، اعتبارسنجی ورودی، کد وضعیت | منطق چند-جدولی بدون تراکنش |
| Business logic | `backend/src/services/*` | قواعد کسب‌وکار (شماره سند، قطع‌بوش، موجودی) | فرض اعتماد به ورودی UI |
| Data access | `backend/prisma/schema.prisma` + `config/db.ts` | اسکیما، کلاینت Prisma | SQL پراکنده بدون `@map` |

جریان یک درخواست:

```
Client → /api/v1/... → helmet/cors → json → requestLogger
       → authenticate (JWT) → requirePermission (RBAC)
       → zod schema.parse → service (db.$transaction) → response JSON
       → errorHandler (ZodError/PrismaError/ApiError → پیام فارسی)
```

## ۳) تصمیم‌های کلیدی طراحی

### 3.1) موجودی رسمی فقط سمت سرور
موجودی رسمی در جدول `stock_balances` نگهداری می‌شود و **فقط در همان تراکنش دیتابیسِ
قطع‌بوشِ سند** به‌روزرسانی می‌شود (الگوی آینده: `db.$transaction` → درج
`inventory_transactions` → upsert `stock_balances`). فرانت هرگز موجودی «محاسبه‌شده» را
نمایش منفی‌کار نمی‌دهد.

### 3.2) دفتر کل تغییرناپذیر (Immutable Ledger)
- رکوردهای `inventory_transactions` پس از درج تغییر نمی‌کنند و حذفشان با
  `ON DELETE RESTRICT` روی همه FKها مسدود است.
- اصلاح فقط با **سند ابطال**: تراکنش جدیدی که با `reversal_of_id` به رکورد اصلی اشاره می‌کند
  (`chk_inv_tx_reversal_self` اجازه self-reference به خود را نمی‌دهد).
- `posting_status` جدا از `status` است: گردش کار سند (پیش‌نویس/تأیید/لغو) با اثر
  حسابداری (قطع‌بوش‌نشده/قطع‌بوش‌شده/ابطال‌شده) قاطی نمی‌شود.

### 3.3) شماره‌گذاری اسناد یکتا
جدول `document_sequences` + سرویس `generateDocumentNumber(tx, key)` با
`SELECT ... FOR UPDATE` **داخل تراکنشِ خود سند**؛ دو قطع‌بوش هم‌زمان هرگز شماره تکراری
نمی‌گیرند. سیاست `YEARLY` با سال جلالی ریست می‌شود (شروع نمونه: `INV-001001`).

### 3.4) انواع داده
- کمیتی/وزن: `DECIMAL(18,4)` — هرگز float.
- PK: `UUID` (مناسب یکپارچگی ERP و جلوگیری از شماره‌گذاری قابل حدس).
- زمان: `TIMESTAMPTZ(6)` در UTC؛ تاریخ‌های کاری: `DATE` و نمایش جلالی در UI/سرویس.
- XOR قطعه/ماده با CHECK در سطح DB: `num_nonnulls(part_id, material_id) = 1`.

### 3.5) تقویم جلالی
- سرور: `Intl.DateTimeFormat('fa-IR-u-ca-persian')` با `APP_TIMEZONE` (پیش‌فرض `Asia/Tehran`) —
  بدون وابستگی خارجی؛ برای شماره‌گذاری سالانه هم استفاده می‌شود.
- کلاینت: همان روش با `VITE_APP_TIMEZONE` تا نتیجه مستقل از منطقه زمانی مرورگر باشد.

### 3.6) احراز هویت و RBAC
- `POST /api/v1/auth/login` → JWT (HS256) با `sub/username/role`، TTL قابل تنظیم
  (`JWT_ACCESS_TTL`, پیش‌فرض ۸ ساعت). هش گذرواژه با bcrypt.
- `authenticate` میدل‌ور: JWT را verify و **پروفایل تازه** کاربر (نقش + مجوزها) را از DB
  می‌خواند؛ غیرفعال‌شدن کاربر/نقش بلافاصله اعمال می‌شود.
- `requirePermission('module.action')` روی هر endpoint حساس؛ مجوزها در جدول
  `permissions` با الگوی `module.view|manage|post` و اتصال چند-به-چند `role_permissions`.
- لاگین موفق/ناموفق و رویدادهای مهم در `audit_logs` ثبت می‌شود.

### 3.7) نسخه‌بندی مسیر تولید
`part_routes(version)` با `UNIQUE(part_id, version)` و زنجیره `superseded_by_id`؛
وضعیت `DRAFT → ACTIVE → RETIRED`. دستور کار (`manufacturing_orders.route_id`) به نسخه
خصوصی اشاره می‌کند تا تغییر مسیر، سابقه تولید را خراب نکند.

### 3.8) آماده‌سازی برای ERP (SAPCO/سایر)
- نام جداول/ستون‌ها snake_case و پایدار؛ enumها جداول نوعی معتبر PostgreSQL.
- `reference_type/reference_id` در سند انبار برای اتصال چندریختی به اسناد مبدأ
  (گزارش تولید، قرارداد ماده) — بدون FK تا فازهای بعد آزادانه گسترش یابد.
- `material_lots` ردیابی بچ ورق‌های SAPCO را از روز اول ممکن می‌کند.

## ۴) ساختار پوشه‌ها

```
kpims/
├── backend/                     # REST API
│   ├── prisma/
│   │   ├── schema.prisma        # طرح دیتابیس (39 مدل)
│   │   ├── migrations/          # migrationهای SQL
│   │   └── seed.ts              # داده نمونه (idempotent)
│   └── src/
│       ├── config/              # env.ts (Zod)، db.ts، modules.ts
│       ├── lib/                 # logger، jalali، audit، http (ApiError)
│       ├── middleware/          # auth (JWT+RBAC)، errorHandler، requestLogger
│       ├── modules/             # auth، health، dashboard
│       ├── services/            # documentNumber.service.ts (الگوی فازهای بعد)
│       ├── routes/index.ts      # mount ماژول‌ها + stubهای 501
│       ├── app.ts / server.ts
│       └── .env                 # (local) — از .env.example
├── frontend/                    # React SPA فارسی RTL
│   └── src/
│       ├── components/          # layout (Sidebar/Topbar)، RequireAuth، Placeholder
│       ├── context/AuthContext  # توکن + پروفایل + can(permission)
│       ├── lib/                 # api client، jalali
│       ├── pages/               # Login، Dashboard، NotFound
│       └── config/modules.ts    # نقشه ۱۰ ماژول اصلی
├── scripts/                     # postgres.mjs، prisma.mjs، dev.mjs، e2e-verify.sh
├── docs/                        # ARCHITECTURE، SETUP، ER-DIAGRAM، DATA-DICTIONARY
└── .zscripts/dev.sh             # نقطه ورود اجرا در سندباکس (پورت ۳۰۰۰)
```

## ۵) وضعیت فعلی و نقشه راه

| فاز | محتوا | وضعیت |
|---|---|---|
| صفر | اسکلت ری‌اکت+اکسپرس، احراز هویت، RBAC، لایه‌بندی، ناوبری RTL، اتصال DB | ✅ انجام شد |
| یک | طرح کامل دیتابیس (۳۹ مدل)، migration، seed نمونه، ER و دیکشنری داده | ✅ انجام شد |
| دو | CRUD اطلاعات پایه (قطعات، مواد، ماشین‌آلات، ...) با مجوزها | ⬜ بعدی |
| سه | سندهای انبار + قطع‌بوش + به‌روزرسانی تراکنشی موجودی رسمی | ⬜ |
| چهار | سفارش مشتری → برنامه تولید → دستور کار → گزارش تولید | ⬜ |
| پنج | ظرفیت ماشین‌آلات و الگوریتم برنامه‌ریزی تولید (صفر تا صد) | ⬜ |
| شش | گزارش‌ها، داشبورد تحلیلی، خروجی Excel/PDF، یکپارچگی ERP | ⬜ |

### محدودیت‌های شفاف نسخه فعلی
- ماژول‌های عملیاتی (انبار/تولید/برنامه‌ریزی) endpoint واقعی ندارند و مسیرشان
  `501 Not Implemented` برمی‌گرداند — هیچ داده یا تراکنش ساختگی تولید نشده است.
- توکن JWT در localStorage نگه‌داری می‌شود (سادگی فاز صفر)؛ مهاجرت به httpOnly cookie
  در فازهای بعد انجام می‌شود.
- موجودی رسمی هنوز «به‌روزرسانی خودکار» ندارد چون هنوز سند انباری وجود ندارد؛ طرح و
  قیدهای آن از همین حالا نهایی است.
