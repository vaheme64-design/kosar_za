# KPIMS — دیکشنری داده (Data Dictionary)

> این سند **به‌صورت خودکار** از `backend/prisma/schema.prisma` تولید شده است
> (`npm run docs:dictionary`). همیشه با نسخه‌ی فعلی اسکیما هم‌خوان است.

**قراردادهای کلی:**

- کلید اصلی همه جداول: `id UUID` (تولید سمت کلاینت Prisma).
- نام جداول/ستون‌ها snake_case (برای سازگاری با SQL خام و یکپارچگی ERP).
- مقادیر کمیتی و وزن: `DECIMAL` (بدون float) — معمولاً `DECIMAL(18,4)`.
- زمان‌ها UTC با `TIMESTAMPTZ(6)`؛ تاریخ‌های کاری `DATE` (نمایش تقویم جلالی در لایه نمایش).
- وضعیت گردش کار (`status`) از وضعیت قطع‌بوش (`posting_status`) جدا است.
- تراکنش‌های انبار (`inventory_transactions`) تغییرناپذیرند؛ اصلاح فقط با سند ابطال.

---

## CONTROL — داده‌های کنترلی

### User → `users`

کاربر سامانه

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `username` | username | VarChar(64) | String | ✓ |  | UNIQUE |
| `email` | email | VarChar(190) | String? |  |  | UNIQUE |
| `full_name` | fullName | VarChar(190) | String | ✓ |  |  |
| `password_hash` | passwordHash | VarChar(255) | String | ✓ |  |  |
| `is_active` | isActive | Boolean | Boolean | ✓ | true |  |
| `role_id` | roleId | Uuid | String | ✓ |  |  |
| `last_login_at` | lastLoginAt | Timestamptz(6) | DateTime? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | role | — | رابطه ← Role | ✓ | | |
| — | createdPlans | — | رابطه ← ProductionPlan[] |  | | |
| — | confirmedPlans | — | رابطه ← ProductionPlan[] |  | | |
| — | createdInventoryDocuments | — | رابطه ← InventoryDocument[] |  | | |
| — | postedInventoryDocuments | — | رابطه ← InventoryDocument[] |  | | |
| — | createdTransactions | — | رابطه ← InventoryTransaction[] |  | | |
| — | operatedReports | — | رابطه ← ProductionReport[] |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([roleId])`

### Role → `roles`

نقش کاربری

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `name` | name | VarChar(64) | String | ✓ |  | UNIQUE |
| `name_fa` | nameFa | VarChar(190) | String | ✓ |  |  |
| `description` | description | VarChar(500) | String? |  |  |  |
| `is_active` | isActive | Boolean | Boolean | ✓ | true |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |

### Permission → `permissions`

مجوز (ماژول + عملیات)

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `code` | code | VarChar(100) | String | ✓ |  | UNIQUE |
| `module` | module | VarChar(64) | String | ✓ |  |  |
| `action` | action | VarChar(64) | String | ✓ |  |  |
| `description` | description | VarChar(500) | String? |  |  |  |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([module])`

### RolePermission → `role_permissions`

رابط نقش–مجوز

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `role_id` | roleId | Uuid | String | ✓ |  |  |
| `permission_id` | permissionId | Uuid | String | ✓ |  |  |
| `assigned_at` | assignedAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| — | role | — | رابطه ← Role | ✓ | | |
| — | permission | — | رابطه ← Permission | ✓ | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([permissionId])`

### AuditLog → `audit_logs`

لاگ حسابرسی (فقط درج — توسط سرویس‌ها نوشته می‌شود)

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `user_id` | userId | Uuid | String? |  |  |  |
| `action` | action | VarChar(64) | String | ✓ |  |  |
| `entity_type` | entityType | VarChar(64) | String? |  |  |  |
| `entity_id` | entityId | VarChar(64) | String? |  |  |  |
| `ip_address` | ipAddress | VarChar(45) | String? |  |  |  |
| `user_agent` | userAgent | VarChar(500) | String? |  |  |  |
| `occurred_at` | occurredAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| — | user | — | رابطه ← User? |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([userId])`
- `@@index([occurredAt])`
- `@@index([entityType, entityId])`

### DocumentSequence → `document_sequences`

دنباله شماره‌گذاری اسناد (شماره سند یکتا)

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `key` | key | VarChar(32) | String | ✓ |  | UNIQUE |
| `title` | title | VarChar(190) | String? |  |  |  |
| `prefix` | prefix | VarChar(16) | String | ✓ |  |  |
| `next_number` | nextNumber | Int | Int | ✓ | 1 |  |
| `pad_length` | padLength | Int | Int | ✓ | 6 |  |
| — | resetPolicy | — | رابطه ← SequenceResetPolicy | ✓ | | |
| `last_reset_year` | lastResetYear | Int? | Int? |  |  |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |

### SystemSetting → `system_settings`

تنظیمات سامانه

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `key` | key | VarChar(100) | String | ✓ |  | UNIQUE |
| `value` | value | Text | String | ✓ |  |  |
| — | valueType | — | رابطه ← SettingValueType | ✓ | | |
| `description` | description | VarChar(500) | String? |  |  |  |
| `is_secret` | isSecret | Boolean | Boolean | ✓ | false |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |

---

## MASTER DATA — اطلاعات پایه

### UnitOfMeasure → `units_of_measure`

واحد شمارش

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `code` | code | VarChar(16) | String | ✓ |  | UNIQUE |
| `name_fa` | nameFa | VarChar(190) | String | ✓ |  |  |
| `name_en` | nameEn | VarChar(190) | String | ✓ |  |  |
| — | kind | — | رابطه ← UnitKind | ✓ | | |
| `is_active` | isActive | Boolean | Boolean | ✓ | true |  |

### Material → `materials`

ماده اولیه (ورق، رنگ و ...) — تأمین‌کننده اصلی: SAPCO

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `material_code` | materialCode | VarChar(64) | String | ✓ |  | UNIQUE |
| `name_fa` | nameFa | VarChar(190) | String | ✓ |  |  |
| `name_en` | nameEn | VarChar(190) | String? |  |  |  |
| — | materialType | — | رابطه ← MaterialType | ✓ | | |
| `grade` | grade | VarChar(64) | String? |  |  |  |
| `thickness_mm` | thicknessMm | Decimal(10, 3) | Decimal? |  |  |  |
| `width_mm` | widthMm | Decimal(10, 2) | Decimal? |  |  |  |
| `length_mm` | lengthMm | Decimal(10, 2) | Decimal? |  |  |  |
| `unit_weight_kg` | unitWeightKg | Decimal(18, 4) | Decimal? |  |  |  |
| `base_unit_id` | baseUnitId | Uuid | String | ✓ |  |  |
| `supplier_name` | supplierName | VarChar(190) | String | ✓ | "SAPCO" |  |
| — | status | — | رابطه ← MaterialStatus | ✓ | | |
| `notes` | notes | Text | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | baseUnit | — | رابطه ← UnitOfMeasure | ✓ | | |
| — | parts | — | رابطه ← Part[] |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([materialType])`
- `@@index([supplierName])`

### Part → `parts`

قطعه (محصول)

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `part_number` | partNumber | VarChar(64) | String | ✓ |  | UNIQUE |
| `name_fa` | nameFa | VarChar(190) | String | ✓ |  |  |
| `name_en` | nameEn | VarChar(190) | String? |  |  |  |
| — | partType | — | رابطه ← PartType | ✓ | | |
| — | status | — | رابطه ← PartStatus | ✓ | | |
| `base_unit_id` | baseUnitId | Uuid | String | ✓ |  |  |
| `standard_weight_kg` | standardWeightKg | Decimal(18, 4) | Decimal? |  |  |  |
| `main_material_id` | mainMaterialId | Uuid | String? |  |  |  |
| `primary_customer_id` | primaryCustomerId | Uuid | String? |  |  |  |
| `description` | description | Text | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | baseUnit | — | رابطه ← UnitOfMeasure | ✓ | | |
| — | mainMaterial | — | رابطه ← Material? |  | | |
| — | primaryCustomer | — | رابطه ← Customer? |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([partType])`
- `@@index([status])`
- `@@index([mainMaterialId])`
- `@@index([primaryCustomerId])`

### Customer → `customers`

مشتری

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `code` | code | VarChar(32) | String | ✓ |  | UNIQUE |
| `name_fa` | nameFa | VarChar(190) | String | ✓ |  |  |
| `name_en` | nameEn | VarChar(190) | String? |  |  |  |
| `contact_person` | contactPerson | VarChar(190) | String? |  |  |  |
| `phone` | phone | VarChar(32) | String? |  |  |  |
| `email` | email | VarChar(190) | String? |  |  |  |
| `address` | address | Text | String? |  |  |  |
| `is_active` | isActive | Boolean | Boolean | ✓ | true |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([isActive])`

### Operation → `operations`

عملیات تولید (برش، خالی‌بری، خم، پرس/فرم، جوش پرس، جوش CO2، رنگ، مونتاژ)

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `code` | code | VarChar(16) | String | ✓ |  | UNIQUE |
| `name_fa` | nameFa | VarChar(190) | String | ✓ |  |  |
| `name_en` | nameEn | VarChar(190) | String | ✓ |  |  |
| `description` | description | Text | String? |  |  |  |
| `default_setup_time_min` | defaultSetupTimeMin | Int? | Int? |  |  |  |
| `default_cycle_time_sec` | defaultCycleTimeSec | Decimal(10, 2) | Decimal? |  |  |  |
| `is_active` | isActive | Boolean | Boolean | ✓ | true |  |

### PartRoute → `part_routes`

مسیر تولید قطعه — با نسخه‌بندی (rule 10)

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `part_id` | partId | Uuid | String | ✓ |  |  |
| `name` | name | VarChar(190) | String? |  |  |  |
| — | status | — | رابطه ← RouteStatus | ✓ | | |
| `description` | description | Text | String? |  |  |  |
| `effective_from` | effectiveFrom | Date | DateTime? |  |  |  |
| `superseded_by_id` | supersededById | Uuid | String? |  |  | UNIQUE |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | part | — | رابطه ← Part | ✓ | | |
| — | supersededBy | — | رابطه ← PartRoute? |  | | |
| — | supersedes | — | رابطه ← PartRoute? |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@unique([partId, version])`
- `@@index([partId])`
- `@@index([status])`

### PartRouteStep → `part_route_steps`

مرحله مسیر تولید

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `route_id` | routeId | Uuid | String | ✓ |  |  |
| `operation_id` | operationId | Uuid | String | ✓ |  |  |
| `machine_id` | machineId | Uuid | String? |  |  |  |
| `die_id` | dieId | Uuid | String? |  |  |  |
| `setup_time_min` | setupTimeMin | Int? | Int? |  |  |  |
| `cycle_time_sec` | cycleTimeSec | Decimal(10, 2) | Decimal? |  |  |  |
| `scrap_factor_pct` | scrapFactorPct | Decimal(5, 2) | Decimal | ✓ | 0 |  |
| `description` | description | Text | String? |  |  |  |
| — | route | — | رابطه ← PartRoute | ✓ | | |
| — | operation | — | رابطه ← Operation | ✓ | | |
| — | machine | — | رابطه ← Machine? |  | | |
| — | die | — | رابطه ← Die? |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@unique([routeId, sequence])`
- `@@index([operationId])`
- `@@index([machineId])`
- `@@index([dieId])`

### Machine → `machines`

ماشین / ایستگاه

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `code` | code | VarChar(32) | String | ✓ |  | UNIQUE |
| `name_fa` | nameFa | VarChar(190) | String | ✓ |  |  |
| `name_en` | nameEn | VarChar(190) | String? |  |  |  |
| — | machineType | — | رابطه ← MachineType | ✓ | | |
| `tonnage` | tonnage | Decimal(10, 2) | Decimal? |  |  |  |
| `manufacturer` | manufacturer | VarChar(190) | String? |  |  |  |
| `location` | location | VarChar(190) | String? |  |  |  |
| — | status | — | رابطه ← MachineStatus | ✓ | | |
| `notes` | notes | Text | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([machineType])`
- `@@index([status])`

### MachineCapability → `machine_capabilities`

توانایی ماشین برای انجام یک عملیات

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `machine_id` | machineId | Uuid | String | ✓ |  |  |
| `operation_id` | operationId | Uuid | String | ✓ |  |  |
| `standard_rate_per_hour` | standardRatePerHour | Decimal(10, 2) | Decimal? |  |  |  |
| `notes` | notes | VarChar(500) | String? |  |  |  |
| — | machine | — | رابطه ← Machine | ✓ | | |
| — | operation | — | رابطه ← Operation | ✓ | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([operationId])`

### Die → `dies`

قالب

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `code` | code | VarChar(32) | String | ✓ |  | UNIQUE |
| `name_fa` | nameFa | VarChar(190) | String | ✓ |  |  |
| `description` | description | Text | String? |  |  |  |
| — | status | — | رابطه ← DieStatus | ✓ | | |
| `storage_location` | storageLocation | VarChar(190) | String? |  |  |  |
| `notes` | notes | Text | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |

### MachineDieCompatibility → `machine_die_compatibility`

سازگاری قالب با ماشین

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `machine_id` | machineId | Uuid | String | ✓ |  |  |
| `die_id` | dieId | Uuid | String | ✓ |  |  |
| `notes` | notes | VarChar(500) | String? |  |  |  |
| — | machine | — | رابطه ← Machine | ✓ | | |
| — | die | — | رابطه ← Die | ✓ | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([dieId])`

### Warehouse → `warehouses`

انبار

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `code` | code | VarChar(16) | String | ✓ |  | UNIQUE |
| `name_fa` | nameFa | VarChar(190) | String | ✓ |  |  |
| — | warehouseType | — | رابطه ← WarehouseType | ✓ | | |
| `is_active` | isActive | Boolean | Boolean | ✓ | true |  |
| `notes` | notes | Text | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | outgoingProductionTransfers | — | رابطه ← ProductionTransfer[] |  | | |
| — | incomingProductionTransfers | — | رابطه ← ProductionTransfer[] |  | | |

### WarehouseLocation → `warehouse_locations`

موقعیت مکانی در انبار

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `warehouse_id` | warehouseId | Uuid | String | ✓ |  |  |
| `code` | code | VarChar(32) | String | ✓ |  |  |
| `name_fa` | nameFa | VarChar(190) | String | ✓ |  |  |
| `capacity_kg` | capacityKg | Decimal(18, 2) | Decimal? |  |  |  |
| `is_active` | isActive | Boolean | Boolean | ✓ | true |  |
| — | warehouse | — | رابطه ← Warehouse | ✓ | | |
| — | documentLinesFrom | — | رابطه ← InventoryDocumentLine[] |  | | |
| — | documentLinesTo | — | رابطه ← InventoryDocumentLine[] |  | | |
| — | transactions | — | رابطه ← InventoryTransaction[] |  | | |
| — | balances | — | رابطه ← StockBalance[] |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@unique([warehouseId, code])`

### Shift → `shifts`

شیفت کاری

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `code` | code | VarChar(16) | String | ✓ |  | UNIQUE |
| `name_fa` | nameFa | VarChar(190) | String | ✓ |  |  |
| `start_time` | startTime | VarChar(5) | String | ✓ |  |  |
| `end_time` | endTime | VarChar(5) | String | ✓ |  |  |
| `is_active` | isActive | Boolean | Boolean | ✓ | true |  |

---

## PRODUCTION DATA — داده‌های تولید

### CustomerOrder → `customer_orders`

سفارش مشتری (سربرگ)

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `order_number` | orderNumber | VarChar(32) | String | ✓ |  | UNIQUE |
| `customer_id` | customerId | Uuid | String | ✓ |  |  |
| `order_date` | orderDate | Date | DateTime | ✓ |  |  |
| `due_date` | dueDate | Date | DateTime? |  |  |  |
| — | status | — | رابطه ← CustomerOrderStatus | ✓ | | |
| `description` | description | Text | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | customer | — | رابطه ← Customer | ✓ | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([customerId])`
- `@@index([status])`
- `@@index([orderDate])`

### CustomerOrderLine → `customer_order_lines`

ردیف سفارش مشتری

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `order_id` | orderId | Uuid | String | ✓ |  |  |
| `line_no` | lineNo | Int | Int | ✓ |  |  |
| `part_id` | partId | Uuid | String | ✓ |  |  |
| `quantity` | quantity | Decimal(18, 4) | Decimal | ✓ |  |  |
| `delivered_quantity` | deliveredQuantity | Decimal(18, 4) | Decimal | ✓ | 0 |  |
| `due_date` | dueDate | Date | DateTime? |  |  |  |
| — | status | — | رابطه ← OrderLineStatus | ✓ | | |
| `notes` | notes | Text | String? |  |  |  |
| — | order | — | رابطه ← CustomerOrder | ✓ | | |
| — | part | — | رابطه ← Part | ✓ | | |
| — | reservations | — | رابطه ← InventoryReservation[] |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@unique([orderId, lineNo])`
- `@@index([partId])`

### ProductionPlan → `production_plans`

برنامه تولید (سربرگ)

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `plan_number` | planNumber | VarChar(32) | String | ✓ |  | UNIQUE |
| `title` | title | VarChar(190) | String | ✓ |  |  |
| `period_start` | periodStart | Date | DateTime | ✓ |  |  |
| `period_end` | periodEnd | Date | DateTime | ✓ |  |  |
| — | status | — | رابطه ← PlanStatus | ✓ | | |
| `description` | description | Text | String? |  |  |  |
| `created_by_id` | createdById | Uuid | String | ✓ |  |  |
| `confirmed_at` | confirmedAt | Timestamptz(6) | DateTime? |  |  |  |
| `confirmed_by_id` | confirmedById | Uuid | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | createdBy | — | رابطه ← User | ✓ | | |
| — | confirmedBy | — | رابطه ← User? |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([status])`
- `@@index([periodStart])`
- `@@index([createdById])`

### ProductionPlanLine → `production_plan_lines`

ردیف برنامه تولید

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `plan_id` | planId | Uuid | String | ✓ |  |  |
| `line_no` | lineNo | Int | Int | ✓ |  |  |
| `part_id` | partId | Uuid | String | ✓ |  |  |
| `planned_quantity` | plannedQuantity | Decimal(18, 4) | Decimal | ✓ |  |  |
| `customer_order_line_id` | customerOrderLineId | Uuid | String? |  |  |  |
| `notes` | notes | Text | String? |  |  |  |
| — | plan | — | رابطه ← ProductionPlan | ✓ | | |
| — | part | — | رابطه ← Part | ✓ | | |
| — | customerOrderLine | — | رابطه ← CustomerOrderLine? |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@unique([planId, lineNo])`
- `@@index([partId])`
- `@@index([customerOrderLineId])`

### ManufacturingOrder → `manufacturing_orders`

دستور کار ساخت

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `mo_number` | moNumber | VarChar(32) | String | ✓ |  | UNIQUE |
| `part_id` | partId | Uuid | String | ✓ |  |  |
| `route_id` | routeId | Uuid | String? |  |  |  |
| `plan_line_id` | planLineId | Uuid | String? |  |  |  |
| `quantity` | quantity | Decimal(18, 4) | Decimal | ✓ |  |  |
| `due_date` | dueDate | Date | DateTime? |  |  |  |
| — | priority | — | رابطه ← MoPriority | ✓ | | |
| — | status | — | رابطه ← MoStatus | ✓ | | |
| `released_at` | releasedAt | Timestamptz(6) | DateTime? |  |  |  |
| `completed_at` | completedAt | Timestamptz(6) | DateTime? |  |  |  |
| `notes` | notes | Text | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | part | — | رابطه ← Part | ✓ | | |
| — | route | — | رابطه ← PartRoute? |  | | |
| — | planLine | — | رابطه ← ProductionPlanLine? |  | | |
| — | reservations | — | رابطه ← InventoryReservation[] |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([partId])`
- `@@index([status])`
- `@@index([dueDate])`
- `@@index([routeId])`
- `@@index([planLineId])`

### ProductionOperation → `production_operations`

عملیات اجرایی یک دستور کار

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `manufacturing_order_id` | manufacturingOrderId | Uuid | String | ✓ |  |  |
| `operation_id` | operationId | Uuid | String | ✓ |  |  |
| `route_step_id` | routeStepId | Uuid | String? |  |  |  |
| `machine_id` | machineId | Uuid | String? |  |  |  |
| — | status | — | رابطه ← OperationStatus | ✓ | | |
| `planned_start` | plannedStart | Timestamptz(6) | DateTime? |  |  |  |
| `planned_end` | plannedEnd | Timestamptz(6) | DateTime? |  |  |  |
| `actual_start` | actualStart | Timestamptz(6) | DateTime? |  |  |  |
| `actual_end` | actualEnd | Timestamptz(6) | DateTime? |  |  |  |
| `planned_quantity` | plannedQuantity | Decimal(18, 4) | Decimal | ✓ |  |  |
| `produced_quantity` | producedQuantity | Decimal(18, 4) | Decimal | ✓ | 0 |  |
| `scrapped_quantity` | scrappedQuantity | Decimal(18, 4) | Decimal | ✓ | 0 |  |
| `notes` | notes | Text | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | manufacturingOrder | — | رابطه ← ManufacturingOrder | ✓ | | |
| — | operation | — | رابطه ← Operation | ✓ | | |
| — | routeStep | — | رابطه ← PartRouteStep? |  | | |
| — | machine | — | رابطه ← Machine? |  | | |
| — | outgoingTransfers | — | رابطه ← ProductionTransfer[] |  | | |
| — | incomingTransfers | — | رابطه ← ProductionTransfer[] |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@unique([manufacturingOrderId, sequence])`
- `@@index([operationId])`
- `@@index([machineId])`
- `@@index([status])`

### ProductionReport → `production_reports`

گزارش تولید (تولید شیفت/روز) — وضعیت سند و وضعیت قطع‌بوش جدا است

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `report_number` | reportNumber | VarChar(32) | String | ✓ |  | UNIQUE |
| `operation_id` | operationId | Uuid | String | ✓ |  |  |
| `machine_id` | machineId | Uuid | String? |  |  |  |
| `die_id` | dieId | Uuid | String? |  |  |  |
| `shift_id` | shiftId | Uuid | String? |  |  |  |
| `operator_id` | operatorId | Uuid | String? |  |  |  |
| `report_date` | reportDate | Date | DateTime | ✓ |  |  |
| `produced_quantity` | producedQuantity | Decimal(18, 4) | Decimal | ✓ |  |  |
| `rework_quantity` | reworkQuantity | Decimal(18, 4) | Decimal | ✓ | 0 |  |
| — | status | — | رابطه ← ReportStatus | ✓ | | |
| — | postingStatus | — | رابطه ← PostingStatus | ✓ | | |
| `posted_at` | postedAt | Timestamptz(6) | DateTime? |  |  |  |
| `notes` | notes | Text | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | operation | — | رابطه ← ProductionOperation | ✓ | | |
| — | machine | — | رابطه ← Machine? |  | | |
| — | die | — | رابطه ← Die? |  | | |
| — | shift | — | رابطه ← Shift? |  | | |
| — | operator | — | رابطه ← User? |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([operationId])`
- `@@index([machineId])`
- `@@index([reportDate])`
- `@@index([postingStatus])`

### ProductionScrap → `production_scraps`

ضایعات تولید

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `report_id` | reportId | Uuid | String? |  |  |  |
| `operation_id` | operationId | Uuid | String? |  |  |  |
| `part_id` | partId | Uuid | String? |  |  |  |
| `quantity` | quantity | Decimal(18, 4) | Decimal | ✓ |  |  |
| `weight_kg` | weightKg | Decimal(18, 4) | Decimal? |  |  |  |
| `description` | description | Text | String? |  |  |  |
| `scrap_date` | scrapDate | Date | DateTime | ✓ |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| — | report | — | رابطه ← ProductionReport? |  | | |
| — | operation | — | رابطه ← ProductionOperation? |  | | |
| — | part | — | رابطه ← Part? |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([reportId])`
- `@@index([operationId])`
- `@@index([partId])`
- `@@index([scrapDate])`

### ProductionTransfer → `production_transfers`

انتقال بین عملیاتی / بین انبارهای در جریان ساخت

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `transfer_number` | transferNumber | VarChar(32) | String | ✓ |  | UNIQUE |
| `part_id` | partId | Uuid | String | ✓ |  |  |
| `from_operation_id` | fromOperationId | Uuid | String? |  |  |  |
| `to_operation_id` | toOperationId | Uuid | String? |  |  |  |
| `from_warehouse_id` | fromWarehouseId | Uuid | String? |  |  |  |
| `to_warehouse_id` | toWarehouseId | Uuid | String? |  |  |  |
| `quantity` | quantity | Decimal(18, 4) | Decimal | ✓ |  |  |
| `weight_kg` | weightKg | Decimal(18, 4) | Decimal? |  |  |  |
| `transfer_date` | transferDate | Date | DateTime | ✓ |  |  |
| — | status | — | رابطه ← TransferStatus | ✓ | | |
| — | postingStatus | — | رابطه ← PostingStatus | ✓ | | |
| `notes` | notes | Text | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | part | — | رابطه ← Part | ✓ | | |
| — | fromOperation | — | رابطه ← ProductionOperation? |  | | |
| — | toOperation | — | رابطه ← ProductionOperation? |  | | |
| — | fromWarehouse | — | رابطه ← Warehouse? |  | | |
| — | toWarehouse | — | رابطه ← Warehouse? |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([partId])`
- `@@index([transferDate])`
- `@@index([postingStatus])`

### MachineAssignment → `machine_assignments`

تخصیص ماشین (و قالب) به عملیات

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `operation_id` | operationId | Uuid | String | ✓ |  |  |
| `machine_id` | machineId | Uuid | String | ✓ |  |  |
| `die_id` | dieId | Uuid | String? |  |  |  |
| `shift_id` | shiftId | Uuid | String? |  |  |  |
| `planned_start` | plannedStart | Timestamptz(6) | DateTime | ✓ |  |  |
| `planned_end` | plannedEnd | Timestamptz(6) | DateTime? |  |  |  |
| — | status | — | رابطه ← AssignmentStatus | ✓ | | |
| `notes` | notes | Text | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | operation | — | رابطه ← ProductionOperation | ✓ | | |
| — | machine | — | رابطه ← Machine | ✓ | | |
| — | die | — | رابطه ← Die? |  | | |
| — | shift | — | رابطه ← Shift? |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([operationId])`
- `@@index([machineId])`
- `@@index([status])`

---

## INVENTORY DATA — داده‌های انبار

### InventoryDocument → `inventory_documents`

سند انبار (رسید/حواله/انتقال/اصلاحیه) — وضعیت سند و قطع‌بوش جدا است

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `document_number` | documentNumber | VarChar(32) | String | ✓ |  | UNIQUE |
| — | documentType | — | رابطه ← InventoryDocType | ✓ | | |
| — | status | — | رابطه ← InventoryDocStatus | ✓ | | |
| — | postingStatus | — | رابطه ← PostingStatus | ✓ | | |
| `document_date` | documentDate | Date | DateTime | ✓ |  |  |
| `warehouse_id` | warehouseId | Uuid | String | ✓ |  |  |
| `reference_type` | referenceType | VarChar(64) | String? |  |  |  |
| `reference_id` | referenceId | Uuid | String? |  |  |  |
| `description` | description | Text | String? |  |  |  |
| `created_by_id` | createdById | Uuid | String | ✓ |  |  |
| `posted_by_id` | postedById | Uuid | String? |  |  |  |
| `posted_at` | postedAt | Timestamptz(6) | DateTime? |  |  |  |
| `reversal_of_id` | reversalOfId | Uuid | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | warehouse | — | رابطه ← Warehouse | ✓ | | |
| — | createdBy | — | رابطه ← User | ✓ | | |
| — | postedBy | — | رابطه ← User? |  | | |
| — | reversalOf | — | رابطه ← InventoryDocument? |  | | |
| — | reversals | — | رابطه ← InventoryDocument[] |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([warehouseId])`
- `@@index([documentType])`
- `@@index([status])`
- `@@index([postingStatus])`
- `@@index([documentDate])`
- `@@index([reversalOfId])`

### InventoryDocumentLine → `inventory_document_lines`

ردیف سند انبار

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `document_id` | documentId | Uuid | String | ✓ |  |  |
| `line_no` | lineNo | Int | Int | ✓ |  |  |
| `part_id` | partId | Uuid | String? |  |  |  |
| `material_id` | materialId | Uuid | String? |  |  |  |
| `lot_id` | lotId | Uuid | String? |  |  |  |
| `quantity` | quantity | Decimal(18, 4) | Decimal | ✓ |  |  |
| `unit_id` | unitId | Uuid | String | ✓ |  |  |
| `weight_kg` | weightKg | Decimal(18, 4) | Decimal? |  |  |  |
| `from_location_id` | fromLocationId | Uuid | String? |  |  |  |
| `to_location_id` | toLocationId | Uuid | String? |  |  |  |
| `notes` | notes | Text | String? |  |  |  |
| — | document | — | رابطه ← InventoryDocument | ✓ | | |
| — | part | — | رابطه ← Part? |  | | |
| — | material | — | رابطه ← Material? |  | | |
| — | lot | — | رابطه ← MaterialLot? |  | | |
| — | unit | — | رابطه ← UnitOfMeasure | ✓ | | |
| — | fromLocation | — | رابطه ← WarehouseLocation? |  | | |
| — | toLocation | — | رابطه ← WarehouseLocation? |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@unique([documentId, lineNo])`
- `@@index([partId])`
- `@@index([materialId])`
- `@@index([lotId])`

### InventoryTransaction → `inventory_transactions`

تراکنش انبار — دفتر کل تغییرناپذیر (immutable ledger)

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `transaction_number` | transactionNumber | VarChar(32) | String | ✓ |  | UNIQUE |
| `document_id` | documentId | Uuid | String? |  |  |  |
| `document_line_id` | documentLineId | Uuid | String? |  |  |  |
| `part_id` | partId | Uuid | String? |  |  |  |
| `material_id` | materialId | Uuid | String? |  |  |  |
| `warehouse_id` | warehouseId | Uuid | String | ✓ |  |  |
| `location_id` | locationId | Uuid | String? |  |  |  |
| `lot_id` | lotId | Uuid | String? |  |  |  |
| `quantity` | quantity | Decimal(18, 4) | Decimal | ✓ |  |  |
| `unit_id` | unitId | Uuid | String | ✓ |  |  |
| `weight_kg` | weightKg | Decimal(18, 4) | Decimal? |  |  |  |
| `occurred_at` | occurredAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `reversal_of_id` | reversalOfId | Uuid | String? |  |  |  |
| `created_by_id` | createdById | Uuid | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| — | document | — | رابطه ← InventoryDocument? |  | | |
| — | documentLine | — | رابطه ← InventoryDocumentLine? |  | | |
| — | part | — | رابطه ← Part? |  | | |
| — | material | — | رابطه ← Material? |  | | |
| — | warehouse | — | رابطه ← Warehouse | ✓ | | |
| — | location | — | رابطه ← WarehouseLocation? |  | | |
| — | lot | — | رابطه ← MaterialLot? |  | | |
| — | unit | — | رابطه ← UnitOfMeasure | ✓ | | |
| — | createdBy | — | رابطه ← User? |  | | |
| — | reversalOf | — | رابطه ← InventoryTransaction? |  | | |
| — | reversals | — | رابطه ← InventoryTransaction[] |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([documentId])`
- `@@index([documentLineId])`
- `@@index([partId])`
- `@@index([materialId])`
- `@@index([warehouseId])`
- `@@index([locationId])`
- `@@index([lotId])`
- `@@index([occurredAt])`
- `@@index([type])`

### InventoryReservation → `inventory_reservations`

رزرو موجودی برای سفارش/دستور کار

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `part_id` | partId | Uuid | String? |  |  |  |
| `material_id` | materialId | Uuid | String? |  |  |  |
| `warehouse_id` | warehouseId | Uuid | String? |  |  |  |
| `quantity` | quantity | Decimal(18, 4) | Decimal | ✓ |  |  |
| `unit_id` | unitId | Uuid | String | ✓ |  |  |
| `for_manufacturing_order_id` | forManufacturingOrderId | Uuid | String? |  |  |  |
| `for_customer_order_line_id` | forCustomerOrderLineId | Uuid | String? |  |  |  |
| — | status | — | رابطه ← ReservationStatus | ✓ | | |
| `expires_at` | expiresAt | Timestamptz(6) | DateTime? |  |  |  |
| `notes` | notes | Text | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | part | — | رابطه ← Part? |  | | |
| — | material | — | رابطه ← Material? |  | | |
| — | warehouse | — | رابطه ← Warehouse? |  | | |
| — | unit | — | رابطه ← UnitOfMeasure | ✓ | | |
| — | forManufacturingOrder | — | رابطه ← ManufacturingOrder? |  | | |
| — | forCustomerOrderLine | — | رابطه ← CustomerOrderLine? |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([partId])`
- `@@index([materialId])`
- `@@index([warehouseId])`
- `@@index([status])`
- `@@index([forManufacturingOrderId])`
- `@@index([forCustomerOrderLineId])`

### StockBalance → `stock_balances`

موجودی رسمی انبار — فقط سمت سرور و در همان تراکنش دیتابیسِ ثبت، به‌روزرسانی می‌شود

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `part_id` | partId | Uuid | String? |  |  |  |
| `material_id` | materialId | Uuid | String? |  |  |  |
| `warehouse_id` | warehouseId | Uuid | String | ✓ |  |  |
| `location_id` | locationId | Uuid | String? |  |  |  |
| `lot_id` | lotId | Uuid | String? |  |  |  |
| `quantity` | quantity | Decimal(18, 4) | Decimal | ✓ | 0 |  |
| `weight_kg` | weightKg | Decimal(18, 4) | Decimal | ✓ | 0 |  |
| `last_transaction_at` | lastTransactionAt | Timestamptz(6) | DateTime? |  |  |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | part | — | رابطه ← Part? |  | | |
| — | material | — | رابطه ← Material? |  | | |
| — | warehouse | — | رابطه ← Warehouse | ✓ | | |
| — | location | — | رابطه ← WarehouseLocation? |  | | |
| — | lot | — | رابطه ← MaterialLot? |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@unique([partId, materialId, warehouseId, locationId, lotId])`
- `@@index([warehouseId])`
- `@@index([partId])`
- `@@index([materialId])`
- `@@index([locationId])`
- `@@index([lotId])`

### MaterialLot → `material_lots`

بچ/لوت ماده اولیه (ردیابی ورق‌های دریافتی از SAPCO)

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `material_id` | materialId | Uuid | String | ✓ |  |  |
| `lot_number` | lotNumber | VarChar(64) | String | ✓ |  |  |
| `receipt_date` | receiptDate | Date | DateTime | ✓ |  |  |
| `quantity_received` | quantityReceived | Decimal(18, 4) | Decimal | ✓ |  |  |
| `quantity_remaining` | quantityRemaining | Decimal(18, 4) | Decimal | ✓ |  |  |
| `weight_received_kg` | weightReceivedKg | Decimal(18, 4) | Decimal | ✓ |  |  |
| `weight_remaining_kg` | weightRemainingKg | Decimal(18, 4) | Decimal | ✓ |  |  |
| — | status | — | رابطه ← LotStatus | ✓ | | |
| `certificate_number` | certificateNumber | VarChar(190) | String? |  |  |  |
| `supplier_lot_number` | supplierLotNumber | VarChar(190) | String? |  |  |  |
| `notes` | notes | Text | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | material | — | رابطه ← Material | ✓ | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@unique([materialId, lotNumber])`
- `@@index([status])`
- `@@index([receiptDate])`

### MaterialContract → `material_contracts`

قرارداد خرید ماده اولیه (SAPCO)

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `contract_number` | contractNumber | VarChar(32) | String | ✓ |  | UNIQUE |
| `supplier_name` | supplierName | VarChar(190) | String | ✓ | "SAPCO" |  |
| `material_id` | materialId | Uuid | String | ✓ |  |  |
| `order_date` | orderDate | Date | DateTime | ✓ |  |  |
| `expected_delivery_date` | expectedDeliveryDate | Date | DateTime? |  |  |  |
| `total_quantity` | totalQuantity | Decimal(18, 4) | Decimal | ✓ |  |  |
| `total_weight_kg` | totalWeightKg | Decimal(18, 4) | Decimal? |  |  |  |
| — | status | — | رابطه ← ContractStatus | ✓ | | |
| `description` | description | Text | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| `updated_at` | updatedAt | Timestamptz(6) | DateTime | ✓ |  |  |
| — | material | — | رابطه ← Material | ✓ | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([materialId])`
- `@@index([status])`
- `@@index([orderDate])`

### MaterialContractTransaction → `material_contract_transactions`

تراکنش قرارداد (دریافت‌های انجام‌شده)

| ستون (DB) | فیلد (Prisma) | نوع DB | نوع Prisma | اجباری | پیش‌فرض | توضیح |
|---|---|---|---|:-:|---|---|
| `id` | id | Uuid | String | ✓ | uuid() | PK |
| `contract_id` | contractId | Uuid | String | ✓ |  |  |
| `received_date` | receivedDate | Date | DateTime | ✓ |  |  |
| `quantity` | quantity | Decimal(18, 4) | Decimal | ✓ |  |  |
| `weight_kg` | weightKg | Decimal(18, 4) | Decimal? |  |  |  |
| `lot_id` | lotId | Uuid | String? |  |  |  |
| `inventory_document_id` | inventoryDocumentId | Uuid | String? |  |  |  |
| `notes` | notes | Text | String? |  |  |  |
| `created_at` | createdAt | Timestamptz(6) | DateTime | ✓ | now() |  |
| — | contract | — | رابطه ← MaterialContract | ✓ | | |
| — | lot | — | رابطه ← MaterialLot? |  | | |
| — | inventoryDocument | — | رابطه ← InventoryDocument? |  | | |

**ایندکس‌ها/یکتایی‌های سطح جدول:**

- `@@index([contractId])`
- `@@index([receivedDate])`
- `@@index([lotId])`

---

## آمار

- تعداد مدل‌ها: **39**
- تعداد فیلدها: **497**
- دیتابیس: PostgreSQL 15+ (توسعه: 17.11)
