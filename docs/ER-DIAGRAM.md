# KPIMS — نمودار روابط موجودیت‌ها (ER Diagram)

> نمودارها با Mermaid نوشته شده‌اند (در GitHub/GitLab و اکثر ابزارهای Markdown رندر می‌شوند).
> منبع حقیقت: `backend/prisma/schema.prisma` — جزئیات ستون‌ها در
> [`DATA-DICTIONARY.md`](./DATA-DICTIONARY.md) آمده است.

## ۱) نمای کلی دامنه‌ها (Domain Map)

```mermaid
flowchart LR
  subgraph CTRL[کنترلی]
    U[Users / Roles / Permissions]
    A[AuditLogs]
    DS[DocumentSequences]
    S[SystemSettings]
  end

  subgraph MD[اطلاعات پایه]
    P[Parts]
    M[Materials]
    BOM[PartMaterialRequirements]
    O[Operations]
    R[PartRoutes + Steps]
    MC[Machines / Dies]
    W[Warehouses / Locations]
    SH[Shifts]
    C[Customers]
  end

  subgraph PRD[تولید]
    CO[CustomerOrders]
    PP[ProductionPlans نسخه‌بندی‌شده]
    PLO[PlanLineOperations + نامزدهای ماشین]
    PMS[PlanLineMaterialShortages]
    MO[ManufacturingOrders]
    OP[ProductionOperations]
    REP[ProductionReports]
    TRF[ProductionTransfers]
  end

  subgraph INV[انبار]
    ID[InventoryDocuments]
    TX[InventoryTransactions]
    SB[StockBalances]
    RS[Reservations]
    LOT[MaterialLots]
    CT[MaterialContracts]
  end

  U --> A
  C --> CO
  CO --> PP --> MO --> OP --> REP
  R --> MO
  MC --> OP
  P --> R
  P --> MO
  M --> LOT --> CT
  MO --> ID
  REP --> ID
  ID --> TX --> SB
  LOT --> TX
  MO --> RS
  P --> BOM --> M
  PP --> PLO
  PP --> PMS
  PLO --> MC
  PMS --> M
```

## ۲) دامنه کنترلی (Control Data)

```mermaid
erDiagram
    USER ||--o{ ROLE : "دارد"
    USER {
        uuid id PK
        varchar username UK
        varchar full_name
        varchar password_hash
        boolean is_active
        uuid role_id FK
        timestamptz last_login_at
    }
    ROLE ||--o{ ROLE_PERMISSION : "دارد"
    ROLE {
        uuid id PK
        varchar name UK
        varchar name_fa
        boolean is_active
    }
    PERMISSION ||--o{ ROLE_PERMISSION : "دارد"
    PERMISSION {
        uuid id PK
        varchar code UK
        varchar module
        varchar action
    }
    ROLE_PERMISSION {
        uuid role_id PK,FK
        uuid permission_id PK,FK
    }
    USER ||--o{ AUDIT_LOG : "ثبت می‌کند"
    AUDIT_LOG {
        uuid id PK
        uuid user_id FK
        varchar action
        varchar entity_type
        varchar entity_id
        json changes
        timestamptz occurred_at
    }
    DOCUMENT_SEQUENCE {
        uuid id PK
        varchar key UK
        varchar prefix
        int next_number
        enum reset_policy
    }
    SYSTEM_SETTING {
        uuid id PK
        varchar key UK
        text value
        enum value_type
    }
```

## ۳) اطلاعات پایه (Master Data)

```mermaid
erDiagram
    PART ||--o{ PART_ROUTE : "نسخه‌بندی مسیر"
    PART {
        uuid id PK
        varchar part_number UK
        varchar name_fa
        enum part_type
        enum status
        uuid base_unit_id FK
        decimal standard_weight_kg
        uuid main_material_id FK
        uuid primary_customer_id FK
    }
    PART_ROUTE ||--o{ PART_ROUTE_STEP : "مراحل"
    PART_ROUTE {
        uuid id PK
        uuid part_id FK
        int version
        enum status
        uuid superseded_by_id FK
    }
    PART_ROUTE_STEP }o--|| OPERATION : "عملیات"
    PART_ROUTE_STEP }o--o| MACHINE : "ماشین ترجیحی"
    PART_ROUTE_STEP }o--o| DIE : "قالب"
    PART_ROUTE_STEP {
        uuid id PK
        uuid route_id FK
        int sequence
        uuid operation_id FK
        int setup_time_min
        decimal cycle_time_sec
        decimal scrap_factor_pct
    }
    OPERATION ||--o{ MACHINE_CAPABILITY : ""
    MACHINE ||--o{ MACHINE_CAPABILITY : "توانمندی"
    MACHINE ||--o{ MACHINE_DIE_COMPATIBILITY : ""
    DIE ||--o{ MACHINE_DIE_COMPATIBILITY : "سازگاری قالب-ماشین"
    MACHINE {
        uuid id PK
        varchar code UK
        enum machine_type
        decimal tonnage
        enum status
    }
    DIE {
        uuid id PK
        varchar code UK
        varchar name_fa
        enum status
    }
    MATERIAL ||--o{ MATERIAL_LOT : "لوت‌ها"
    MATERIAL {
        uuid id PK
        varchar material_code UK
        enum material_type
        varchar grade
        decimal thickness_mm
        decimal width_mm
        decimal unit_weight_kg
        uuid base_unit_id FK
        varchar supplier_name "پیش‌فرض SAPCO"
    }
    UNIT_OF_MEASURE ||--o{ PART : "واحد پایه"
    UNIT_OF_MEASURE ||--o{ MATERIAL : "واحد پایه"
    CUSTOMER ||--o{ PART : "مشتری اصلی"
    CUSTOMER ||--o{ CUSTOMER_ORDER : "سفارش‌ها"
    WAREHOUSE ||--o{ WAREHOUSE_LOCATION : "موقعیت‌ها"
    WAREHOUSE {
        uuid id PK
        varchar code UK
        enum warehouse_type
    }
    WAREHOUSE_LOCATION {
        uuid id PK
        uuid warehouse_id FK
        varchar code
    }
    SHIFT {
        uuid id PK
        varchar code UK
        varchar start_time
        varchar end_time
    }
```

## ۴) تولید (Production Data)

```mermaid
erDiagram
    CUSTOMER ||--o{ CUSTOMER_ORDER : "ثبت می‌کند"
    CUSTOMER_ORDER ||--o{ CUSTOMER_ORDER_LINE : "ردیف‌ها"
    CUSTOMER_ORDER_LINE }o--|| PART : "قطعه"
    CUSTOMER_ORDER_LINE ||--o{ PRODUCTION_PLAN_LINE : "پوشش برنامه"
    PRODUCTION_PLAN ||--o{ PRODUCTION_PLAN_LINE : "ردیف‌ها"
    PRODUCTION_PLAN }o--o| PRODUCTION_PLAN : "بازنگری نسخه قبل"
    PRODUCTION_PLAN_LINE ||--o{ PLAN_LINE_OPERATION : "تحلیل عملیات‌ها"
    PRODUCTION_PLAN_LINE ||--o{ PLAN_LINE_MATERIAL_SHORTAGE : "کسری مواد"
    PLAN_LINE_OPERATION }o--|| OPERATION : "نوع عملیات"
    PLAN_LINE_OPERATION }o--o| MACHINE : "ماشین پیشنهادی"
    PLAN_LINE_OPERATION }o--o| DIE : "قالب پیشنهادی"
    PLAN_LINE_MATERIAL_SHORTAGE }o--|| MATERIAL : "ماده"
    PART ||--o{ PART_MATERIAL_REQUIREMENT : "سرانه مصرف (BOM)"
    PART_MATERIAL_REQUIREMENT }o--|| MATERIAL : "ماده"
    PRODUCTION_PLAN }o--|| USER : "ایجادکننده"
    PRODUCTION_PLAN_LINE }o--o| MANUFACTURING_ORDER : "تبدیل به دستور کار"
    MANUFACTURING_ORDER }o--|| PART : "قطعه"
    MANUFACTURING_ORDER }o--o| PART_ROUTE : "نسخه مسیر"
    MANUFACTURING_ORDER ||--o{ PRODUCTION_OPERATION : "عملیات‌ها"
    PRODUCTION_OPERATION }o--|| OPERATION : "نوع عملیات"
    PRODUCTION_OPERATION }o--o| MACHINE : "ماشین"
    PRODUCTION_OPERATION ||--o{ PRODUCTION_REPORT : "گزارش‌ها"
    PRODUCTION_OPERATION ||--o{ PRODUCTION_SCRAP : "ضایعات"
    PRODUCTION_OPERATION ||--o{ MACHINE_ASSIGNMENT : "تخصیص ماشین"
    PRODUCTION_REPORT ||--o{ PRODUCTION_SCRAP : ""
    PRODUCTION_REPORT }o--o| SHIFT : "شیفت"
    PRODUCTION_REPORT }o--o| USER : "اپراتور"
    PRODUCTION_TRANSFER }o--o| PRODUCTION_OPERATION : "از/به عملیات"
    PRODUCTION_TRANSFER }o--o| WAREHOUSE : "از/به انبار"

    CUSTOMER_ORDER {
        uuid id PK
        varchar order_number UK
        uuid customer_id FK
        date order_date
        enum status
    }
    PRODUCTION_PLAN {
        uuid id PK
        varchar plan_number UK
        date period_start
        date period_end
        enum status
    }
    MANUFACTURING_ORDER {
        uuid id PK
        varchar mo_number UK
        uuid part_id FK
        decimal quantity
        enum priority
        enum status
    }
    PRODUCTION_OPERATION {
        uuid id PK
        uuid manufacturing_order_id FK
        int sequence
        enum status
        decimal produced_quantity
        decimal scrapped_quantity
    }
    PRODUCTION_REPORT {
        uuid id PK
        varchar report_number UK
        date report_date
        decimal produced_quantity
        enum status
        enum posting_status
    }
    PRODUCTION_SCRAP {
        uuid id PK
        enum reason
        decimal quantity
        decimal weight_kg
        date scrap_date
    }
    PRODUCTION_TRANSFER {
        uuid id PK
        varchar transfer_number UK
        decimal quantity
        enum status
        enum posting_status
    }
    MACHINE_ASSIGNMENT {
        uuid id PK
        uuid operation_id FK
        uuid machine_id FK
        uuid die_id FK
        timestamptz planned_start
    }
```

## ۵) انبار (Inventory Data)

```mermaid
erDiagram
    INVENTORY_DOCUMENT ||--o{ INVENTORY_DOCUMENT_LINE : "ردیف‌ها"
    INVENTORY_DOCUMENT ||--o{ INVENTORY_TRANSACTION : "قطع‌بوش"
    INVENTORY_DOCUMENT }o--o| INVENTORY_DOCUMENT : "ابطال سند قبلی"
    INVENTORY_DOCUMENT {
        uuid id PK
        varchar document_number UK
        enum document_type
        enum status "گردش کار"
        enum posting_status "قطع‌بوش"
        date document_date
        uuid warehouse_id FK
        varchar reference_type
        uuid reference_id "بدون FK - چندریختی"
        uuid reversal_of_id FK
    }
    INVENTORY_DOCUMENT_LINE }o--o| PART : "قطعه"
    INVENTORY_DOCUMENT_LINE }o--o| MATERIAL : "ماده"
    INVENTORY_DOCUMENT_LINE }o--o| MATERIAL_LOT : "لوت"
    INVENTORY_DOCUMENT_LINE }o--|| UNIT_OF_MEASURE : "واحد"
    INVENTORY_TRANSACTION }o--o| PART : "قطعه"
    INVENTORY_TRANSACTION }o--o| MATERIAL : "ماده"
    INVENTORY_TRANSACTION }o--|| WAREHOUSE : "انبار"
    INVENTORY_TRANSACTION }o--o| MATERIAL_LOT : "لوت"
    INVENTORY_TRANSACTION }o--o| INVENTORY_TRANSACTION : "ابطال"
    INVENTORY_TRANSACTION {
        uuid id PK
        varchar transaction_number UK
        enum type
        decimal quantity "Immutable"
        decimal weight_kg
        timestamptz occurred_at
        uuid reversal_of_id FK
    }
    STOCK_BALANCE }o--o| PART : "قطعه"
    STOCK_BALANCE }o--o| MATERIAL : "ماده"
    STOCK_BALANCE }o--|| WAREHOUSE : "انبار"
    STOCK_BALANCE }o--o| MATERIAL_LOT : "لوت"
    STOCK_BALANCE {
        uuid id PK
        decimal quantity ">= 0"
        decimal weight_kg
        timestamptz last_transaction_at
    }
    INVENTORY_RESERVATION }o--o| MANUFACTURING_ORDER : "برای MO"
    INVENTORY_RESERVATION }o--o| CUSTOMER_ORDER_LINE : "برای سفارش"
    MATERIAL_CONTRACT ||--o{ MATERIAL_CONTRACT_TRANSACTION : "دریافت‌ها"
    MATERIAL_CONTRACT }o--|| MATERIAL : "ماده"
    MATERIAL_CONTRACT_TRANSACTION }o--o| MATERIAL_LOT : "لوت ایجادشده"
    MATERIAL_CONTRACT_TRANSACTION }o--o| INVENTORY_DOCUMENT : "سند رسید"
    MATERIAL_LOT {
        uuid id PK
        uuid material_id FK
        varchar lot_number
        decimal quantity_received
        decimal quantity_remaining
        decimal weight_remaining_kg
        enum status
    }
    MATERIAL_CONTRACT {
        uuid id PK
        varchar contract_number UK
        varchar supplier_name "SAPCO"
        decimal total_quantity
        enum status
    }
```

## قیدهای یکپارچگی مهم (سطح دیتابیس)

| قید | محدوده | معنی |
|---|---|---|
| `chk_inv_tx_item` / `chk_stock_balance_item` / ... | تراکنش، ردیف سند، موجودی، رزرو | دقیقاً یکی از قطعه یا ماده اولیه (XOR) |
| `chk_inv_tx_qty_positive` | تراکنش انبار | تعداد همیشه مثبت (جهت در `type` است) |
| `chk_stock_balance_qty_non_negative` | موجودی رسمی | موجودی منفی ممنوع |
| `chk_inv_tx_reversal_self` / `chk_inv_doc_reversal_self` | دفتر کل | سند ابطال نمی‌تواند خودش باشد |
| `stock_balances_..._key` با `NULLS NOT DISTINCT` | موجودی | یکتایی ابعاد (قطعه/ماده، انبار، موقعیت، لوت) حتی با NULL |
| `ON DELETE RESTRICT` روی FKهای دفتر کل | انبار و تولید | اسناد قطع‌بوش‌شده حذف‌پذیر نیستند |

## ۹) الحاقات فازهای دو و سه (Inventory & Production)

فیلدهای افزوده‌شده به مدل‌های فاز یک (migrationهای `phase2_inventory_production_fields`،
`doc_line_lot_ownership_quality`، `stock_balance_unit` و `balance_unique_fix_reservation_check`):

### انبار
- `stock_ownership` (`OWNED` / `SUPPLIER_CONSIGNMENT`) و `quality_status`
  (`PENDING` / `APPROVED` / `BLOCKED`) روی **تراکنش، سطر موجودی و لوت** —
  جداسازی ورق امانی SAPCO و قرنطینه کیفیت به‌عنوان بخشی از هویت موجودی.
- `stock_balances.balance_key` — کلید یکتای قطعی برای upsert اتمی
  (به‌جای UNIQUE ترکیبی با NULL) + `unit_id` (موجودی به‌تفکیک واحد: عدد/کیلوگرم).
- `inventory_documents.reason_code / reason_text` — علت الزامی اصلاحیه (قاعده ۹).
- `inventory_document_lines.lot_number / ownership / quality_status / contract_id / reservation_id`.
- `adjustment_reason` enum: افتتاحیه، اصلاح شمارش، آسیب، کسری، اضافه، آزادسازی کیفیت، سایر.

### تولید و WIP
- `production_operations`: `received_quantity` (دریافتی از عملیات قبل)،
  `input_quantity` (خوراک ماشین، شامل تغذیه مجدد بازکار)، `rejected_quantity` (مردود)،
  `rework_quantity` (بازکار)، `transferred_out_quantity` (منتقل‌شده)،
  `wip_location_id` (موقعیت فیزیکی WIP) و `wip_since_at` (مبنای قداره).
- `production_reports`: `input_quantity` و `rejected_quantity` — با تساوی اجباری
  `input = produced + rejected + rework + scrap` در لایه سرویس.

### جریان‌های کلیدی
```mermaid
flowchart TD
  RC[رسید ماده با لوت + قرارداد] -->|POST| TX[(InventoryTransactions)]
  RC --> SB[(StockBalance: lot/ownership/quality/unit)]
  IS[حواله با lotId + رزرو] -->|POST| TX
  IS --> CONSUME[مصرف رزرو]
  TR[انتقال بین موقعیت/انبار] -->|POST| TX
  RV[سند ابطالی] -->|mirror| TX
  MO[دستور کار] --> OP[عملیات از مسیر ACTIVE]
  REP[گزارش تولید] -->|تأیید| OP
  TRF[انتقال بین عملیاتی] -->|POST| OP
  TRF -->|به انبار محصول| PRC[سند PRODUCTION_RECEIPT قطع‌بوش‌شده]
```

## ۱۰) الحاقات فاز چهار (برنامه‌ریزی تولید)

migration `phase4_planning` — همه تغییرات افزودنی هستند (بدون دستکاری داده‌های عملیاتی):

- **`operations.requires_die`** — عملیات‌های نیازمند قالب (BLK، FRM) برای کنترل سازگاری قالب–ماشین.
- **`part_route_steps.required_tonnage`** — حداقل تناژ پرس هر مرحله (شرط سخت صلاحیت ماشین؛
  اگر ثبت نشده باشد، برنامه‌ریز «کنترل تناژ انجام نشد» را صریحاً گزارش می‌کند — بدون فرض پنهان).
- **`part_material_requirements`** — BOM تک‌سطحی (سرانه مصرف ماده بر حسب واحد پایه ماده به ازای یک قطعه)
  ورودی محاسبه کسری مواد.
- **`production_plans`** — `version`، `revision_of_id` (زنجیره نسخه‌ها)، `planning_run_at`،
  `planning_params` (افق/بازه سررسید/شیفت‌های استفاده‌شده) و `summary` (خلاصه اسنپ‌شات اجرا)؛
  وضعیت جدید `SUPERSEDED` برای نسخه‌های جاگزیده‌شده.
- **`production_plan_lines`** — خروجی قطع‌بوش هر ردیف: `gross_quantity`، `covered_by_stock`،
  `covered_by_reservations`، `covered_by_wip`، `covered_by_planned_mos`، `planned_quantity`
  (پیشنهاد MO)، `route_id/version`، `due_date`، `feasible` و `detail` (JSON اسنپ‌شات کامل:
  ردیف‌های تقاضا، زنجیره WIP، هشدارها، اطلاعات ناقص).
- **`plan_line_operations`** — زنجیره کمیت عملیات‌به‌عملیات (`required_output/wip_used/
  committed_used/arriving_used/must_produce/required_input`) + منبع زمان (`time_source`,
  `setup_source`)، صلاحیت (`feasible`, `infeasible_reasons`, `missing_info`) و پیشنهاد ماشین
  (`recommended_machine_id/code`, `recommended_rank`, `candidates` JSON با دلایل رتبه‌بندی).
- **`plan_line_material_shortages`** — کسری هر ماده با شدت (`OK` / `SHORTAGE_COVERED_BY_CONTRACT`
  / `SHORTAGE` / `MISSING_BOM`)، سهم امانی SAPCO و پوشش قراردادهای باز.

### جریان برنامه‌ریزی (فاز ۴)
```mermaid
flowchart TD
  CO2[سفارش باز مشتری] --> GD[تقاضای ناخالص به تفکیک قطعه]
  SB2[(موجودی محصول تأیید/مالی)] --> NET
  RS2[(رزروهای فعال)] --> NET
  NET[قطع‌بوش ردیف‌به‌ردیف FIFO سررسید]
  NET --> WIPN[پس‌گرد WIP عملیات‌به‌عملیات
+ تعهد دستور کارهای باز]
  WIPN --> MQ[پیشنهاد MO = تولید جدید عملیات آخر]
  WIPN --> MAT[نیاز ماده از BOM × ورودی عملیات اول]
  MQ --> ELG[صلاحیت ماشین: توانمندی/وضعیت/تناژ/سازگاری قالب/ظرفیت شیفت]
  ELG --> RANK[رتبه‌بندی: earliest completion ← setup ← بار کاری]
  RANK --> PLAN[(برنامه DRAFT نسخه n+1 — فقط پیشنهاد)]
  MAT --> PLAN
  PLAN -->|تأیید کاربر| CONF[برنامه CONFIRMED]
  CONF -->|اقدام جداگانه در ماژول تولید| MO2[دستور کار با ارجاع planLineId]
```
