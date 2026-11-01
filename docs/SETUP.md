# KPIMS — راهنمای راه‌اندازی (Setup)

## ۱) پیش‌نیازها

| ابزار | نسخه | توضیح |
|---|---|---|
| Node.js | ≥ 20 (توسعه با 24) | اجباری |
| bun | ≥ 1.2 | نصب وابستگی‌ها (یا npm به‌جای آن) |
| PostgreSQL | 15+ (توسعه: 17.11) | در سندباکس به‌صورت embedded اجرا می‌شود |

## ۲) متغیرهای محیطی

### بک‌اند (`backend/.env` — از `backend/.env.example`)

| متغیر | اجباری | پیش‌فرض توسعه | توضیح |
|---|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://kpims:kpims_dev_local@127.0.0.1:5433/kpims?schema=public` | رشته اتصال PostgreSQL |
| `JWT_SECRET` | ✅ | تولید تصادفی توسط `scripts/ensure-env.mjs` | کلید امضای JWT — **در تولید حتماً از Secrets manager** |
| `JWT_ACCESS_TTL` | — | `8h` | عمر توکن دسترسی |
| `BCRYPT_ROUNDS` | — | `10` | هزینه هش گذرواژه |
| `PORT` | — | `4100` | پورت API |
| `NODE_ENV` | — | `development` | `production` در استقرار |
| `CORS_ORIGIN` | — | `*` | دامنه‌های مجاز (در تولید مقدار دقیق بدهید) |
| `APP_TIMEZONE` | — | `Asia/Tehran` | منطقه زمانی مرجع برای تقویم جلالی |

### فرانت‌اند (`frontend/.env.local`)

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | مسیر پایه API (در تولید: آدرس کامل API) |
| `VITE_APP_TIMEZONE` | `Asia/Tehran` | نمایش جلالی مستقل از مرورگر |
| `VITE_SHOW_DEMO_HINT` | `true` | نمایش راهنمای حساب‌های نمونه در صفحه ورود |

> **قاعده امنیتی:** هیچ secretی در کد کامیت نمی‌شود. `*.env` در `.gitignore` است؛
> در استقرار واقعی مقادیر را از Secrets manager تزریق کنید.

## ۳) اجرا (توسعه)

```bash
# همه‌چیز: env → نصب → دیتابیس → migration → seed → API(4100) → UI(3000)
bun run dev            # یا: bash .zscripts/dev.sh
```

- Web UI: `http://localhost:3000/`
- API health: `http://localhost:4100/api/v1/health`
- کاربران نمونه (seed): `admin` / `planner` / `keeper` / `viewer` — گذرواژه `Kpims@1404`

## ۴) دیتابیس و migrationها

در محیط توسعه، PostgreSQL به‌صورت embedded با باینری‌های داخل
`node_modules/@embedded-postgres/linux-x64` اجرا می‌شود (داده‌ها در `db/data`، پورت `5433`).

```bash
npm run db:start      # راه‌اندازی PostgreSQL embedded (idempotent)
npm run db:status     # وضعیت
npm run db:stop       # توقف

npm run db:migrate    # prisma migrate dev — ساخت/اعمال migration در توسعه
npm run db:deploy     # prisma migrate deploy — فقط اعمال migrationهای آماده (تولید)
npm run db:seed       # داده نمونه (idempotent — اگر داده باشد کاری نمی‌کند)
npm run db:studio     # Prisma Studio
```

### جریان استاندارد تغییر اسکیما (فازهای بعد)

```bash
# 1) schema.prisma را ویرایش کنید، سپس:
npm run db:migrate -- --name describe_change
# 2) برای migration دستی (CHECK/INDEX خاص):
npm run db:migrate -- --create-only --name describe_change
#    فایل backend/prisma/migrations/<ts>_describe_change/migration.sql را ویرایش و سپس:
npm run db:migrate
```

### استقرار در تولید
1. PostgreSQL واقعی (RDS/سرویس ابری) را provisions کنید؛ `DATABASE_URL` را از Secrets manager بدهید.
2. `npm run db:deploy` (هرگز `migrate dev` روی تولید).
3. `npm run build` → `node backend/dist/server.js` پشت reverse proxy.
4. فرانت build‌شده (`frontend/dist`) را روی CDN/nginx بگذارید و `VITE_API_BASE_URL` را به مسیر عمومی API اشاره دهید.

## ۵) اعتبارسنجی سلامت

```bash
curl http://localhost:4100/api/v1/health          # وضعیت DB + تاریخ جلالی امروز
curl -X POST http://localhost:4100/api/v1/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"Kpims@1404"}'
curl http://localhost:4100/api/v1/dashboard/summary -H "Authorization: Bearer <TOKEN>"
```

مسیرهای ماژول‌های فاز بعد (مثل `/api/v1/inventory/...`) عمداً `501 Not Implemented`
برمی‌گردانند تا مرز پیاده‌سازی شفاف بماند.

## ۶) رفع اشکال

| مشکل | راه‌حل |
|---|---|
| پورت 5433 اشغال است | `PG_PORT=5434 npm run db:start` و به‌روزرسانی `DATABASE_URL` |
| `JWT_SECRET must be at least 16 characters` | `node scripts/ensure-env.mjs` را اجرا کنید یا مقدار دستی بدهید |
| seed اجرا نمی‌شود | اول `npm run db:start`، بعد `npm run db:seed` (اسکریپت `prisma.mjs` خودش دیتابیس را بالا می‌آورد) |
| صفحه خالی در پروداکشن | `VITE_API_BASE_URL` باید به API واقعی اشاره کند (CORS را هم چک کنید) |
