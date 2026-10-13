# Dukan Pro Backend

NestJS + Prisma + PostgreSQL API for Dukan Pro — a PWA shop-management app for small business owners in Pakistan.

## Status

**Release 1 done; Release 1.2 (Online Store) done; Release 1.1 done.** The ERD v2 schema (**26 models, 14 enums**) is migrated and the database-level integrity guards are in place. Auth, platform-admin onboarding and 18 tenant-scoped feature modules (categories → products, suppliers, purchases, inventory, sales, payments, expenses, dashboard, cash, and the online `store/` + its public catalog at `public/stores/`) are implemented and verified with unit tests plus a live Postgres run. Every workflow in the spec (WF1–WF18) is complete: Release 1 (WF1–WF14), the Release 1.2 Online Store and Release 1.1 (WF15–WF18). The shared infrastructure (config service, trace-id, response DTOs, real JWT AuthGuard) is documented in [AGENTS.md](./AGENTS.md).

The frontend API contract is [`api/openapi.json`](./api/openapi.json) — import it into Postman or generate a typed client from it.

## Stack

- NestJS 12 (Express, ESM)
- Prisma 7 + PostgreSQL, via `@prisma/adapter-pg`
- TypeScript 6
- Joi 18 env validation
- nestjs-cls 7 for trace-id propagation
- Swagger at `/api`
- Node 24 (LTS) for dev and production

### Runtime requirements

Node **24.15.0 or newer** is required. The framework itself runs on Node 20.19+, but `@nestjs/schematics` (used by `nest generate` and `nest upgrade`) inherits a `^24.15.0` floor from the Angular devkit, so the CLI needs the newer release.

The NestJS 12 packages are ESM-only. The app uses ESM and explicit `.js` extensions on local imports so Node can resolve the compiled modules. Bun can be used to install packages, but not to run the server — `bcrypt` is a native module and Prisma officially supports Node.

Jest runs with `--experimental-vm-modules` (see the `test` scripts), which the ESM-only v12 packages require.

## Quickstart

```bash
npm install
cp .env.example .env.development
# edit .env.development → set DATABASE_URL to a real Postgres URL
npm run prisma:generate
npm run start:dev
```

Then:

```bash
curl http://localhost:4000/         # → { status: "ok", service: "dukan-pro-backend", ... }
curl http://localhost:4000/health   # → { status: "ok", ... }
open http://localhost:4000/api      # Swagger UI
```

Every response includes an `x-trace-id` header. To correlate logs across requests, send `x-trace-id: <your-id>` and the same id will be echoed back and prefixed in server logs.

## Scripts

| Script | Purpose |
|---|---|
| `npm run start:dev` | Watch-mode dev server |
| `npm run build` | Compile to `dist/` |
| `npm run start:prod` | Run compiled output |
| `npm run lint` | ESLint with `--fix` |
| `npm run format` | Prettier write |
| `npm run test` | Jest unit tests |
| `npm run test:e2e` | Jest e2e suite |
| `npm run prisma:generate` | Generate Prisma client into `src/generated/prisma` |
| `npm run prisma:migrate:dev` | Create + apply migration |
| `npm run prisma:migrate:deploy` | Apply migrations (production) |
| `npm run prisma:migrate:status` | Show migration status |
| `npm run prisma:studio` | Prisma Studio GUI |

## Testing

- `npm run test` — Jest **unit** suites (`src/**/*.spec.ts`), no database.
- `npm run test:e2e` — supertest suites in `test/e2e/`, booting the real
  `AppModule` in-process against a dedicated **`<db>_e2e`** database
  (e.g. `dukan_pro_e2e`). `globalSetup` creates that DB, runs
  `prisma migrate deploy`, truncates every table and seeds the platform admin,
  so it never touches dev data. Run one file with
  `npm run test:e2e -- test/e2e/store.e2e-spec.ts`.

## Folder structure

```
src/
├── main.ts                          # Bootstrap: Swagger, CORS, ValidationPipe, helmet
├── app.module.ts                    # ClsModule + Config + Prisma + JWT (global)
├── app.controller.ts                # GET / and GET /health
├── app.service.ts
├── app-configuration/               # ConfigService + Joi env validation
├── auth-guards/                     # AuthTokenGuard (JWT verify + typ check), AuthGuard (OWNER), PlatformAdminGuard
├── auth/                            # login, setup-password, me, change-password, platform-admin login
├── platform-admin/                  # WF1 shop onboarding + WF3 subscription renew/suspend
├── brands/                          # brand CRUD
├── categories/                      # category CRUD
├── products/                        # WF4 — QUANTITY vs SERIALIZED, stock_levels side effect
├── suppliers/                       # WF5 — isSystem Walk-in seller protected
├── customers/                       # customer CRUD — openingBalance (WF1 day-0), E.164 phones
├── expense-categories/              # WF13 dropdown — 8 defaults copied at onboarding
├── purchases/                       # WF6 — one transaction: counter, stock, IMEI, cash
├── supplier-payments/               # WF7 — derived payable, per-bill payment, overdraft prompt
├── inventory/                       # WF8 — stock adjustment, damaged & lost (manual movements)
├── constants/                       # Swagger response objects + human message sentences
├── errors/                          # HTTP error factories (ErrorResponseDTO)
├── helpers/                         # pagination, Prisma error, phone, token, logging
├── common/
│   ├── interceptors/trace-id.interceptor.ts
│   └── logger/trace-logger.service.ts
├── common-dto/
│   ├── decorator/ApiSuccessResponseDecorator.ts
│   └── response/                    # ApiSuccessResponseDTO, ErrorResponseDTO, PaginatedResponseDTO
├── generated/prisma/                # Generated client — gitignored, run prisma:generate
└── prisma/                          # Global PrismaModule + PrismaService
prisma/
├── schema.prisma                    # generator + datasource + the multi-file map (no models here)
├── enums.prisma                     # all 14 enums
├── models/                          # 26 models grouped by domain
│   ├── tenant.prisma                #   Shop, User, PlatformAdmin
│   ├── catalog.prisma               #   Category, Brand, Product, ProductImage
│   ├── purchasing.prisma            #   Supplier, Purchase, PurchaseItem, SupplierPayment
│   ├── inventory.prisma             #   InventoryUnit, StockLevel, InventoryMovement
│   ├── sales.prisma                 #   Customer, Sale, SaleItem, Payment
│   ├── expenses.prisma              #   ExpenseCategory, Expense
│   ├── cash.prisma                  #   CashMovement, CashReconciliation
│   ├── returns.prisma               #   SaleReturn, ReturnItem, Refund
│   └── online-store.prisma          #   ShopStoreSettings
├── constraints.sql                  # CHECK constraints, partial indexes, triggers (source of truth)
└── migrations/
    ├── 20261005091905_init/         # all tables
    └── 20261005095615_constraints/  # copy of constraints.sql
prisma.config.ts                     # Prisma CLI config: schema path, migrations, datasource URL
test/verify-constraints.sql           # asserts every guard still blocks bad data, then rolls back
```

## Prisma 7 notes

- The schema is **multi-file**: `prisma/schema.prisma` holds the `generator` + `datasource` blocks, `prisma/enums.prisma` holds the enums and `prisma/models/*.prisma` holds the models grouped by domain. `prisma.config.ts` points `schema` at the **directory** (`prisma`) — pointing it at a single file silently drops every model in the other files.
- The `prisma-client` generator writes plain TypeScript into `src/generated/prisma` instead of injecting into `node_modules`. That directory is gitignored; run `prisma:generate` after cloning.
- `moduleFormat = "cjs"` is kept for the generated client; the app compiles and runs as ESM.
- The connection URL lives in `prisma.config.ts`, not in the `datasource` block. It loads `.env.${NODE_ENV}` itself, which is why the npm scripts no longer wrap the CLI with `dotenv-cli`.
- `prisma.config.ts` is excluded from `tsconfig.build.json`; it is CLI config, not app source.

## Database constraints

The Prisma schema (`prisma/schema.prisma` + `prisma/enums.prisma` + `prisma/models/`) cannot express CHECK constraints, partial or expression indexes, triggers, or Row Level Security. Those live in **`prisma/constraints.sql`**, which is the source of truth.

The file is not executed by Prisma directly. The `20261005095615_constraints` migration holds a copy of it, so a fresh database gets the same guards as the dev one. To change it, edit `constraints.sql`, then re-copy into the migration and apply:

```bash
npx prisma migrate dev --create-only --name <change>
cp prisma/constraints.sql prisma/migrations/<new_migration>/migration.sql
npx prisma migrate dev
```

Two rules matter when adding migrations after this one:

- Prisma does not see these objects, so `migrate diff` will never tell you they drifted. Verify with `test/verify-constraints.sql` (see below) after touching them.
- Anything Prisma *can* express must stay in the `prisma/` schema files (schema.prisma / enums.prisma / models/). Duplicating it in `constraints.sql` will make `migrate dev` try to drop it.

What the guards enforce:

| Area | Guards |
|---|---|
| Money arithmetic | `total = quantity * unit_price` on sale and purchase items, `total_amount = subtotal - discount` on sales, `difference = counted_cash - system_cash` on reconciliations |
| Cancel integrity | Every `*_cancel_chk` requires `cancelled_at`, `cancel_reason` and `cancelled_by_id` when status is `CANCELLED`, and requires all three to be `NULL` when it is `ACTIVE` |
| Cash sign | `cash_movements_direction_chk` ties `direction` to `type`; `REVERSAL` and `RECONCILIATION_ADJUSTMENT` may go either way |
| Stock | `quantity_on_hand >= 0`, so accessory stock can never go negative |
| Serialized goods | `sale_items_serial_chk` forces `quantity = 1` for phone lines; the IMEI trigger rejects a repeat of either `imei1` or `imei2` anywhere in the same shop |
| Immutability | `cash_movements` and `inventory_movements` are append-only. 21 tables reject `DELETE` outright — cancel or deactivate instead |
| Idempotency | `payments_idempotency_uq` on `(shop_id, client_request_id, COALESCE(sale_id, zero-uuid))` stops double-saves while still allowing one Udhar payment split across sales |
| Tenancy | `users_one_owner_per_shop` allows a single `OWNER` per shop for the MVP |

To run the verification suite, which asserts each guard still blocks bad data and rolls back afterwards:

```bash
psql "$DATABASE_URL" -f test/verify-constraints.sql
```

Every `T`-numbered line must report `BLOCKED`. A line reading `NOT BLOCKED` means the guard is missing or has been dropped.

## Multi-tenancy contract

Every feature scopes queries by `shopId` taken from the authenticated user's JWT (`request.user.shopId`) — never from the request body or query string. The guards in `src/auth-guards/` attach `request.user = { userId, shopId, role }`. Because the global `ValidationPipe` runs with `forbidNonWhitelisted`, a client that sends `shopId` gets a hard **400** rather than having it silently stripped.

Two token types exist and are not interchangeable: `OWNER` (shop owner) and `PLATFORM_ADMIN` (HQ).

## The 26 models

The `prisma/` schema files are the authority for field-level detail; this table exists so the model list lives in the repo and does not drift from the ERD.

**Release 1 (20 models — 19 shop tables + the platform table):**

| Model | Table | Model | Table |
|---|---|---|---|
| `Shop` | shops | `InventoryMovement` | inventory_movements |
| `User` | users | `Customer` | customers |
| `PlatformAdmin` | platform_admins *(outside the tenant)* | `Sale` | sales |
| `Category` | categories | `SaleItem` | sale_items |
| `Brand` | brands | `Payment` | payments |
| `Product` | products | `ExpenseCategory` | expense_categories |
| `Supplier` | suppliers | `Expense` | expenses |
| `Purchase` | purchases | `CashMovement` | cash_movements |
| `PurchaseItem` | purchase_items | `SupplierPayment` | supplier_payments |
| `InventoryUnit` | inventory_units | `StockLevel` | stock_levels |

**Release 1.1 (4 models — tables exist now, endpoints later):** `SaleReturn` → returns, `ReturnItem` → return_items, `Refund` → refunds, `CashReconciliation` → cash_reconciliations.

**Release 1.2 (2 models — built, migrated, endpointed):** `ShopStoreSettings` → shop_store_settings, `ProductImage` → product_images (plus Product publish fields, `PtaStatus`, the `published_at` trigger and `products_public_catalog_idx`).

**14 enums:** `ShopStatus`, `UserRole`, `UserStatus`, `TrackingType`, `UnitCondition`, `UnitStatus`, `RecordStatus`, `PaymentMethod`, `CashDirection`, `CashMovementType`, `InventoryMovementType`, `ReferenceType`, `ReturnCondition`, `PtaStatus`.

## What's built, what's next

Built and verified (unit tests + a live Postgres run): auth, platform-admin onboarding and subscription control, categories, brands, products (WF4), suppliers (WF5), customers, expense categories, purchases (WF6), supplier payments (WF7), inventory adjustments — stock adjustment / damaged / lost (WF8), sales (WF9), payments (WF10), ledgers (WF11), cancel flows (WF12), expenses (WF13), dashboard (WF14), opening cash (WF1), returns & refunds (WF15), owner investment/withdrawal (WF16), cash count / reconciliation (WF17), detailed reports + CSV export (WF18) and the Release 1.2 Online Store (`store/` settings + preview, publish/unpublish, product images, the throttled `public/stores/` catalog). See [AGENTS.md](./AGENTS.md) for the per-module rules.

**All workflows (WF1–WF18) are complete.** Every ticket in the Release 1, Release 1.2 and Release 1.1 plans is built. A future PDF export for the WF18 reports is deliberately unwired — `format=csv` works today and the plumbing is shared.

There is deliberately **no** `/auth/signup`, `/auth/forgot-password` or `/auth/reset-password` — onboarding starts with a platform admin, and password reset reuses the setup-link flow. There is no email service: the admin forwards the setup URL over WhatsApp.
