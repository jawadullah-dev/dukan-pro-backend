# DUKAAN PRO BACKEND — AGENTS.md (single source of truth)

> This is the **only** project guide. It merges the former `CLAUDE.md`,
> `AI_CODING_RULES.md` and `HANDOFF.md` into one file so knowledge lives in the
> repo instead of on one machine. `README.md` covers *running* the project;
> this file covers *building* it.
>
> **Sections 1–7 are the "read every session" tier. Everything below is
> reference — open it when you need it.**

---

# PART A — READ EVERY SESSION

## 1. Quick Facts

| Field | Value |
|---|---|
| **Project** | Dukaan Pro backend — SaaS multi-tenant PWA shop-management tool for small shop owners in Pakistan |
| **Stack** | NestJS 12 + Prisma 7 + PostgreSQL + JWT + Swagger + Jest |
| **Current state** | Infrastructure ✓ Schema ✓ Constraints ✓ Auth ✓ Platform-admin ✓ **20 modules built**: categories, brands, products, suppliers, customers, expense-categories, expenses, purchases, supplier-payments, inventory, sales, payments, dashboard, cash, store, **returns**, **cash-reconciliations**, **reports** — including cancel flows (WF12), ledgers (WF11), the WF14 dashboard, WF1 opening cash, WF16 owner investment/withdrawal, **WF17 cash count/reconciliation**, the **Release 1.2 Online Store** (`store/` settings + preview, publish/unpublish, product images, `public/stores/` catalog with rate limiting & 60s cache, admin-only slug rename), **WF15 returns & refunds** and **WF18 reports + CSV export**. **Release 1 endpoints (WF1–WF14), Release 1.1 (WF15–WF18) and Release 1.2 Online Store (WF19–WF22) complete — all 22 workflows in the spec are built** (see §11 and the Requirements-alignment gaps in the Online Store section). |
| **Node** | >= 24.15.0 (see `package.json`) |
| **Prisma client** | Generated into `src/generated/prisma/` (gitignored — run `npm run prisma:generate` after clone) |
| **Money unit** | BIGINT in **paisa** (Rs 1 = 100 paisa). Rs 100.00 = `10000`. Never store rupees as floats. |
| **IDs** | UUID v7 on every row. Every tenant table has a `shopId` FK. |
| **Schema size** | **26 models + 14 enums** (25 shop tables + `platform_admins`) |
| **Deletes** | Forbidden by DB triggers on 21 tables → cancel (with reason) or deactivate instead |
| **Multi-tenancy** | `request.user.shopId` from JWT — every query must filter by it. Never take `shopId` from the request. |
| **API** | Swagger at `/api`, spec at `/api-json` → regenerate `api/openapi.json` from it |

---

## 2. Non-negotiable rules

Every endpoint MUST follow these. No exceptions.

**Rule 1 — One action = one DB transaction.**
```ts
await prisma.$transaction(async tx => {
  // 1. validate against current state
  // 2. update/insert every table that must change atomically
  // 3. failure anywhere → automatic rollback
});
```
A sale changes: shops.counter → sales → sale_items → inventory_units/stock_levels →
inventory_movements → payments → cash_movements. All or nothing.

**Rule 2 — Every query filtered by `shop_id`, taken from the JWT.**
```ts
// GOOD
await prisma.product.findMany({ where: { shopId: req.user.shopId } });
// NEVER
await prisma.product.findMany({ where: { shopId: dto.shopId } });
```
Multi-tenancy is the whole reason `shop_id` exists. Breaking this = one shop
owner sees another shop's data. The global `ValidationPipe` uses
`forbidNonWhitelisted`, so sending `shopId` in the body is a hard **400**, not a
silent strip.

**Rule 3 — History is added, never edited or deleted.**
- Master data (products, suppliers, customers, categories): set `isActive = false`, never `DELETE`.
- Money records (sales, purchases, payments, expenses): set `status = CANCELLED` with reason + time + who, plus a **reversal row**.
- Append-only ledgers (`cash_movements`, `inventory_movements`): DB triggers already block UPDATE/DELETE.

**Rule 4 — Server calculates totals, never trusts the client.**
```
purchase_items.total_cost   = quantity * unit_cost        (DB CHECK)
purchases.total_amount      = Σ purchase_items.total_cost (APP computes)
sales.subtotal              = Σ sale_items.total          (APP computes)
sales.total_amount          = subtotal - discount         (DB CHECK)
payments / expenses / etc.  > 0                           (DB CHECK)
```
If the frontend sends `totalAmount: 12345`, ignore it and recompute.

**Rule 5 — Automatic numbers are read+incremented inside the transaction.**
```sql
UPDATE shops SET next_sale_no = next_sale_no + 1
WHERE id = $shopId
RETURNING next_sale_no - 1;   -- S-0001, S-0002, …
```
SELECT-then-UPDATE lets two concurrent requests steal the same number. Same
pattern for `next_purchase_no`.

**Rule 6 — `clientRequestId` gives idempotency (double-tap safe).**
UNIQUE `(shop_id, client_request_id)` on sales and purchases. On a P2002,
**return the already-saved record** — do not throw.

**Rule 7 — Cash going below zero is a SOFT warning, not a hard block.**
Return a confirm prompt → frontend retries with `confirmOverdraft: true` →
save the row with `isOverdraft: true`. Owners often forget opening cash.
Only hard-block: stock going negative (DB-enforced), selling a phone that is
not `IN_STOCK`, payment > outstanding, cancelling a purchase whose phones sold.

**Rule 8 — Cancel = `CANCELLED` + reason/time/user + reversal row.**
No delete, no edit. Role guard: only `OWNER` may cancel. Reason is required
and non-empty.

**Rule 9 — `trackingType` is locked once a product has transactions.**
Cannot change `SERIALIZED ↔ QUANTITY` after any `purchase_items` or
`sale_items` row references it. Serialized lines are forced to `quantity = 1`
by a DB CHECK.

**Rule 10 — Append-only ledgers are written, never updated.**
`inventory_movements` and `cash_movements` get INSERTs only.

---

## 3. Current status — what exists today

| Area | State |
|---|---|
| Infrastructure, Prisma, guards, interceptors, response DTOs | ✅ |
| Auth (WF1/WF2) — owner login, platform-admin login, setup-password, me, change-password | ✅ |
| Platform admin (WF1 onboarding + WF3 subscription) | ✅ |
| Categories, Brands CRUD | ✅ |
| Products (WF4) — QUANTITY vs SERIALIZED | ✅ |
| Suppliers (WF5) — `isSystem` Walk-in seller protected | ✅ |
| Customers — CRUD + WF1 day-0 `openingBalance` | ✅ |
| Expense categories (WF13 dropdown) | ✅ |
| **Purchases (WF6)** — one transaction, IMEI + stock + overdraft | ✅ |
| **Supplier payments (WF7)** — derived payable, per-bill payment, overdraft | ✅ |
| **Inventory (WF8)** — stock adjustment, damaged & lost | ✅ |
| **Sales (WF9)** — create / list / get | ✅ |
| **Payments (WF10)** — customer pays Udhar, oldest-first allocation | ✅ |
| **Expenses (WF13)** — add & cancel, cash OUT + REVERSAL | ✅ |
| **Cancel flows (WF12)** — sale / purchase / payment / supplier payment + cash REVERSAL | ✅ |
| **Ledger (WF11)** — customer Udhar + supplier payable timelines | ✅ |
| **Dashboard (WF14)** — 7 derived numbers + drill links | ✅ |
| **Opening cash (WF1)** — `POST /cash/opening`, once per shop + `GET /cash/movements` | ✅ |
| **Online Store DB layer (R1.2, WF19–WF22)** — `shop_store_settings`, `product_images`, `PtaStatus`, `isPublished`/`publishedAt`/`publicDescription`/`contactForPrice`/`ptaStatus` fields, publish trigger + `products_public_catalog_idx` + slug/URL/WhatsApp CHECKs + backfill | ✅ |
| **Online Store endpoints (R1.2, WF19–WF22)** — `store/` module: settings upsert + owner preview, publish/unpublish (single + bulk), product images, `public/stores/` catalog (4 routes, throttled, cached), admin-only slug rename (see WF22 API note) | ✅ |
| **Returns & refunds (WF15)** — create / preview / list / get | ✅ |
| **Owner investment / withdrawal (WF16)** — `POST /cash/investments` + `POST /cash/withdrawals`, never counted as revenue/expense, soft overdraft on withdrawal | ✅ |
| **Cash count / reconciliation (WF17)** — `POST /cash-reconciliations` + `GET /cash-reconciliations` + `GET /cash-reconciliations/:id`, `RECONCILIATION_ADJUSTMENT` rows (IN/OUT), reason required when difference ≠ 0 | ✅ |
| Reports (WF18) | ✅ next |

**Deliberate omissions — do not add these without asking:**
- ❌ No `EmailService` / SMTP. The admin receives `setupUrl` in the HTTP response and forwards it over WhatsApp.
- ❌ No refresh tokens. Single 24h JWT, no `auth_sessions` table.
- ❌ No forgot/reset password. Reuse `POST /platform-admin/users/:userId/password-setup-link`.
- ❌ No global `HttpExceptionFilter` yet.

---

## 4. Response contract (verified live — do not guess)

```ts
// Read / list
ApiSuccessResponseDTO<T> = { message: string; data: T }
// Paginated list → data is:
PaginatedResponseDTO<T> = { page; pageSize; total; items: T[] }

// Create / update / delete
StatusBaseResponseDTO = { status: true; message: string }   // inside `data`

// Any error (400/401/403/404/500)
ErrorResponseDTO = { error: string; message: string[]; statusCode: number }
// trace id lives in the `x-trace-id` RESPONSE HEADER, not the body
```

Notes:
- `data.items` is **never** a bare array — iterate `data.items`.
- Mutations do **not** return the saved row. A follow-up GET is needed.
- `error` is a short headline; `message` is an **array** of sentences. They are the opposite of what you'd guess — parse once, use `error` for a toast title.
- `message` also appears at the top level of successes; read the top-level one.

**Status codes you will hit:**

| Code | Meaning |
|---|---|
| `201` | POST created |
| `200` | GET / PATCH / DELETE success |
| `400` | Validation failed, a business rule refused it, **or a duplicate** (there is **no 409**) |
| `401` | Missing / expired / wrong token type → offer re-login |
| `403` | Token fine, but shop suspended or subscription ended → show "contact support", **do not** offer re-login |
| `404` | Not found *for your shop* |
| `500` | Backend bug — log `x-trace-id` |

**Money and dates:** all amounts are integers in **paisa** (divide by 100 to
display). Timestamps are ISO-8601 with timezone. Business dates
(`purchaseDate`, `expenseDate`, `dueDate`) arrive as `"YYYY-MM-DD"` strings — do
not run them through `new Date()` and reformat, you will shift the day.

---

## 5. Gotchas worth memorising

**Works today:**
1. **401 vs 403** are different screens. Do not collapse them.
2. **Never send `shopId`** — hard 400, not a silent strip.
3. **`201` for POST, `200` for GET/PATCH/DELETE.** No `409` — duplicates are `400`.
4. **Mutations return `{ status, message }`, not the row.**
5. **`error` is the headline, `message` is an array.**
6. **`x-trace-id` is a response header**, not a body field. Log it on any error.
7. **Token expires in 24h**, no refresh. Handle 401 with a re-login prompt.
8. **Two token types, not interchangeable** (`OWNER` vs `PLATFORM_ADMIN`).
9. **`@IsOptional()` lets `null` past validation.** Handle `null` in the service
   explicitly — otherwise `dto.name.trim()` throws a `TypeError` and the client
   gets a 500. This bit us once already.
10. **Prisma 7 + driver adapters do not set `meta.target` on P2002.** Use
    `violatedColumn(error, 'sku')` from `src/helpers/prisma-error-helper.ts`.
    Reading `meta.target` silently falls through to the wrong message.

**Planned, not built yet:**
11. **`clientRequestId` must be stable per form**, not per click.
12. **No DELETE on money records** — `POST /cancel` with a reason.
13. **Cancelled rows stay in the list.** Design for them.

---

## 6. DONE — Cancel with reason (WF12)

`POST /sales/{id}/cancel`, `POST /purchases/{id}/cancel`,
`POST /payments/{id}/cancel`, `POST /supplier-payments/{id}/cancel` — all
OWNER-only (the existing `AuthGuard`), `{ cancelReason }` required (1–1000
after trim, DTO field is `cancelReason` matching the Prisma column, same as
expenses). Returns the default **201** `StatusBaseResponseDTO`; where cash can
go negative the controller answers **200** with `PurchaseOverdraftResponseDto`
via the `@Res({ passthrough: true })` status trick and writes nothing until
retried with `confirmOverdraft: true`.

Shared shape of all four services:
1. Pre-tx 404 (`{ id, shopId }` read — the read *is* the tenant check) and 400
   `cancelledRowMutationForbidden` when already CANCELLED.
2. One `$transaction`: lock the **shop row** `FOR UPDATE` (same order as every
   other writer), then the record row `FOR UPDATE`, re-check ACTIVE inside the
   lock — a racing double-cancel loses here, not at the UPDATE.
3. Inverse cash rows are one per original movement, `type REVERSAL`, opposite
   direction, `reversesMovementId` pointing at the original (unique per row).
4. Cancel = `CANCELLED` + `cancelReason` + `cancelledAt` + `cancelledById`
   (`*_cancel_chk` requires all three together).

Per type:
- **SALE**: units `SOLD → IN_STOCK` with `SALE_CANCEL +1` movements (unit not
  `SOLD` defensively → `saleCancelUnitNotSold`), accessory stock `+qty` with
  `SALE_CANCEL +qty`, its ACTIVE payments each cancelled + one cash REVERSAL
  **OUT** → soft overdraft prompt (a sale cancel pays cash *out* — the one
  cancel flow that can, payments/supplier-payments cancel only move cash back
  in).
- **PURCHASE**: phone line with any unit not `IN_STOCK` → 400
  `purchaseCancelUnitNotInStock`; accessory stock would go negative → 400
  `insufficientStock`. Units → `VOIDED`, accessories decrement,
  `PURCHASE_CANCEL −qty` movements (ref `PURCHASE` + id), ACTIVE
  `supplier_payments` on this bill each cancelled + one cash REVERSAL **IN**.
- **PAYMENT**: one REVERSAL **OUT**. Cancels a single row by id — WF10's
  `receiptGroupId` siblings are *not* auto-cancelled (owner cancels each row).
- **SUPPLIER_PAYMENT**: one REVERSAL **IN**. Cash-row lookup falls back from
  `(SUPPLIER_PAYMENT, paymentId)` to `(PURCHASE, purchaseId)` because WF6's
  `paidNow` wrote the cash row against the purchase — both patterns satisfy
  `cash_movements_ref_chk`. Missing original movement → 404 inside the tx so
  the reversal never lands with a null `reversesMovementId`.

Impact preview: `GET /sales/{id}/cancel-impact`, `GET /purchases/{id}/cancel-impact`,
`GET /payments/{id}/cancel-impact`, `GET /supplier-payments/{id}/cancel-impact`
→ `CancelImpactResponseDto` (`src/common-dto/response/cancel-impact.dto.ts`).
Read-only, scoped to `shopId`, 400 if already CANCELLED, 404 cross-shop,
writes nothing. It shows current cash, the reversal amount/direction, cash
after, payable/Udhar after, stock items that would return, and `blocked`
(+reason) when the cancel would be refused (e.g. a sold phone not back in
stock). The actual cancel still takes `confirmOverdraft: true` for the soft
cash warning — same dance as WF6/WF7/WF13.

Then: Ledger (WF11) → Dashboard (WF14) → opening cash (`cash/`, WF1) — all
built; Release 1 is complete.

---

## 6b. DONE — Sales (WF9)

`src/sales/` ✅ `POST /sales`, `GET /sales`, `GET /sales/{id}`.

One `$transaction`, written in **two phases** so a bad line never leaves a
half-sale behind:
1. `UPDATE shops SET next_sale_no = next_sale_no + 1 … RETURNING` → `S-0007`
   (shop row lock first → same shop→stock order as WF6/WF7).
2. **Phase 1 — lock & validate every line** (`FOR UPDATE`): serialized → unit
   must be `IN_STOCK` in this shop (`unitNotAvailableForSale` otherwise);
   quantity → lock `stock_levels`, `quantityOnHand >= qty`. Nothing is written
   yet — the sale row is created only after every line passed.
3. Totals server-side: `subtotal = Σ qty × unitPrice`,
   `0 ≤ discount ≤ subtotal`, `paidNow ≤ totalAmount`, never read from client.
4. **Phase 2 — write**: `sale` row → per-line `sale_item` (unitCost
   snapshotted under the lock) → units `SOLD` / stock decremented → `SALE`
   movements (ref `SALE` + sale id).
5. `paidNow > 0` → one `payments` row + one `cash_movements`
   (CUSTOMER_PAYMENT, IN, ref `PAYMENT` + payment id). Cash direction is
   always IN for a sale.
6. `clientRequestId` replay: pre-check before validation →
   `"Sale already saved"`; racing P2002 inside the tx caught with
   `violatedColumn(error, 'client_request_id')` → same message (rule 6).

**Deliberate differences from the original plan:**
- ❌ **No overdraft prompt on sales** — a sale only ever puts cash IN, so the
  drawer balance cannot go negative from one. `POST /sales` always answers
  **201**; there is no `confirmOverdraft` field (WF6/WF7 keep theirs).
- A phone line or any unpaid balance **requires `customerId`** — walk-in cash
  sales must be paid in full (`customerRequiredForSale`).
- Wrong-shape lines are hard 400s before the tx: phone line with
  `quantity ≠ 1`, quantity line with `inventoryUnitId`, duplicate IMEI in the
  request, `inventoryUnitId` on a QUANTITY product.

---

## 6c. DONE — Payments (WF10)

`src/payments/` ✅ `POST /payments`, `GET /payments`, `GET /payments/{id}`.

One `$transaction`, detail in §13's Payments section:
1. Replay pre-check before validation → `"Payment already saved"`.
2. Tenant 404s: customer `{ id, shopId }`; every explicit `salesIds` entry must
   be that customer's ACTIVE sale in this shop; duplicates → 400.
3. **Lock order: shop row → customer row → candidate sale rows sorted by
   `(saleDate, id)`.** The customer row serialises opening-balance-only
   payments, which touch no sale rows (the WF7 supplier-lock trick).
4. Replay check **again inside the tx** — the expression index
   `payments_idempotency_uq` alone cannot catch a racing duplicate (same
   `clientRequestId`, different `sale_id` → no collision).
5. Outstanding derived fresh under the lock
   (`openingBalance + Σ active sales − Σ active returns + Σ active refunds −
   Σ active payments`); `amount ≤ total` else
   `400 paymentExceedsOutstanding`. Allocation oldest-first: opening balance
   first, then sales by date; explicit `salesIds` exclude the opening balance.
6. One `payments` row per portion (shared `receiptGroupId` + `clientRequestId`,
   `saleId = null` for the opening part) → one `cash_movements` per payment
   (CUSTOMER_PAYMENT, IN, ref `PAYMENT` + payment id,
   `movementDate = paymentDate`).
7. **No overdraft prompt** — cash only enters the drawer, always **201**
   (same deliberate difference as WF9, see §6b).

---
---

# PART B — REFERENCE

## 7. Workspace layout & reference files

```
/home/usman/saas/
├── dukan-pro-backend/     ← THIS PROJECT (NestJS 12 + Prisma 7 + PostgreSQL)
│   ├── prisma/            multi-file schema (schema.prisma + enums.prisma + models/), constraints.sql, migrations/
│   ├── src/               modules (see §13)
│   ├── test/              verify-constraints.sql, jest-e2e.json, e2e/ (see §16)
│   ├── README.md          how to RUN it
│   ├── AGENTS.md          this file — how to BUILD it
│   └── api/openapi.json   machine-readable API contract
├── example-backend/       REFERENCE ONLY — a different product (fintech). Copy
│                          PATTERNS (module/controller/service/dto layout,
│                          paginate-helper, error.builder, AuthGuard wiring).
│                          DO NOT copy its schema or business logic.
├── Requirements/          human specs (read before building a WF endpoint)
│   ├── Dukaan_Pro_Complete_Guide_Plain_English.txt   plain-English walkthrough
│   ├── Dukaan_Pro_ERD_v2.1_OnlineStore.txt           data model (ERD v2.1)
│   └── Dukaan_Pro_Workflows_v3_OnlineStore.txt       22 workflows (v3)
└── CLAUDE.md              10-line pointer only (workspace root is NOT a git repo)
```

⚠️ **`example-backend/` uses a completely different Prisma schema** (remittance,
KYC, accounts, rails, exchanges). It is a *pattern* source, never a copy-paste
source for Dukaan Pro business logic.

---

## 8. Release plan — releases, one database

Everything (including Release 1.1 tables) is in the DB from day one. The only
difference is which endpoints exist.

| Release | When | Business tables | Workflows |
|---|---|---|---|
| **Release 1** 🔴 done | MVP, first real shop | 19 shop tables + `platform_admins` | WF1–WF14 (Onboarding → Simple Dashboard) |
| **Release 1.2** 🟢 done | Online Store | +2: `shop_store_settings`, `product_images` (+ Product publish fields + `PtaStatus`) | **WF19–WF22** (settings, publish products, images, public catalog) |
| **Release 1.1** 🟢 all done | after R1 feedback | +4: `returns`, `return_items`, `refunds`, `cash_reconciliations` | WF15 ✅ (Returns) + WF16 ✅ (Owner Inv/Wdl) + WF17 ✅ (Cash Count) + WF18 ✅ (Reports) |

---

## 9. The three engines

Every workflow reduces to one of these. Every service implements one or more.

| Engine | Question | Source-of-truth tables | Golden rule |
|---|---|---|---|
| 📦 **Stock** | *What do we have, why did it change?* | `inventory_units` (phones, IMEI) + `stock_levels` (accessories) + `inventory_movements` (append-only) | You never edit stock directly — write a movement and update the current-value row. |
| 💰 **Cash** | *How much real cash, and why?* | `payments` + `supplier_payments` + `expenses` + `cash_movements` (append-only) | Sales and purchases **alone never change cash**. Only a real payment/expense/refund does. Balance = `SUM(IN) − SUM(OUT)`. |
| 🧾 **Udhar** | *Who owes us, who do we owe?* | `sales` + `payments` + `purchases` + `supplier_payments` | Outstanding is **calculated from active records, never typed**. `opening_balance` on customer/supplier + the opening-stock purchase give Day-0 data. |

| Derived balance | Formula |
|---|---|
| Customer Udhar | `customer.openingBalance + Σ active sales − Σ active returns + Σ active refunds − Σ active payments` |
| Supplier payable | `supplier.openingBalance + Σ active purchases − Σ active supplier_payments` |

All four are derived on read. **Never stored.**

---

## 10. Schema — 26 models, 14 enums

The schema is **multi-file** and matches ERD v2.1 (Online Store additions included): `prisma/schema.prisma` holds only the `generator` + `datasource` and the file map, `prisma/enums.prisma` holds all 14 enums, and `prisma/models/<domain>.prisma` holds the models grouped by module. `prisma.config.ts` points `schema` at the **directory** (`'prisma'`) so Prisma merges every file; the migration history stays a single linear chain. (Public API shape and some minor spec details are cross-referenced below.)

**26 models** (25 shop tables + 1 platform table):

| # | Module | Model → table | Release |
|---|---|---|---|
| 1 | Tenant/User | `Shop` → shops | 1 |
| 2 | Tenant/User | `User` → users | 1 |
| 3 | Tenant/User | `PlatformAdmin` → platform_admins | 1 (outside tenant) |
| 4 | Products | `Category` → categories | 1 |
| 5 | Products | `Brand` → brands | 1 |
| 6 | Products | `Product` → products | 1 |
| 7 | Purchasing | `Supplier` → suppliers | 1 |
| 8 | Purchasing | `Purchase` → purchases | 1 |
| 9 | Purchasing | `PurchaseItem` → purchase_items | 1 |
| 10 | Purchasing | `SupplierPayment` → supplier_payments | 1 |
| 11 | Inventory | `InventoryUnit` → inventory_units | 1 |
| 12 | Inventory | `StockLevel` → stock_levels | 1 |
| 13 | Inventory | `InventoryMovement` → inventory_movements | 1 |
| 14 | Sales | `Customer` → customers | 1 |
| 15 | Sales | `Sale` → sales | 1 |
| 16 | Sales | `SaleItem` → sale_items | 1 |
| 17 | Sales | `Payment` → payments | 1 |
| 18 | Expenses | `ExpenseCategory` → expense_categories | 1 |
| 19 | Expenses | `Expense` → expenses | 1 |
| 20 | Cash | `CashMovement` → cash_movements | 1 |
| 21 | Returns | `SaleReturn` → returns | 1.1 |
| 22 | Returns | `ReturnItem` → return_items | 1.1 |
| 23 | Returns | `Refund` → refunds | 1.1 |
| 24 | Cash | `CashReconciliation` → cash_reconciliations | 1.1 |
| 25 | Online Store | `ShopStoreSettings` → shop_store_settings | 1.2 |
| 26 | Online Store | `ProductImage` → product_images | 1.2 |

**14 enums:**

| Enum | Values |
|---|---|
| `ShopStatus` | ACTIVE / SUSPENDED |
| `UserRole` | OWNER (only role in MVP) |
| `UserStatus` | ACTIVE / SUSPENDED |
| `TrackingType` | QUANTITY / SERIALIZED |
| `UnitCondition` | NEW / USED |
| `UnitStatus` | IN_STOCK / SOLD / DAMAGED / LOST / VOIDED |
| `RecordStatus` | ACTIVE / CANCELLED |
| `PaymentMethod` | CASH (more later) |
| `CashDirection` | IN / OUT |
| `CashMovementType` | OPENING_CASH, CUSTOMER_PAYMENT, SUPPLIER_PAYMENT, EXPENSE, REVERSAL + (R1.1) REFUND, OWNER_INVESTMENT, OWNER_WITHDRAWAL, RECONCILIATION_ADJUSTMENT |
| `InventoryMovementType` | PURCHASE, SALE, SALE_CANCEL, PURCHASE_CANCEL + (R1.1) CUSTOMER_RETURN, DAMAGED, LOST, ADJUSTMENT |
| `ReferenceType` | PURCHASE, SALE, PAYMENT, SUPPLIER_PAYMENT, EXPENSE, RETURN, REFUND, RECONCILIATION, MANUAL |
| `ReturnCondition` | GOOD / DAMAGED (R1.1) |
| `PtaStatus` | PTA_APPROVED / NON_PTA (R1.2, nullable — accessories have no PTA status) |

All 15 v1 → v2 schema changes are present: cancel-with-reason fields on 5 tables,
`reverses_movement_id` + REVERSAL type, `is_overdraft`, no item-level discount,
automatic counters + `sale_no`/`purchase_no`, `supplier_invoice_ref`,
`receipt_group_id`, `client_request_id` + unique indexes, `condition` + LOST &
VOIDED, `suppliers.is_system`, optional `payments.customer_id` and
`supplier_payments.purchase_id`, `purchases.is_opening_stock`, nullable
`password_hash` + `password_setup_token_hash`, and the Release-1.1 split.

**Release 1.2 additions:** `ShopStoreSettings` (one row per shop, `slug` @unique,
`isEnabled` default false, contact/URL fields, `showExactStock` default false —
every scene field is intentionally **public**), `ProductImage` (max-per-product
enforced in the service, lowest `sortOrder` = cover), Product publish fields
(`isPublished` default false + `publishedAt` maintained **by a DB trigger**,
`publicDescription`, `contactForPrice`, `ptaStatus`), and `PtaStatus` enum.
Backfill gives every existing shop a disabled store row (unique slug derived
from shop name, fallback `shop-<id>` + `-N` suffix). No-delete trigger on
`shop_store_settings` only.

### Data conventions (never deviate)

| Convention | Value |
|---|---|
| IDs | UUID v7 (`@default(uuid(7))`) |
| Money / prices | BIGINT **paisa** |
| created/updated/cancelled/saleDate | `timestamptz(3)` UTC |
| Business dates (no time) | `date` — `purchaseDate`, `expenseDate`, `dueDate`, supplier `paymentDate` |
| DB naming | snake_case (`@@map`, `@map`) |
| Prisma naming | camelCase |
| FK delete | `onDelete: Restrict` everywhere — no cascade |
| Default lists (categories, brands, expense categories) | **Copied per shop** on onboarding, not shared rows |
| Default supplier | Per-shop "Walk-in seller", `isSystem = true`, cannot be renamed/deleted |
| `platform_admins` | **No `shop_id`** — lives outside the tenant, separate auth flow |

### Constraints

`prisma/constraints.sql` is the source of truth for everything Prisma cannot
express (CHECKs, partial/expression indexes, triggers, RLS plan). After any edit:

```bash
psql "$DATABASE_URL" -f test/verify-constraints.sql
# every T-numbered line must print BLOCKED — "NOT BLOCKED" = regression
```

---

## 11. The 22 workflows (WF1–WF22) → endpoints & service logic

### Release 1 — build these first

**WF1 🏬 Shop onboarding** ✅ **BUILT**
Admin creates shop + owner → `setupUrl` returned in the response → admin
forwards it on WhatsApp → owner sets password → optional opening data.

| Endpoint | Auth |
|---|---|
| `POST /auth/platform-admin/login` | platform admin |
| `POST /platform-admin/shops` | platform admin — **one transaction**: shop + owner + copied defaults (7 categories, 8 expense categories) + Walk-in supplier + setup token |
| `GET /platform-admin/shops/{id}` | `{ hasOwner, ownerPhone, hasPassword }` |
| `POST /platform-admin/users/{ownerId}/password-setup-link` | reissues, kills the old link |
| `POST /auth/setup-password` | token + new password → bcrypt hash, clears token; 400 if expired/used |

Owner opening data ✅ **BUILT**: `POST /cash/opening` (`cash/` module, one
OPENING_CASH row per shop), `PATCH /customers/:id` (sets `openingBalance`),
`PATCH /suppliers/:id`, `POST /purchases` with `isOpeningStock: true`.

**WF2 🔐 Login and shop access check** ✅ **BUILT**

| Endpoint | Notes |
|---|---|
| `POST /auth/login` | bcrypt compare → user ACTIVE → shop ACTIVE + subscription not expired → JWT `{ sub, shopId, role }` |
| `GET /auth/me` | user + shop summary |
| `POST /auth/change-password` | owner only |

Wrong phone, wrong password, **and an account that exists but has not set its
password yet** return an **identical 401** (`invalidCredentials`) so an attacker
cannot probe which numbers are registered or half-set-up (the un-set path still
burns one bcrypt compare on the timing equaliser). Suspended/expired shop
returns a specific 403, not a generic wrong-password message. Password reset =
the same setup-link flow (no separate forgot/reset endpoint).

**WF3 📅 Subscription suspend / renew** ✅ **BUILT**
`PATCH /platform-admin/shops/{id}/subscription` — extends `subscriptionEndsAt`,
toggles `status`. Login returns a specific message when suspended.

**WF4 🛍️ Set up products** ✅ **BUILT**
`GET/POST/PATCH categories`, `GET/POST/PATCH brands`, `GET/POST/PATCH products`.
- Unique `(shopId, name)` on categories/brands; products also unique on `sku` and `barcode`.
- POST product (QUANTITY) → also creates `stock_levels` (`quantityOnHand = 0`).
  POST (SERIALIZED) → **no** `stock_levels` row.
- `trackingType` cannot change after the first purchase/sale.
- Lists are paginated `{ items, total, page, pageSize }`.

**WF5 📦 Add a supplier** ✅ **BUILT**
`GET/POST/PATCH suppliers` — `openingBalance` in paisa. `isSystem = true` rows
reject edit/deactivate with **403**. Names are **not** unique.

**WF6 🛒 Purchase (Stock In)** ✅ **BUILT** — `POST /purchases`,
`GET /purchases`, `GET /purchases/{id}`. One `$transaction`:
1. `UPDATE shops SET next_purchase_no = next_purchase_no + 1 … RETURNING
   next_purchase_no - 1` → `P-0001`, `P-0002`, …
2. `purchases` row with server-computed `total_amount`, `clientRequestId`,
   `supplierInvoiceRef`, `purchaseDate`, `isOpeningStock`
3. one `purchase_items` row per line (`total_cost = qty × unit_cost`)
4. inventory: SERIALIZED → N × `inventory_units` (IMEI count must equal
   quantity, unique per shop, request-internal duplicates checked in code);
   QUANTITY → upsert `stock_levels` (+qty, weighted `avgUnitCost`)
5. `inventory_movements` per change (PURCHASE, ref PURCHASE+id)
6. `paidNow > 0` → `supplier_payments` + `cash_movements`
   (SUPPLIER_PAYMENT, OUT). `isOpeningStock` → **no payable, no cash**.
7. cash < 0 → **200** `{confirmOverdraft, shortfall, message}` with nothing
   written → retry with `confirmOverdraft: true` → **201**, `isOverdraft: true`


**WF7 💸 Pay a supplier later** ✅ **BUILT** —
`POST /supplier-payments`, `GET /supplier-payments`,
`GET /supplier-payments/payable/{supplierId}`.
1. Outstanding is **derived, never stored**: `openingBalance + Σ active real
   purchases (isOpeningStock excluded) − Σ active supplier_payments`.
2. `purchaseId` given → that bill's `totalAmount − Σ active payments` (bill
   must be ACTIVE, real, and from the same supplier); omitted/null → the
   opening balance minus its active payments.
3. One `$transaction`: shop row locked `SELECT ... FOR UPDATE` first
    (serialises the cash-drawer read for every writer in this shop), then the
    supplier row locked — the remaining-outstanding check therefore runs under
    the lock, followed by one `supplier_payments` row (purchaseId null =
    opening balance) + one `cash_movements` (SUPPLIER_PAYMENT, OUT,
    referenceType SUPPLIER_PAYMENT + payment id, `isOverdraft` when flagged).
    Lock order is always shop → supplier, so two payments cannot deadlock.
4. Cash < 0 → **200** `{confirmOverdraft, shortfall, message}`, nothing
   written → retry `confirmOverdraft: true` → **201** (same prompt shape as
   WF6, reused `PurchaseOverdraftResponseDto`).
5. No `clientRequestId` on `supplier_payments` — the ERD grants idempotency
   keys to sales, purchases and payments only, so double-tap protection comes
   from the per-supplier row lock, not a replay key. Do not add a column
   without asking.

**WF8 🔧 Stock adjustment, damaged & lost** ✅ **BUILT** —
`POST /inventory/adjustments`, `GET /inventory/adjustments`.
One change in one `$transaction`: append an `inventory_movements` row and move
the current-value row.
1. **ADJUSTMENT (accessories only)**: `countedQuantity` is **absolute** — the
   stock row is locked `SELECT ... FOR UPDATE`, then `quantityChange =
   countedQuantity − current`. `delta === 0` (the count already matches)
   returns **200** with nothing written — `inventory_movements_qty_chk`
   forbids `0` rows, so "no change" must mean no row. Stock row missing →
   created with `avgUnitCost = 0n`. `countedQuantity: 0` is legal (an empty
   shelf is a real count).
2. **DAMAGED / LOST (accessories)**: atomic conditional
   `UPDATE stock_levels SET quantity_on_hand = quantity_on_hand - qty WHERE …
   AND quantity_on_hand >= qty` — PostgreSQL is the referee against concurrent
   double-consumption; zero rows updated → `insufficientStock` 400 with the
   real available number. Movement `quantityChange = -qty`.
3. **DAMAGED / LOST (phones)**: the unit row is locked `SELECT id, status,
   imei1 FROM inventory_units WHERE id/shop_id/product_id FOR UPDATE`; must be
   `IN_STOCK` (else `unitNotInStock` 400), then its `status` flips to
   `DAMAGED`/`LOST` and a `-1` movement is appended with `inventoryUnitId`.
   **ADJUSTMENT is refused on phones** (`adjustmentNotAllowedForSerialized`).
4. **Shape rules run before the write** — a wrong extra field is a 400, never
   a silent ignore: `ADJUSTMENT` forbids `quantity`/`inventoryUnitId`;
   accessory write-offs forbid `countedQuantity`/`inventoryUnitId`; phone
   write-offs forbid both accessory fields and require `inventoryUnitId`.
5. `reason` is mandatory for all three — a stock change with no "why" is a lie
   in the ledger. Movements have their `referenceType`/`referenceId` **null**:
   the adjustment is its own business document, not a side-effect of a
   purchase/sale (satisfies `inventory_movements_ref_chk`).
6. The list endpoint defaults to `type IN (ADJUSTMENT, DAMAGED, LOST)` only —
   purchase/sale movements belong to the ledger, not this screen. Rows carry
   `productName` and `imei` in one query; `sortBy ∈ createdAt|quantityChange`;
   search matches product name + reason; `from`/`to` go in `where.AND`.
7. 201 only when a row was written (same `@Res({ passthrough: true })` status
   trick as WF6/WF7).

**WF9 💰 Create a sale (cash / part payment / Udhar)** ✅ **BUILT** —
`POST /sales`, `GET /sales`, `GET /sales/{id}`. One `$transaction` in two
phases (details in §6b): counter → lock & validate every line → sale row →
sale_items → inventory SOLD/decrement + SALE movements → payment + cash
CUSTOMER_PAYMENT IN. **No overdraft prompt** (cash only ever enters the
drawer). Phone line or outstanding balance requires `customerId`.
`clientRequestId` replay → `"Sale already saved"`.

**WF10 🧑 Customer pays Udhar** ✅ **BUILT** —
`POST /payments`, `GET /payments`, `GET /payments/{id}`. One `$transaction`:
replay pre-check → tenant 404s → lock shop → customer → sale rows (sorted) →
replay check again under the lock → outstanding derived fresh
(`openingBalance + Σ active sales − Σ active payments`) → `amount ≤ total`
else 400 → oldest-first allocation (opening balance first, then sales by date;
explicit `salesIds` exclude the opening balance) → one `payments` row per
portion sharing one `receiptGroupId` + `clientRequestId` → one
`cash_movements` CUSTOMER_PAYMENT IN per payment. **No overdraft prompt** —
cash only enters the drawer, always **201**. Details in §6c.

**WF11 📒 Customer / supplier ledger** ✅ **BUILT** —
`GET /customers/:id/ledger`, `GET /suppliers/:id/ledger` → `{ balance,
openingBalance, page, pageSize, total, items[] }` where each item is a
`LedgerEntryDto` (`type`, `date`, `reference`, `notes`, `amount`, `delta`,
`balance`, `status`). Two reads (sales + payments, or purchases +
supplier_payments) merged, sorted oldest-first by (date, createdAt, id), then
a running balance is folded over the **whole** timeline before paging — so page
2's balances include page 1. Cancelled rows are listed with `delta: 0` (WF12's
"stay visible" rule) and never move the balance. Customer balance = `openingBalance
+ Σ ACTIVE sales − Σ ACTIVE returns + Σ ACTIVE refunds − Σ ACTIVE payments`
(equals the WF10 outstanding); supplier
balance = `openingBalance + Σ ACTIVE real purchases − Σ ACTIVE supplier_payments`
(equals `GET /supplier-payments/payable/{id}.payable` — `isOpeningStock`
purchases are excluded from both rows and sum). A payment's `reference` is the
`saleNo`/`purchaseNo` it paid, `null` = opening balance. No query filters beyond
`page`/`pageSize` (max 200) — ledgers are oldest-first by nature.

**WF12 ❌ Cancel with reason** ✅ **BUILT** —
`POST /sales/{id}/cancel`, `POST /purchases/{id}/cancel`,
`POST /payments/{id}/cancel`, `POST /supplier-payments/{id}/cancel`, OWNER only,
`{ cancelReason }` required. Shared rules (shop row lock → record row lock,
REVERSAL cash rows with `reversesMovementId`, soft overdraft prompt where cash
can go negative) are in §6:
- **SALE**: restore stock → `SALE_CANCEL` movements → cancel its payments →
  cash `REVERSAL` rows (opposite direction, `reversesMovementId`) →
  `sale.status = CANCELLED`. Cash < 0 → soft warning → `isOverdraft`.
- **PURCHASE**: fail if any phone is not `IN_STOCK`, or if accessory stock would
  go negative. Phones → `VOIDED`, accessories decrement, `PURCHASE_CANCEL`
  movements, active supplier_payments cancelled + cash REVERSAL (IN).
- **PAYMENT / SUPPLIER_PAYMENT**: `CANCELLED` + one cash REVERSAL, opposite direction.

**WF13 🧾 Add & cancel expense** ✅ **BUILT** —
`POST /expenses`, `POST /expenses/{id}/cancel`, `GET /expenses`,
`GET /expenses/{id}`. Create: category tenant-check → one tx (shop row lock →
soft overdraft prompt → `expenses` ACTIVE + `cash_movements` EXPENSE OUT).
Cancel: `CANCELLED` + reason/time/user + one cash REVERSAL (IN) pointing at
the original movement via `reversesMovementId`. See §13 for the rules.

**WF14 📊 Simple dashboard** ✅ **BUILT** —
`GET /dashboard?period=today` (only `today` in R1; other periods → 400) →
`{ period, date, todaySales, todayNetProfit, customerUdhar, supplierPayable,
todayExpenses, lowStockProducts, cashPosition, links }`, all excluding
cancelled rows. One module, `src/dashboard/`, pure reads in one
`Promise.all` (no transaction, no writes). `date` = the **Asia/Karachi**
business day (`src/helpers/date.helper.ts`); `timestamptz` ranges use the PKT
day's UTC instants, `date` columns compare against the plain YYYY-MM-DD.
- `todayNetProfit` = todaySales − Σ `unitCost × quantity` on those sales
  (row-by-row — Prisma cannot multiply inside `aggregate()`) − ACTIVE
  expenses dated today. Can be negative.
- `customerUdhar` / `supplierPayable` are shop-wide sums (openings + ACTIVE
  in − ACTIVE out); walk-in cash sales cancel out because their payment row
  has `customerId: null`. Customer side is `openings + sales − returns +
  refunds − payments` (WF15); supplier side excludes `isOpeningStock`
  purchases.
- `lowStockProducts`: active QUANTITY products with `quantityOnHand ≤
  lowStockThreshold` (missing stock row = 0) + active SERIALIZED products
  with IN_STOCK unit count ≤ threshold — two `product.findMany` calls,
  compared in JS (Prisma cannot compare two columns).
- `cashPosition` = `cash_movements` groupBy direction, IN − OUT.
- `links` maps each number to its drill-through list (`cashPosition` →
  `GET /cash/movements` from the `cash/` module).

### Release 1.1 — after R1 is used

| WF | What |
|---|---|
| **WF15** ↩️ Return & refund ✅ **BUILT** — see the Returns section below. | Uses `returns`, `return_items`, `refunds`. A sale with returns **cannot** be cancelled. |
| **WF16** 🏦 Owner investment / withdrawal ✅ **BUILT** — `src/cash/` (see the Cash section below). | Only two `cash_movement` types. **Never** counted as revenue or expense. |
| **WF17** 💰 Cash count | systemCash from the ledger vs counted cash; non-zero difference requires a reason → `cash_reconciliations` + `RECONCILIATION_ADJUSTMENT`. ✅ **BUILT** — see the Cash Reconciliations section below. |
| **WF18** 📑 Reports + export ✅ **BUILT** — see the Reports section below. | Every list takes `{ period, from, to, page, pageSize, sortBy, sortOrder, format }`; today/week/month/custom ranges in Asia/Karachi; CSV export via `format=csv`. Eight reports: sales, purchases, expenses, profit, Udhar (customers), payable (suppliers), inventory and best-sellers. |

### Release 1.2 — Online Store (endpoints DONE)

DB layer built and migrated (`shop_store_settings`, `product_images`, Product
publish fields, `PtaStatus`, publish trigger, `products_public_catalog_idx`,
slug/URL/WhatsApp CHECKs, **https-only** `product_images_url_chk`, per-shop
backfill) and the `src/store/` endpoints built on top. `StoreModule`
registers **three controllers** in `app.module.ts`:
- `StoreController` (`@Controller('store')`, OWNER AuthGuard):
  - `GET /store/settings` — 404 when this shop never configured a store.
  - `PATCH /store/settings` — **upsert** (rules in §13). There is **no `slug`
    field in the DTO at all** — the owner can never change the store address
    (WF19 step 2); only a platform admin can, through
    `PATCH /platform-admin/shops/{id}/store-slug` (`ChangeStoreSlugDto` →
    `PlatformAdminService.changeStoreSlug` → `StoreService.changeStoreSlug`,
    so format/reserved/uniqueness validation lives in exactly one place).
  - Owner preview while the store is still OFF (WF19 step 4):
    `GET /store/preview`, `/store/preview/categories`,
    `/store/preview/products`, `/store/preview/products/:productId` — the
    same builders as the public routes, keyed by `shopId` from the JWT
    (404 `resourceNotFound('Store settings')` when the shop has no row).
  - `POST /store/products/:id/publish` / `POST /store/products/:id/unpublish`
    (convenience single-flip routes; the doc's surface is `PATCH /products/:id`
    + `PATCH /products/publish` below — both paths share the same rules).
- `ProductImagesController` (`@Controller('products')`, OWNER AuthGuard,
  registered by `StoreModule` so the **routes match the Online Store API
  table** while the image rules stay in `StoreService`):
  - `POST /products/:id/images`, `PATCH /products/:id/images/order`,
    `DELETE /products/:id/images/:imageId` — image `url` must be **https**
    (DTO regex + DB CHECK), ≤5 per product. No path overlap with
    `ProductsController` (segment counts differ).
- `StorefrontController` (`@Controller('public/stores')`, **NO auth**,
  `@UseGuards(RateLimitGuard)` — `src/store/guards/rate-limit.guard.ts`, an
  in-memory fixed window of 100 req/min/IP, so 100 req/min/IP), four public
  routes:
  - `GET /public/stores/:slug` — profile allowlist (`ResponseStoreDto`, no
    `shopId`, no `isEnabled`, no `showExactStock`).
  - `GET /public/stores/:slug/categories` — distinct categories/brands that
    have at least one published product.
  - `GET /public/stores/:slug/products` — `{ page, limit≤50, category, brand,
    q }` (`category`/`brand` = UUID **or** exact name; `q` = case-insensitive
    contains), `publishedAt desc`, returns `PaginatedResponseDTO`.
  - `GET /public/stores/:slug/products/:productId`.
  All four run `resolvePublicStore()`: slug → row lookup cached ~60s in
  `StoreCacheService`, then `shops.status` read **fresh** every request;
  missing slug, `isEnabled = false` and a SUSPENDED shop all throw the
  **same** `storeNotAvailable()` 404 (`src/errors/error.builder.ts`), so the
  three cases are indistinguishable. Success responses carry
  `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` (passthrough
  `@Res`, set only after the service succeeds).
- Products module: `PATCH /products/:id` also accepts `isPublished`,
  `publicDescription`, `contactForPrice`, `ptaStatus` (publishing an inactive
  product — including deactivate+publish in one body — is 400
  `productNotPublishable`); `PATCH /products/publish` bulk-flips a selection
  in one transaction (`BulkPublishProductsDto`, foreign id → 404, inactive →
  400). `publishedAt` is never written by the app — the DB trigger owns it.
- Onboarding (`POST /platform-admin/shops`) creates the settings row in the
  same transaction: store **OFF**, `slug` derived through the shared
  `src/store/helpers/store-slug.helper.ts` (identical algorithm to the R1.2
  DB backfill: slugify → 34-char truncation → `shop-<id6>` fallback →
  `-shop` for reserved → `slug-2`, `slug-3`… until free), `displayName` =
  shop name capped at 100 chars.

The store is reachable by `slug` (public storefront) or by `shopId` (owner
settings/preview, from the JWT). `shop_store_settings` rows can **never be
deleted** (trigger) — there is no DELETE settings endpoint, deliberately.

---

## 12. Module map & build order

```
src/
├── app-configuration/, auth/, auth-guards/, brands/, categories/,
│   common/, common-dto/, constants/, customers/, errors/,
│   expense-categories/, expenses/, helpers/, platform-admin/, prisma/,
│   products/, suppliers/, supplier-payments/, purchases/,
│   inventory/, sales/, payments/, dashboard/, cash/, store/, returns/,
│   app.*, main.ts
```

Create in this order (✅ = done):

1. ✅ `errors/` + `helpers/` — error builders, `paginate-helper.ts`,
   `phone.helper.ts`, `token.helper.ts`, `logger-helper.ts`, `prisma-error-helper.ts`
2. ⛔ `email/` — **deliberately not built.** Do not add without asking.
3. ✅ `auth/` + `auth-guards/` (WF1+2) — `auth-token.ts`, `auth-guard.ts` (OWNER),
   `platform-admin.guard.ts`. Two JWT `typ` values, not interchangeable.
4. ✅ `platform-admin/` (WF1 + WF3)
5. ✅ `categories/`, `brands/`, `products/` (WF4)
6. ✅ `suppliers/` (WF5) + `GET /suppliers/:id/ledger` (WF11)
7. ✅ `customers/` (CRUD + WF1 day-0) + `GET /customers/:id/ledger` (WF11)
8. ✅ `expense-categories/` + `expenses/` (WF13)
9. ✅ `purchases/` (WF6) + `supplier-payments/` (WF7)
10. ✅ `inventory/` (WF8)
11. ✅ `sales/` (WF9) + `payments/` (WF10) + WF12 cancel flows
12. ✅ `cash/` (WF1 opening cash + cash-movement list)
13. ✅ `dashboard/` (WF14)
14. ✅ **R1.2: `store/`** — Online Store endpoints (WF19–WF22): settings + preview, publish products single/bulk, product images, `public/stores/` catalog
15. ✅ **R1.1: `returns/`** (WF15) — return/preview/list/get
16. ✅ **R1.1: WF16** — built into `src/cash/` (two `cash_movements` types, no new module)
17. ✅ **R1.1: `cash-reconciliations/`** (WF17) — reconcile list + `RECONCILIATION_ADJUSTMENT`
18. ✅ **R1.1: `reports/`** (WF18) — 8 report endpoints + CSV export (CSV only; PDF not implemented)

Register each new module in `app.module.ts` `imports`.

---

## 13. Module rules for what's already built

> Do not "fix" any of these without asking — several are deliberate.

### Brands & Categories
Five endpoints each. Scoped to `shopId`, duplicate names → 400. DTOs trim
whitespace before the length check. `isActive` query accepts only `true`/`false`.
Controllers rethrow Nest `HttpException`s unchanged and wrap anything else as 500.

### Auth (`src/auth/`, `src/auth-guards/`)
Do not create a second auth module. Guards live in `auth-token.ts` (verify +
type check), `auth-guard.ts` (OWNER), `platform-admin.guard.ts` (PLATFORM_ADMIN).

### Platform admin (`src/platform-admin/`)
Shop + owner + copied defaults + Walk-in supplier + setup token written in
**one** transaction. Setup link minted through `AuthService.buildSetupLink(userId, tx)`
so token rules cannot drift. Setup URLs are returned to the admin, never logged.
Known limits: `passwordSetupTokenHash` has no DB index; `setShopActive()` is
unused — prefer the subscription endpoint. The store-address rename
`PATCH /:id/store-slug` validates in `StoreService.changeStoreSlug` (the
module imports `StoreModule`) so the admin path and the owner's settings
surface can never drift apart.

### Products (`src/products/`, WF4)
- `categoryId` / `brandId` validated as belonging to `request.user.shopId`
  **before every write** — the FKs carry no `shopId`, so skipping this would let
  one shop attach another shop's category.
- QUANTITY creates `stock_levels` in the same `$transaction`; SERIALIZED does not.
- `trackingType` locked once `purchase_items` or `sale_items` reference it;
  switching to SERIALIZED additionally requires `quantityOnHand = 0`.
- Three uniques — `(shopId,name)`, `(shopId,sku)`, `(shopId,barcode)` — each with
  its own message via `violatedColumn()`.
- List rows carry `categoryName`, `brandName`, `quantityOnHand` in one query.
- **R1.2 publish write-paths (WF20)**: `PATCH /products/:id` accepts
  `isPublished`, `publicDescription`, `contactForPrice`, `ptaStatus` — an
  inactive product can never be published, including when the same body
  deactivates it (`productNotPublishable`, checked against `willBeActive`).
  `PATCH /products/publish` (`BulkPublishProductsDto`) flips a whole
  selection in ONE transaction: every id must resolve `{ id, shopId }`
  (missing → 404, nothing silently skipped), inactive → 400 when publishing.
  Neither path writes `publishedAt` — the DB trigger owns it. Route
  `@Patch('/publish')` is declared BEFORE `@Patch('/:id')` so "publish" is
  never parsed as a UUID.

### Suppliers (`src/suppliers/`, WF5)
- `updateSupplier` / `deleteSupplier` read the row through `{ id, shopId }`
  **first** — that read is also the tenant check, and it supplies `isSystem`.
- **`isSystem = true`** ("Walk-in seller") cannot be renamed or deactivated →
  **403** `systemRowProtected()`. Other fields *are* editable.
- **Names are NOT unique** (`@@index`, not `@@unique`) — deliberately no
  duplicate-name check. Adding one would promise something PostgreSQL doesn't enforce.
- `isSystem` is absent from both DTOs → sending it is a 400.
- `search` tries the canonical phone form too, so `0300-1234567` and
  `923001234567` both match. Normalising storage without this would make search worse.
- **WF11 ledger** (`GET /:id/ledger`): two reads (purchases with
  `isOpeningStock: false`, plus supplier_payments) merged oldest-first, running
  balance folded over the whole timeline before paging. `balance` must always
  equal `GET /supplier-payments/payable/{id}.payable` — exclude opening-stock
  purchases in the `where`, not after the sum.

### Customers (`src/customers/`)
- `openingBalance` is WF1 day-0 data, settable at create **and** PATCH. Payments
  never write to it — Udhar is always calculated.
- `null` clears `phone`/`address`/`notes`; `null` on `name` is a **400**
  (`requiredFieldCannotBeNull()`).
- Phones normalised with `normalizePhoneOrRaw()`; `search` tries both forms.
- Names and phones are **not** unique.
- **WF11 ledger** (`GET /:id/ledger`): sales + payments merged oldest-first with
  a running balance; cancelled rows stay in the timeline at `delta: 0` and never
  move the balance. WF15 adds RETURN rows (`delta = −returnAmount`) and REFUND
  rows (`delta = +amount`) to the same timeline. `balance` equals the WF10
  outstanding. A payment's
  `reference` is the `saleNo` it paid, `null` = opening balance.

### Expense categories (`src/expense-categories/`)
- **Names ARE unique** (`@@unique(shopId, name)`) — the opposite of suppliers
  and customers, because the schema enforces it. Second `Rent` → 400 `duplicateName()`.
- 8 defaults copied per shop at onboarding from `DEFAULT_EXPENSE_CATEGORIES`
  in `src/platform-admin/constants/default-lists.constant.ts`.
- Response carries `createdAt`/`updatedAt`; `sortBy ∈ name|createdAt|updatedAt`.

### Expenses (`src/expenses/`, WF13)
- **Soft overdraft, same dance as WF6/WF7**: shop row locked `FOR UPDATE`
  *before* the `currentCash()` aggregate (TOCTOU — two concurrent expenses
  must not pass the prompt on the same stale balance), prompt is a **200**
  `PurchaseOverdraftResponseDto` with **nothing written**, retry with
  `confirmOverdraft: true` → 201, cash row `isOverdraft: true`. The DTO takes
  an optional `subject` (expenses pass `'expense'` → "This expense would
  take…"); purchases/supplier-payments keep the default `'payment'`.
- The category tenant-check runs **before** the tx (`{ id, shopId }` only —
  no `isActive` check, matching how products validate `categoryId`).
- Blank `description` → `null`, same as suppliers/customers/notes.
- **Cancel**: pre-tx 404/400 checks, then one tx (shop lock → **expense-row
  lock re-check** (`SELECT status … FOR UPDATE`; a racing double-cancel that
  slipped past the pre-check loses here with 400, same pattern as §6's WF12)
  → `expense.update` with `{ id, shopId }` → find original EXPENSE cash
  movement → REVERSAL IN).
  If the original movement is missing the tx throws 404 and rolls back —
  `cash_movements_reversal_chk` would otherwise reject a null
  `reversesMovementId` with a cryptic 500. `cancelReason` (not `reason`) is
  the DTO field, matching the Prisma column; required, 1–1000 after trim.
- Cash row: `type EXPENSE`, `direction OUT` (DB-enforced), `referenceType
  EXPENSE` + expense id, `movementDate` = the expense's business date.
  REVERSAL rows carry `note` = the cancel reason.
- List: `sortBy ∈ expenseDate|amount|createdAt`; search matches `description`
  only; `from`/`to` go into `where.AND`.
- No update endpoint — WF13 is create/cancel only, so there is no
  `update-expense.dto.ts` (deliberate, not an omission).
- `exports` removed from the module — nothing calls `ExpensesService` yet;
  WF14's dashboard reads through Prisma directly, so keep the export out
  until a caller actually exists.

### Purchases (`src/purchases/`, WF6)
- **`clientRequestId` is REQUIRED in the DTO** (`@IsUUID`, no default). The Prisma
  column has `@default(uuid(7))`, so letting the DTO default it would silently
  mint a new id per retry and defeat idempotency.
- Idempotency check runs **before** anything else, including validation — a
  replay answers `"Purchase already saved"` even if master data changed since.
  A racing P2002 on `(shopId, clientRequestId)` is caught and mapped to the
  same success message (rule 6: never throw on a duplicate).
- **`totalAmount` is never read from the client.** `Σ quantity × unitCost`,
  computed as `BigInt`. `paidNow` is rejected if it exceeds that total, and an
  `isOpeningStock` purchase rejects any `paidNow` at all.
- Cross-line validation happens **before** the transaction so a bad line never
  consumes a `next_purchase_no`.
- The overdraft prompt is a **200**, not a 201 — Nest's `@Post` defaults to 201,
  so the controller takes `@Res({ passthrough: true })` and calls
  `res.status('confirmOverdraft' in result ? 200 : 201)`. Never "create" 201
  for a response that wrote no row.
- `PurchaseOverdraftResponseDto` (`dto/overdraft-response.dto.ts`) is the exact
  shape WF7 must reuse.
- `StockLevel` weighted average cost is computed by **reading inside the tx**,
  not inside Prisma's `upsert.update`, so two lines of the same purchase chain
  correctly (second line sees the first line's write).
- The very first statement of the tx locks this shop's row
  (`SELECT id FROM shops WHERE id = … FOR UPDATE`) **before** the
  `currentCash()` aggregate. Without it, two concurrent purchases would each
  snapshot the same drawer balance and both pass the soft cash warning
  (TOCTOU). READ COMMITTED re-snapshots per statement, so the loser of the
  lock widens its view to the winner's **committed** cash rows.
- `notes` is stored as `null` when blank — matched to suppliers/customers.
- The paidNow cash row's `movementDate` is `new Date(dto.purchaseDate)` — the
  ledger moves on the bill's **business day**, not wall-clock now (same
  convention as WF7's `movementDate = paymentDate`).
- List rows denormalise `supplierName` and each line's `imeis` in one query.
- `sortBy ∈ purchaseDate|purchaseNo|totalAmount|createdAt|updatedAt`; `from`/`to`
  go into `where.AND` so they cannot clobber the `OR` search.

### Supplier payments (`src/supplier-payments/`, WF7)
- The read endpoint `GET /supplier-payments/payable/{supplierId}` drives WF7
  steps 1–2: it returns the derived payable plus every unpaid bill oldest-first
  — **opening-stock purchases are excluded** from "active real purchases"
  because they create no payable, and opening-balance payments show up as
  `purchaseId: null`.
- Two row locks, in a fixed order. First the **shop row** `SELECT ... FOR UPDATE`
  (the `currentCash()` read is a committed-snapshot aggregate, so without this
  lock two payments to *different* suppliers would both pass the soft cash
  warning on the same balance). Then the **supplier row** — the remaining-
  outstanding check is re-run **under the supplier lock**, and the
  pre-transaction supplier read is only the 404 tenant check. There is no
  `clientRequestId` column (ERD grants one to sales/purchases/payments only),
  so the supplier lock is the double-tap guard too.
- `notes` is stored as `null` when blank — on both the payment and its cash row.
- Payment validation order inside the tx: bill belongs to this supplier →
  not CANCELLED → not opening stock → amount ≤ remaining → cash ≥ 0.
  Each violation is a distinct factory (`purchaseSupplierMismatch`,
  `cancelledRowMutationForbidden`, `purchaseHasNoPayable`,
  `paymentExceedsOutstanding`) so the message says exactly what to fix.
- The cash row uses `referenceType: SUPPLIER_PAYMENT` + the payment id (it is
  its own business document). WF6's cash rows still use `PURCHASE` + purchase
  id because they were created by the purchase — both satisfy
  `cash_movements_ref_chk` (ref pair both-present-or-both-null), and
  `SUPPLIER_PAYMENT` must be `direction OUT`.
- `movementDate` on the cash row is `new Date(dto.paymentDate)` — the drawer
  ledger moves on the business day the money actually left, so a back-dated
  payment shows on that day.
- Overdraft prompt and the 200/201 split reuse `PurchaseOverdraftResponseDto`
  and the `@Res({ passthrough: true })` status trick from `purchases`.

### Inventory (`src/inventory/`, WF8)
- **Accessories and phones are different problems on the same endpoint.**
  `ADJUSTMENT` is accessories-only (`adjustmentNotAllowedForSerialized` on a
  phone) and takes `countedQuantity` (absolute, `0` legal); `DAMAGED`/`LOST`
  on accessories takes `quantity`, on phones takes `inventoryUnitId`. Any
  field the product kind does not use is a **400** (`unwantedAdjustmentField`),
  never a silent ignore — a wrong shape must not half-write.
- Two different concurrency guards: accessory ADJUSTMENT locks the stock row
  `SELECT ... FOR UPDATE` then computes `delta = counted − current` so two
  concurrent counts serialize; accessory DAMAGED/LOST does a **conditional**
  `UPDATE ... WHERE quantity_on_hand >= qty` and lets PostgreSQL reject the
  second writer; phone write-offs lock the unit row `FOR UPDATE` before
  re-checking `IN_STOCK`. Each guard is the double-tap protection for its path
  (no `clientRequestId` here — the ERD grants replay keys to sales, purchases
  and payments only).
- `delta === 0` on ADJUSTMENT returns **200** with **no row written** —
  `inventory_movements_qty_chk CHECK (quantity_change <> 0)` makes a zero-row
  impossible, so "nothing changed" is represented by no movement at all, and
  the controller maps `kind: 'nochange'` → 200 (201 only when a row was
  written, same `@Res({ passthrough: true })` trick).
- Every WF8 movement carries `referenceType`/`referenceId` = **null**: the
  adjustment is its own business document, unlike purchase/sale movements that
  point back to their parent. Both patterns satisfy `inventory_movements_ref_chk`.
- `reason` is mandatory (DTO `@Length(1,1000)` after trim) and stored on the
  movement — the ledger stays a truthful "why".
- The list endpoint defaults every request to
  `type IN (ADJUSTMENT, DAMAGED, LOST)` so purchase/sale movements never leak
  into this screen; an explicit `type` overrides. `inventoryUnitId`/`imei`/`productName` are
  pulled in one query; `sortBy ∈ createdAt|quantityChange`; `search` matches
  product name + reason; `from`/`to` go into `where.AND` (never clobbering the
  search `OR`).

### Sales (`src/sales/`, WF9)
- **Two-phase transaction** — counter, then every line is locked `FOR UPDATE`
  and re-checked *before* `sale.create`; a rejected line leaves no sale row
  (the whole tx rolls back anyway, but validation-first keeps error mapping
  clean and matches WF9's stated order).
- **No overdraft prompt, no `confirmOverdraft` field, no `@Res` trick** — a
  sale only adds cash, so `POST /sales` is always a plain **201**. WF6/WF7's
  overdraft dance does not apply here.
- **`customerId` is required when the sale has a phone line or any
  outstanding** (`customerRequiredForSale`). Walk-in cash sales must be paid
  in full. `customerId` is optional only for a fully-paid quantity sale.
- Wrong-shape lines are rejected **before** the tx: phone line with
  `quantity ≠ 1`, quantity line carrying `inventoryUnitId`,
  `inventoryUnitId` on a QUANTITY product, duplicate IMEI in one request
  (`unwantedSaleItemField`, `inventoryUnitIdRequiredForSale`,
  `duplicateFieldValue`).
- Totals are server-owned: `subtotal = Σ qty × unitPrice`,
  `discount ≤ subtotal`, `paidNow ≤ totalAmount` — client `totalAmount` (if
  sent at all) is ignored.
- `unitCost` is snapshotted **under the lock** (unit's `unit_cost` /
  stock's `avg_unit_cost`) into `sale_items` — profit never changes when
  costs move later.
- Cash row: `type CUSTOMER_PAYMENT`, `direction IN` (a sale can only put
  cash in), `referenceType PAYMENT` + payment id, `movementDate` = the sale's
  business date (WF7 convention, not WF6's `new Date()`).
- `clientRequestId` replay: pre-check answers `"Sale already saved"` before
  any validation; the racing P2002 inside the tx is caught with
  `isUniqueConstraintViolation` + `violatedColumn(error, 'client_request_id')`.
- Lock order is **shop row (counter) → unit/stock rows**, identical to
  WF6/WF7, so sales and purchases can't deadlock with each other.
- List: `status`/`customerId` filters, `from`/`to` in `where.AND` (never
  clobbering the search `OR`), `sortBy ∈ saleNo|saleDate|totalAmount|createdAt|updatedAt`;
  `search` matches `saleNo` + customer name. Rows carry `items[]` (with
  `productName`/`imei`) and `payments[]`.
- **WF15 effects**: a sale with any ACTIVE return **cannot be cancelled** —
  `saleHasReturns` fires pre-tx and again under the tx lock in
  `cancelSale`, and `getCancelImpact` sets `blocked` with that reason;
  `GET /sales/{id}` maps `returns[]` (`SALE_INCLUDE.saleReturns`, response
  DTO field `returns: ResponseReturnDto[]`); the cancel-impact customer
  balance uses the full WF15 formula (+returns −refunds).

### Payments (`src/payments/`, WF10)
- **No overdraft prompt, no `confirmOverdraft`, no `@Res` trick** — a payment
  only adds cash, so `POST /payments` is always a plain **201** (same
  deliberate difference as WF9; see §6b).
- `customerId` is required; tenant 404 `{ id, shopId }`. Optional explicit
  `salesIds`: every entry must be **that customer's ACTIVE sale in this shop**
  (else 404 — treat "not in this customer's profile" the same as not found),
  duplicates → 400 `duplicateFieldValue`. Explicit `salesIds` **exclude the
  opening balance** — the owner named sales, the money goes there.
- Outstanding is derived under the lock, never stored: `openingBalance −
  Σ ACTIVE payments with saleId null` + per-sale `totalAmount − Σ ACTIVE
  returns + Σ ACTIVE refunds − Σ ACTIVE payments on it` (WF15 added the
  return/refund terms — a partly-refunded sale is still owed less, never
  more). `amount ≥ 1` and `≤ total` else
  `400 paymentExceedsOutstanding(name, amount, remaining)`.
- Allocation is server-computed, **oldest-first**: opening balance first (the
  PDF's "oldest"), then sales by `(saleDate, id)`; zero portions are skipped
  (DB CHECK `amount > 0`).
- One `payments` row per portion, all sharing one `receiptGroupId` +
  the request's `clientRequestId`. `receiptGroupId` has **no DB default** —
  app generates it once per request with `randomUUID()` from `node:crypto`.
  The opening-balance row has `saleId = null` (the expression index's
  zero-uuid bucket). One `cash_movements` row per payment:
  `CUSTOMER_PAYMENT`, `IN`, `referenceType PAYMENT` + payment id,
  `movementDate = paymentDate` (business day, WF7 convention).
- **Lock order: shop row → customer row → candidate sale rows sorted by
  `(saleDate, id)`.** The customer row is the serialiser for
  opening-balance-only payments, which touch no sale rows — without it two
  concurrent payments against the opening balance both pass the
  ≤-outstanding check (the WF7 supplier-lock trick). Sorted sale locks stop
  two overlapping payments from deadlocking.
- **Replay checked twice**: pre-check before validation →
  `"Payment already saved"`; the same check again **inside the tx after the
  locks** — the expression index `payments_idempotency_uq` cannot catch a
  racing duplicate (same `clientRequestId`, different `sale_id` → no
   collision), and `violatedColumn(error, 'client_request_id')` fails here
   because the index name carries no column token. Belt-and-braces: the outer
   catch maps a P2002 to the same message **only** when the collided index is
   undetermined or is `payments_idempotency_uq` / `client_request_id` — a
   *named* other index rethrows as 500 (it would be a different bug).
- List: `customerId`/`saleId`/`receiptGroupId`/`status` filters, `from`/`to`
  in `where.AND`, `sortBy ∈ paymentDate|amount|createdAt|updatedAt`, `search`
  on customer name + notes; **no default status filter** (cancelled rows stay
  visible). Rows carry `customerName` + `saleNo`. `GET /payments/{id}` → 404
  cross-shop.
- `method` is optional in the DTO but only `'CASH'` may be sent
  (`PaymentMethod` grows later); omitting it takes the column default.
- Cancel lives on `POST /payments/{id}/cancel` (WF12, §6), not here. No update
  endpoint (WF10 is create/list/get only).

### Returns (`src/returns/`, WF15)
- **Four endpoints, two controllers**: `SaleReturnsController`
  (`@Controller('sales')` — `POST /sales/:id/returns/preview` +
  `POST /sales/:id/returns`) and `ReturnsController`
  (`@Controller('returns')` — `GET /returns`, `GET /returns/:id`), both OWNER
  `AuthGuard`, both registered by `ReturnsModule`. The preview runs
  `@HttpCode(200)` — it writes nothing, so it must never answer 201 (the
  save takes the standard 201, or **200** via the `@Res({ passthrough: true })`
  status trick when the overdraft prompt fires).
- **DTO shape**: `items[] = { saleItemId, quantity?, condition }`. Phone lines
  (the sale_item carries `inventoryUnitId`) force `quantity` omitted or 1
  (`unwantedReturnItemField`); quantity lines require `quantity`
  (`returnQuantityRequired`). No `inventoryUnitId` in the request — the unit
  is resolved from the sale line, so a client can never name a unit it does
  not own. `condition: GOOD | DAMAGED`. `refundAmount` optional (paisa,
  default 0), `returnDate` is the business day driving return/refund/cash
  `movementDate` (stored as `new Date('YYYY-MM-DD')`, the usual convention).
- **One validation + settlement path, `prepare(db, saleId, shopId, items)`**,
  called three times: pre-tx (fast fail before any lock), in the preview
  (read-only, no locks), and inside the tx after the sale row lock (the
  authoritative pass — a racing return or cancel loses there). It 404s the
  sale `{ id, shopId }`, 400s a CANCELLED sale
  (`cancelledRowMutationForbidden`), validates every line, then settles money
  from ACTIVE rows only.
- **Line rules**: accessory quantity `≤ sold − already returned` across the
  whole request (two entries on the same line add up) else
  `returnQuantityExceedsRemaining`; a phone line may be returned once
  (`unitAlreadyReturned`) and its unit must still be `SOLD`
  (`unitNotSoldForReturn`); unknown `saleItemId` → 404; duplicate phone line
  in one request → 400 `duplicateFieldValue`.
- **Money, BigInt throughout**: `gross = Σ unitPrice × qty`;
  `discountShare = subtotal > 0 ? (discount × gross) / subtotal : 0` (floors —
  a full return makes the division exact); `returnAmount = gross − share`;
  `outstandingBefore = totalAmount − priorReturns − activePayments + refunds`;
  `refundable = min(returnAmount − outstandingBefore, paid − refunded)`
  (clamped ≥ 0). `refundAmount > refundable` → 400 `refundExceedsAvailable`
  before the tx. The client never sends `returnAmount`.
- **Tx order**: shop row `FOR UPDATE` → sale row `FOR UPDATE` (re-check
  ACTIVE — same double-cancel guard as WF12) → `prepare(tx)` → overdraft
  check → `saleReturn` → `returnItem`s → per line `restoreLine` (+`writeOffLine`
  when DAMAGED) → `refund` + `cash_movements` if refund > 0. Soft overdraft:
  refund cash only ever leaves the drawer, so `refundAmount > 0` with
  `currentCash − refund < 0` returns **200** `PurchaseOverdraftResponseDto`
  (subject `'refund'`) with **nothing written**, retried with
  `confirmOverdraft: true` → 201 with the cash row `isOverdraft: true`.
- **Stock**: phones `SOLD → IN_STOCK` with a `+1 CUSTOMER_RETURN` movement;
  accessories `stock_levels.quantityOnHand += qty` with a `+qty`
  `CUSTOMER_RETURN` movement. A DAMAGED line is a **pair** — restore first
  (`+n CUSTOMER_RETURN`), then write off (`unit → DAMAGED` / conditional
  stock decrement with a `DAMAGED −n` movement) — so `Σ movements` still
  equals the sellable count and the net stock change is zero. Unit/stock rows
  are locked `FOR UPDATE` and re-checked inside `restoreLine`/`writeOffLine`.
  Both movement kinds carry `referenceType RETURN` + the return id (satisfies
  `inventory_movements_ref_chk`).
- **Refund cash row**: `type REFUND`, `direction OUT`, `referenceType REFUND`
  + refund id, `movementDate` = `returnDate`, `isOverdraft` when flagged —
  exactly the R1.1 `REFUND` movement type from the enum table.
- **`GET /returns`**: `saleId`/`customerId` filters, `from`/`to` as PKT
  business days on `returnDate` (`businessDayRange().start/.end`, gte/lt —
  never `new Date(from)`), `search` matches `saleNo` + customer name + reason
  in `where.OR`, `sortBy ∈ returnDate|returnAmount|createdAt`, `pageSize` max
  100, no default status filter. Rows carry `saleNo`, `customerName`,
  `items[]` (with `imei`), `refunds[]`. `GET /returns/:id` → 404 cross-shop.
- **Downstream rules that depend on returns**: a sale with any ACTIVE return
  cannot be cancelled (`saleHasReturns`, pre-tx AND under the tx lock in
  `sales.service.ts`, and `getCancelImpact` reports it as `blocked`);
  `GET /sales/:id` maps `returns[]` (`SALE_INCLUDE.saleReturns`); WF10
  outstanding subtracts returns and adds refunds; the WF11 customer ledger
  folds RETURN rows (`delta = −amount`) and REFUND rows (`delta = +amount`);
  WF14's `customerUdhar` subtracts shop returns and adds shop refunds.
  All five were edited together — touching one formula without the others
  desyncs the money.

### Dashboard (`src/dashboard/`, WF14)
- **One endpoint, `GET /dashboard`, read-only.** All twelve queries run in a
  single `Promise.all` — no transaction, nothing is written, and a number may
  straddle another request's commit by milliseconds (acceptable for a summary
  screen).
- **"Today" is the Asia/Karachi business day**, via `businessToday()` /
  `businessDayRange()` in `src/helpers/date.helper.ts`. `timestamptz` filters
  (`saleDate`) take the PKT day's UTC instants `[00:00, 24:00)`; `date`
  columns (`expenseDate`) compare against the plain `YYYY-MM-DD` at UTC
  midnight. Never use the server's UTC calendar day.
- Prisma cannot multiply columns (`unitCost × quantity`) or compare two
  columns (`quantityOnHand ≤ lowStockThreshold`) — both are fetched as rows
  and folded in JS.
- Shop-wide Udhar/payable sums work because walk-in cash sales always carry
  an ACTIVE payment row with `customerId: null` for the same amount — the
  two sides cancel. Don't "fix" this by filtering payments to
  `customerId != null`.
- `period` accepts only `today` (`@IsIn`); week/month/custom are R1.1 and
  must **400**, not silently answer today's numbers.
- `links.cashPosition` drills into `GET /cash/movements` (the `cash/` module).

### Cash (`src/cash/`, WF1 opening cash + movements list + WF16)
- **`POST /cash/opening`** writes one `cash_movements` row `OPENING_CASH` /
  `IN` with **both reference columns null** (the adjustment is its own
  business document — satisfies `cash_movements_ref_chk` the way WF8
  movements do; `cash_movements_direction_chk` forces IN for OPENING_CASH).
- **Once per shop, checked under the shop row lock**: the tx's first
  statement is `SELECT id FROM shops … FOR UPDATE`, then a
  `findFirst({ type: OPENING_CASH })` → 400 `openingCashAlreadySet()`
  (`src/errors/error.builder.ts`). The lock makes a concurrent double-tap
  lose instead of writing two opening rows — this check *is* the
  double-tap guard (no `clientRequestId` column exists on cash_movements).
- `date` defaults to `businessToday()` (Asia/Karachi), stored like other
  business dates: `new Date('YYYY-MM-DD')` = UTC midnight. No overdraft
  prompt — opening cash only ever adds money.
- **WF16 — owner investment/withdrawal.** `POST /cash/investments` writes a
  single `OWNER_INVESTMENT` / `IN` row as a plain insert — cash only rises,
  so there is no balance read to serialise (always **201**). `POST
  /cash/withdrawals` writes `OWNER_WITHDRAWAL` / `OUT` inside one tx: shop
  row locked `FOR UPDATE` first (TOCTOU guard for the `currentCash()`
  aggregate), then the soft-overdraft dance — prompt is a **200**
  `PurchaseOverdraftResponseDto` (subject `'withdrawal'`) with **nothing
  written**, retry with `confirmOverdraft: true` → **201** with
  `isOverdraft: true`. The DB `cash_movements_direction_chk` already pins
  each type to its direction; reference columns are null (the movement is
  its own record). **Never counted as revenue or expense** — the dashboard
  profit formula reads sale items and expenses only, while `cashPosition`
  (IN − OUT) picks both types up automatically. Both DTOs take
  `amount` / optional `date` (business day, default `businessToday()`) /
  optional `notes` (blank → `null`); the withdrawal DTO adds
  `confirmOverdraft?`.
- **`GET /cash/movements`** is the plain ledger list behind the dashboard's
  `cashPosition` link: `type`/`direction` filters, `search` on `note`,
  `sortBy ∈ movementDate|amount|createdAt`, no default filters (every row
  is visible). `from`/`to` are PKT business days on the `timestamptz`
  column → `businessDayRange().start` / `.end` (`gte` / `lt`), never
  `new Date(from)` — that would cut the day at UTC midnight.
- Amounts always come back positive; direction carries the sign.
- Opening cash is **not editable or cancellable** through this module —
  the ledger is append-only and corrections arrive as REVERSAL rows
  (WF12) or, for day-one mistakes, via support. Do not add a PATCH.

### Cash Reconciliations (`src/cash-reconciliations/`, WF17)
- **Three endpoints**, OWNER `AuthGuard`: `POST /cash-reconciliations`,
  `GET /cash-reconciliations`, `GET /cash-reconciliations/:id`.
- **Create = one tx**: shop row `FOR UPDATE` first (TOCTOU guard — two
  concurrent counts must not both snapshot the same `currentCash()` before the
  first adjustment commits, the WF6/WF7/expense trick), 404 when the shop row
  is missing, then `systemCash = currentCash(tx)` = `SUM(IN) − SUM(OUT)` over
  the append-only ledger, `difference = countedCash − systemCash` (BigInt).
- **Reason required whenever `difference ≠ 0`** — `cashReconciliationReasonRequired`
  (`400`), and `cash_recon_reason_chk` backstops it; a trim of the DTO reason
  turns whitespace into the same 400. A matching count needs no reason and
  *still* stores a row (a permanent record of the count).
- **One `cash_reconciliations` row, always**; a movement **only when
  `difference ≠ 0`** — `cash_movements_amount_chk` forbids amount 0 and cash is
  already reconciled at zero. The movement is `RECONCILIATION_ADJUSTMENT`,
  `direction IN` when the drawer has more than the system says / `OUT` when it
  has less (direction not DB-pinned for this type), `amount = |difference|`,
  `referenceType RECONCILIATION` + reconciliation id, `movementDate` = the
  Pakistan business day (`new Date(businessToday())`, the WF1 convention).
  Old cash rows are never edited — the adjustment is a new ledger row, so
  `systemCash` lands exactly on `countedCash`.
- The DTO has **no `date` field** — a reconciliation is a now-event stamped
  `reconciledAt`; only `countedCash` (int, ≥ 0, zero legal — an empty drawer is
  a real count) and optional `reason` (trim, ≤ 1000). The client never sends
  `systemCash`/`difference`.
- **List**: `search` matches `reason` only, `from`/`to` are Asia/Karachi
  business days on the `timestamptz` `reconciledAt` via `businessDayRange().start/.end`
  (`gte`/`lt`, never `new Date(from)`), `sortBy ∈ reconciledAt|systemCash|countedCash|difference`,
  default `reconciledAt desc`. `GET /:id` → 404 cross-shop. Response rows carry
  all three paisa numbers plus `reason`, `reconciledAt`, `createdById`.
- `currentCash()` is a private module method (same `Tx` alias + aggregate pair
  as `cash/`). No `clientRequestId` — `cash_movements` has no replay column,
  the shop-row lock serialises racing counts.

### Store (`src/store/`, R1.2 Online Store)
- **Three controllers in one module**: `store/` (OWNER `AuthGuard` — settings,
  publish/unpublish), `products/`-prefixed `product-images` (OWNER `AuthGuard`
  — the photo routes, pathed per the Online Store API table) and
  `storefront/` (**NO auth** — the
  public catalog customers scan, mounted at `public/stores` + throttled).
  The storefront controller carries no
  `@UseGuards`/`@ApiBearerAuth` at all; the settings storefront never takes a
  shop id — everything resolves by `slug`.
- **`PATCH /store/settings` is an upsert.** A shop that never configured a
  store (new shops miss the DB backfill) gets a row created on the first
  PATCH: `slug` derived from the shop name exactly like the backfill
  (`shopDisplayName` → slugify → `shop-<id6>` fallback, `-shop` for reserved,
  then `slug-2`, `slug-3`… until `nextFreeSlug()` finds it unclaimed), and
  `displayName` defaults to the shop name. Because the upsert runs outside a
  `$transaction` (single-row create/update — no other table is touched), a
  racing P2002 on `slug` is mapped to `duplicateFieldValue` via
  `violatedColumn(error, 'slug')`; a derived-slug collision is avoided by the
  pre-check in `nextFreeSlug()`.
- **The owner has no `slug` field at all.** Renaming the store address is a
  platform-admin-only action (WF19 step 2): `PATCH /platform-admin/shops/
  {id}/store-slug` → `ChangeStoreSlugDto` (trim + lowercase, `/^[a-z0-9]+(-[a-z0-9]+)*$/`,
  `Length(3,40)`) → `StoreService.changeStoreSlug()`, which does the reserved
  check, the shop 404, the settings 404, the no-op same-slug short-circuit,
  the P2002 → `duplicateFieldValue` mapping, and `cache.clear()` (the old
  address must stop resolving immediately). Keeping it in StoreService means
  the admin controller and the owner surface can never drift apart.
- **`null` handling (gotcha #9).** `@IsOptional()` lets `null` past, so the
  service hard-400s `null` on the non-nullable `displayName`
  (`requiredFieldCannotBeNull`) before building the update. Nullable text
  fields are stored as `null` when blank (`|| null`), matching suppliers/
  customers.
- **Reserved slugs** live in `RESERVED_SLUGS` in
  `src/store/helpers/store-slug.helper.ts`, mirroring `store_slug_reserved_chk`
  — the friendly 400 (`slugReserved`) fires before the DB constraint would.
  The helper also owns the whole derivation (`storeSlugBase` — slugify,
  truncate to 34, fallback, reserved) so **onboarding** and the first
  `PATCH` can never produce two different addresses for one shop name. DTO
  slug/URL regexes mirror the DB CHECKs so a bad value is a 400, not a raw
  constraint error.
- **Enable warning (WF19 step 6).** Turning `isEnabled: true` when no
  WhatsApp number or no published product exists appends
  `. Warning: no WhatsApp number is set; no product is published yet.` to the
  success `message` — mutations only return `{ status, message }`, so the
  warning rides there. Checked from the DTO when sent, else from the stored
  row; the product count is a real `isPublished + publishedAt not null` query.
- **Cache rules.** `StoreCacheService` caches only the settings ROW for ~60s
  (positive entries only — a miss always hits the DB); `shops.status` is read
  **fresh on every request** so a suspension hides the store immediately.
  Every settings write (owner PATCH) and every admin slug change calls
  `cache.clear()`.
- **Owner preview** (`GET /store/preview*`) reuses the public builders keyed
  by `shopId` (JWT) and deliberately skips the `isEnabled`/status checks —
  it is the WF19 step 4 "see it while it is still OFF" view. Missing
  settings row → 404 `resourceNotFound('Store settings')`, NOT
  `storeNotAvailable()` (the owner must see a different error than a
  customer).
- **Publish/unpublish write only `isPublished`** — the DB trigger
  `products_set_published_at` maintains `publishedAt`. Publish 400s with
  `productNotPublishable` when `isActive = false`; unpublish has no such
  check. Both tenant-404 via `{ id, shopId }` first. The same rules apply to
  `PATCH /products/:id` (publish fields; deactivate+publish in one body is
  400) and `PATCH /products/publish` (bulk — foreign id → 404, nothing
  silently skipped, one `updateMany` transaction).
- **Product images**: cap of **5 enforced in the service** (`imageLimitExceeded`,
  the DB has no count cap); `sortOrder = max + 1` on add; reorder inside one
  `$transaction` writes `sortOrder = index` per image but **validates set
  equality first** (`reorderImageMismatch` when any id is missing/extra/
  duplicated) — no partial sets. Unguarded `product.image.delete` is safe
  because the pre-read scoped `{ id, productId, shopId }` is the tenant check
  (`product_images` has no no-delete trigger, so the delete is a real one).
  Image `url` must be **https**: DTO `@Matches(/^https:\/\//i)` **and** the
  `product_images_url_chk` DB CHECK (migration
  `20261008140000_product_images_https_only` rewrote legacy `http://` rows
  before tightening — never relax-then-tighten without that rewrite step).
- **Public product shape is an allowlist** (`ResponseStoreProductDto`):
  `id, name, brand, category, price (paisa | null), contactForPrice,
  availability, stockCount, ptaStatus, images[], description, specs`. There
  is deliberately **no `condition` field** (the schema has no
  `Product.condition`), no `trackingType`, no cost, no SKU/barcode/IMEI, no
  `shopId`. `description` is `publicDescription`, never the owner's private
  `description` — a spec asserts which one leaks.
- **Storefront stock bucket** is computed in JS from the real number:
  `quantityOnHand = stockLevel.quantityOnHand` (QUANTITY) or
  `_count.inventoryUnits where status = 'IN_STOCK'` (SERIALIZED) →
  `availability`: 0 = `OUT_OF_STOCK`, `≤ lowStockThreshold` = `LOW_STOCK`,
  else `IN_STOCK`. `stockCount` is **null unless `showExactStock`** (the key
  stays present, unlike the earlier omitted-key shape); `price` is `null`
  when `contactForPrice`. Image URLs are sorted by `sortOrder` in JS
  (defensive, though the include already orders) so index 0 is always the
  cover.
- `GET /store/settings` 404s for shops that never configured a store — the
  frontend treats that as "not set up yet" and shows the create form (the
  first PATCH is the create, though onboarding now creates the row, so the
  404 should only ever fire for pre-R1.2 shops that missed the backfill).
  Owners publish only ACTIVE products, matching `productNotPublishable`.

### Reports (`src/reports/`, WF18)
- **Eight read-only endpoints, one controller**: `GET /reports/sales`,
  `purchases`, `expenses`, `profit`, `customers`, `suppliers`, `inventory`,
  `best-sellers`, OWNER `AuthGuard`. Every query scoped to `shopId`, and
  CANCELLED rows are excluded everywhere (same "history is added, never
  counted twice" rule as the rest of the product). No transactions — pure
  reads like the dashboard.
- **Page shape** is `ReportPageResponseDTO<T, S>` =
  `{ page, pageSize, total, from, to, summary, items }` — the normal
  `PaginatedResponseDTO` plus the applied range and the report's whole-period
  summary (never just the page). The row + summary DTOs (and the CSV column
  maps) live one file per report in `src/reports/dto/`; the controller's class
  `@ApiExtraModels(...)` registers them all in the openapi because Swagger
  will not resolve generic args of `ReportPageResponseDTO` on its own (same
  reason `ResponseCashMovementDto` is missing while `ResponseBrandDto` is
  there — the former is only ever a generic arg).
- **Period resolution** (`src/helpers/date.helper.ts` `periodRange`):
  `today` | `week` (Monday start) | `month` | `custom`. Passing `from`/`to`
  at all overrides `period`; a missing side defaults to the other (a
  single-day range). `range.start/end` are UTC instants for `timestamptz`
  filters; `from`/`to` echo back as the applied plain dates. `from > to` →
  400 `invalidReportRange`; `> 366` days → 400 `reportPeriodTooLong`.
  `date` columns use `dateColumnRange` (`[from, to+1d)` at UTC midnight,
  never `new Date(from)`).
- **Reports never mix revenue, money received, Udhar and cash (WF18 rule)**:
  sales revenue = ACTIVE sales; payments only appear as paid/cash-in; Udhar
  is derived outstanding; cash lives in the cash module. Refunds are the cash
  side of a return and are **not** subtracted again in profit —
  `net = gross sales − Σ(unitCost × qty) − returns + refunds of the period −
  expenses` stays on the revenue side: returns subtract (goods back),
  refunds only offset the *cash* position.
- **Sales report**: row = `subtotal`, `discount`, `totalAmount`, `paid`,
  `returns`, `refunds`, `outstanding = total − returns + refunds − paid`,
  `profit = subtotal − Σ(unitCost × qty)` on that sale. Summary = `Σ` of the
  same over the whole range (`sumProfit` = Σ subtotals − Σ cogs). Sort
  whitelist `saleDate|saleNo|totalAmount`, default `saleDate desc`; search on
  `saleNo` + customer name.
- **Purchase report**: opening-stock bills show but owe nothing
  (`outstanding: 0`); summary splits `countReal` / `countOpeningStock` and
  `sumOutstanding = Σ real totals − Σ active payments`. Search on
  `purchaseNo` + supplier name + invoice ref; sort `purchaseDate|purchaseNo|
  totalAmount`.
- **Expense report**: row = category + description + amount by business day.
  Summary `byCategory[]` comes from `expense.groupBy categoryId` with names
  resolved in a second `expenseCategory.findMany`, sorted total desc. Search
  on `description` + category name; sort `expenseDate|amount|createdAt`.
- **Profit report**: JS-folded per-day rows across **every** calendar day of
  the range (0 rows are real): `gross = Σ sale.totalAmount`, `cogs =
  Σ unitCost × qty` keyed by the sale's day, `expenses` and `returns` by
  their own days, `profit = gross − cogs − returns − expenses`. Summary =
  `grossSales, cogs, grossProfit, returns, expenses, netProfit, salesCount`.
  Oldest-first (a chart series, not a searchable list).
- **Snapshot reports (customers, suppliers, inventory) ignore the period on
  purpose** — outstanding, payable and stock are cumulative facts. Their
  `from`/`to` echo `businessToday()` ("as of today"). All three fold rows in
  JS and page client-side (`pageSnapshot`).
- **Customer report**: `outstanding = opening + bought − paid − returns +
  refunds` over ACTIVE sales/payments/returns, `overdue` = Σ over ACTIVE
  sales whose `dueDate < today` of `(total − paid − returns)` (dueDate parsed
  as a UTC-midnight date and compared to `new Date(businessToday())`).
  Sort `name|outstanding|lastSaleDate` default outstanding desc; search on
  name + phone.
- **Supplier report**: `payable = opening + bought − paid` — the purchases
  include filters `isOpeningStock: false` in the **where** (as in WF11, never
  filtered after the sum). Sort `name|payable|lastPurchaseDate` default
  payable desc; search on name + phone.
- **Inventory report**: serialized → `inStock = # IN_STOCK units`,
  `stockValue = Σ unitCost`, `imeis[]`; QUANTITY → `quantityOnHand`,
  `stockValue = qty × avgUnitCost`. `lowStock = inStock ≤ lowStockThreshold`.
  Sort `name|inStock|stockValue` default name asc.
- **Best-sellers**: `saleItem.groupBy productId` (`_sum quantity + total`)
  over the range's ACTIVE sales, names/category/brand resolved in one find,
  sorted quantity desc in JS, then paged. Summary = products count, total
  quantity and total revenue.
- **CSV export** (`format=csv`) is handled in the controller: it builds the
  page first, then returns a `text/csv` download (`Content-Disposition:
  attachment`) with the report's summary block + a blank line + the row CSV —
  rupees via `formatRupees`, no escaped commas problem (RFC 4180 + UTF-8 BOM
  via `toCsv` in `src/helpers/csv.helper.ts`). `format=pdf` passes the DTO's
  `@IsIn(['csv','pdf'])` but the controller rejects it with 400
  `pdfExportNotAvailable()` — PDF is a later ticket using the same plumbing,
  do not wire it without a ticket. Dispatch is shared by every handler via
  `exportOrJson(res, query, report, name, columns, summaryCsv, message)`.

---

## 14. Standard module structure

```
src/<module>/
├── <module>.module.ts
├── controllers/
│   ├── <module>.controller.ts
│   └── <module>.controller.spec.ts
├── services/
│   ├── <module>.service.ts
│   └── <module>.service.spec.ts
└── dto/
    ├── create-<module>.dto.ts
    ├── update-<module>.dto.ts
    ├── response-<module>.dto.ts
    └── <module>-query.filter.ts
```

**Naming:** plural folder (`src/suppliers/`), and inside it plural file names for
the module/controller/service files (`suppliers.module.ts`,
`controllers/suppliers.controller.ts`, `services/suppliers.service.ts`) but
**singular** DTO file names (`dto/create-supplier.dto.ts`). Never invent a
sub-module layout.

**Reference implementation: [`src/brands/`](file:///home/usman/saas/dukan-pro-backend/src/brands).**
Every new module = duplicate `brands/` → rename `brand` → adjust DTO fields to
the target model → register in `app.module.ts`.

### Module file
```ts
@Module({
  imports: [PrismaModule],
  controllers: [BrandsController],
  providers: [BrandsService, AppConfigurationService],
  // exports: [BrandsService]  ← ONLY if another service actually calls it
})
export class BrandsModule {}
```
No circular dependencies, no `global()`. Import another feature module only
when you call its service (e.g. `AuthModule` inside `PlatformAdminModule`).

### Controller
```ts
@ApiTags('brands')
@Controller('brands')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class BrandsController {}
```
Every endpoint carries **6 decorators**: `@ApiSuccessResponseDecorator(
OK_RESPONSE_STATUS(InnerDTO, msg))` + `@ApiResponse` for
`BAD_REQUEST` / `UNAUTHORIZED` / `INTERNAL_SERVER_ERROR` / `NOT_FOUND` — on list
and get too.

| Response inner DTO | Used by |
|---|---|
| `StatusBaseResponseDTO` | create / update / delete |
| `ResponseBrandDto` | get by id |
| `PaginatedResponseDTO<ResponseBrandDto>` | list |

Wrap the body in try/catch calling `logError(file, fn, error, ctx)`, then
`if (error instanceof BadRequestException) throw error;` — this stops
double-wrapping so a 401/403 keeps its real status. **Never** rethrow a
`NotFoundException` you didn't create.

### Service
```ts
async createBrand(dto: CreateBrandDto, shopId: string, userId: string): Promise<StatusBaseResponseDTO>
async getBrands(query: BrandQueryFilterDto, shopId: string): Promise<PaginatedResponseDTO<ResponseBrandDto>>
async getBrandById(id: string, shopId: string): Promise<ResponseBrandDto>
async updateBrand(id: string, dto: UpdateBusinessDto, shopId: string, userId: string): Promise<StatusBaseResponseDTO>
async deleteBrand(id: string, shopId: string, userId: string): Promise<StatusBaseResponseDTO>
```
- Input DTO/id first, `shopId` (+ `userId` on writes) last.
- ❌ `where: { id }` — ✅ `where: { id, shopId }` on **every** Prisma call.
- List: `Promise.all([findMany({ skip: getSkipNumber(page, pageSize), take: pageSize, orderBy }), count({ where })])`
  → `new PaginatedResponseDTO(items, total, page, pageSize)`.
- Not found → `throw new NotFoundException(...)`; cross-shop access must also 404,
  never expose whether the row exists elsewhere.
- Multi-row work → `this.prisma.$transaction(async tx => { … })`, default
  `ReadCommitted`.

### DTOs — 4 per module
- **create** — `@ApiProperty()` on every field + class-validator.
- **update** — same fields, **every one optional and explicitly declared**.
  Never `PartialType`/`OmitType`.
- **response** — matches the Prisma row, `@ApiProperty` only, **no validators**.
- **query filter** — `page`/`pageSize` (`@Type(() => Number)`), `search`,
  `isActive`, `sortBy`, `sortOrder` with `@ApiPropertyOptional`.

### Specs — 2 per module
`controller.spec.ts` + `service.spec.ts`, each at minimum a `should be defined`
test using `Test.createTestingModule`. For money or tenancy logic, write real
behaviour tests too — the current suite is **57 suites / 744 tests**.

---

## 15. Coding rules & helpers

### Style
- Semicolons always; single quotes everywhere; absolute imports ordered
  `@nestjs/*` → third-party → `src/...`
- Explicit `Promise<X>` return types.
- **Minimal comments.** The code should explain itself; comment only non-obvious
  *why*, never *what*.
- No `any` in Prisma types (eslint rule off, but don't abuse it).
- Logger: `private readonly logger = new Logger(XxxService.name);`
  plus `logError(...)` from `logger-helper` **inside catch blocks only**.
  No `console.log`.
- No global exception filter yet — every route has explicit try/catch.
- Soft delete vs cancel: master data → `isActive: false`; money records →
  `RecordStatus.CANCELLED` with reason/time/user.

### Register a new module
1. Copy `src/brands/`, rename `brand` → target (plural folder, plural controller/service names).
2. Point DTO fields at the real Prisma model.
3. Add to `app.module.ts` imports.
4. `npm run build` → `npm run lint` → `npm run test`.

### Constants
| File | Contains |
|---|---|
| `constants/error-response.constant.ts` | `BAD_REQUEST_RESPONSE`, `UNAUTHORIZED_REQUEST_RESPONSE`, `NOT_FOUND_REQUEST_RESPONSE`, `INTERNAL_SERVER_ERROR_RESPONSE`, `OK_RESPONSE_STATUS(T, message)` |
| `constants/error-description.constant.ts` | the human `message[]` sentences |
| `constants/security.constant.ts` | `BCRYPT_ROUNDS` — shared with `prisma/seed-platform-admin.cjs`; changing one copy breaks verification |

### Helpers
| File | Does |
|---|---|
| `paginate-helper.ts` | `paginate()` / `getSkipNumber()` → `PaginatedResponseDTO` |
| `logger-helper.ts` | `logError(file, fn, error, ctx)` / `logInfo(...)` |
| `phone.helper.ts` | `normalizePhone()` → `923XXXXXXXXX` or `null`; `normalizePhoneOrRaw()` keeps unrecognised input as typed |
| `token.helper.ts` | setup-token random value + SHA-256 hash + `timingSafeEqual` |
| `prisma-error-helper.ts` | `isUniqueConstraintViolation()`, **`violatedColumn(error, 'sku')`**, `uniqueViolationColumns()` |

⚠️ **`violatedColumn()`, never `meta.target`.** Prisma 7 with `@prisma/adapter-pg`
does not set `meta.target` on P2002 — the constraint name only survives at
`meta.driverAdapterError.cause.constraint.index`. Reading `meta.target` gives
`undefined` and silently produces the wrong message. This bug shipped and was
caught live.

### Errors — `src/errors/error.builder.ts`
Factories return `ErrorResponseDTO`; the controller does
`throw new BadRequestException(duplicateName('Brand', name))`. Pick the closest
existing factory rather than writing a new one. **Throw with these** so errors
keep their real status code — controllers rethrow any `HttpException` unchanged.

Auth/platform-admin: `invalidToken`, `invalidCredentials`, `adminAccountDisabled`,
`shopSuspended`, `userSuspended`, `currentPasswordIncorrect`,
`invalidSetupToken`, `resourceNotFound`, `invalidOwnerPhone`,
`ownerPhoneAlreadyRegistered`, `oneOwnerPerShop`, `invalidSubscriptionDate`,
`subscriptionEndInPast`.
Business: `duplicateName`, `duplicateFieldValue`, `systemRowProtected`,
`requiredFieldCannotBeNull`, `insufficientStock`, `outstandingExceeded`,
`cancelledRowMutationForbidden`, `purchaseSupplierMismatch`,
`purchaseHasNoPayable`, `paymentExceedsOutstanding`, `trackingTypeLocked`,
`stockNotEmptyForTrackingChange`, `purchasePaidExceedsTotal`,
`openingStockCannotTakePayment`, `openingCashAlreadySet`,
`imeisCountMismatch`, `imeisNotAllowed`,
`duplicateImei`, `countedQuantityRequired`, `quantityRequired`,
`unitIdRequired`, `adjustmentNotAllowedForSerialized`,
`unwantedAdjustmentField`, `unitNotInStock`,
`unitNotAvailableForSale`, `customerRequiredForSale`,
`discountExceedsSubtotal`, `salePaidExceedsTotal`, `unwantedSaleItemField`,
`inventoryUnitIdRequiredForSale`, `saleHasReturns`,
`returnQuantityExceedsRemaining`, `returnQuantityRequired`,
`unwantedReturnItemField`, `unitAlreadyReturned`, `unitNotSoldForReturn`,
`refundExceedsAvailable`, `cashReconciliationReasonRequired`,
`invalidReportRange`, `reportPeriodTooLong`.

### Response cheat sheet

| CRUD | Verb | Inner DTO |
|---|---|---|
| Create | `POST /brands` | `StatusBaseResponseDTO` |
| List | `GET /brands` | `PaginatedResponseDTO<ResponseBrandDto>` |
| Get by id | `GET /brands/{id}` | `ResponseBrandDto` |
| Update | `PATCH /brands/{id}` | `StatusBaseResponseDTO` |
| Delete | `DELETE /brands/{id}` | `StatusBaseResponseDTO` |

---

## 16. Testing plan

Run **`npm run lint && npm run test`** before considering any ticket done.

1. ✅ Auth service — login success/fail, setup-password expiry, suspended shop message
2. ✅ Platform admin — shop creation in one transaction, duplicate phone, defaults copied
3. ✅ Purchase service — opening stock vs real, part payment, full Udhar,
   counter uniqueness, IMEI duplicate rejection, idempotent `clientRequestId`,
   wrong-shop 404s, `paidNow > total` → 400, overdraft prompt + retry
4. ✅ Supplier-payments service — per-bill vs opening-balance remaining,
   over-payment → 400, cross-supplier bill → 400, opening-stock bill → 400,
   supplier row lock, overdraft prompt writes nothing, retry saves
   `isOverdraft`, payable derivation excludes opening stock
5. ✅ Inventory service — shape rules (every wrong-field combo is a 400 with
   nothing written), FOR UPDATE lock on accessory adjust, delta-as-counted-minus-current,
   no-change = 200/no row, counted 0 legal, conditional write-off can't double-consume,
   insufficient stock → 400, phone unit status flip + FOR UPDATE + re-write-off refused,
   list defaults to manual types + search/date/sort wiring
6. ✅ Expense service — overdraft prompt writes nothing / retry saves
   `isOverdraft`, shop-row lock before the cash aggregate, category tenant 404,
   cancel writes CANCELLED + one REVERSAL IN with `reversesMovementId`,
   racing double-cancel loses at the in-tx row lock → 400 with nothing
   written, missing original movement → 404 with nothing written, blank
   description → null, list tenancy/date-range wiring
7. ✅ Sale service — walk-in cash vs Udhar rule, discount/paid bounds, counter
    `S-0007`, `clientRequestId` replay + racing P2002 (defensive rethrow of other
    indexes), phone line (SOLD unit blocked → 400 with no sale row, cost
    snapshot, movement), quantity stock (lock, decrement, movement),
    wrong-shop product/unit → 404, list filters
8. ✅ Payment service — oldest-first allocation (opening balance → sales by
   date), explicit `salesIds`, over-payment → 400 with nothing written,
   shared `receiptGroupId`, one IN cash row per payment, shop/customer/sale
   lock order, both replay paths write nothing, tenant 404s, list wiring
9. ✅ Cancel flows — all 4 types, with cash reversal (sale cancel restores
   stock & cash + overdraft prompt, purchase cancel VOIDED/decrement +
   insufficient-stock blocks, payment/supplier-payment one REVERSAL each,
   WF6 cash-row fallback, already-cancelled 400, cross-shop 404)
10. ✅ Ledger (WF11) — customer: balance = opening + active sales − active
   payments with cancelled rows at delta 0, oldest-first order, payment
   reference resolution (saleNo, null for the opening balance), page-2 running
   balance; supplier: balance matches the payable derivation, opening stock
   excluded in the `where`, 404 cross-shop
11. ✅ Dashboard (WF14) — PKT business-day range (date.helper boundary tests),
   net profit = sales − Σ unitCost×qty − today's ACTIVE expenses, Udhar /
   payable derivations with `isOpeningStock: false` in the where, low-stock
   rules per tracking type with `isActive: true`, cash IN − OUT, drill links,
   `period` accepts only `today`
12. ✅ Cash (WF1) — OPENING_CASH row is IN with null references, once-per-shop
   under the shop row lock (second attempt → 400, nothing written), date
   defaults to the PKT business day, movements list tenancy/filters/
   business-day range bounds, amount mapped to a positive number
13. ✅ Store (R1.2) — settings 404/upsert (null on displayName → 400,
   derived slug on create, P2002 on slug → duplicate), enable warning rides
   in `message`, admin `changeStoreSlug` (reserved/no-op/404/collision),
   publish refuses inactive product (single + deactivate-in-one-body +
   bulk), bulk `PATCH /products/publish` (foreign id → 404, nothing
   silently skipped), image max-5 cap, reorder rejects a list that misses/
   duplicates images, tenant-scoped image delete; storefront: OFF ==
   missing == SUSPENDED return byte-identical 404 bodies, `shops.status`
   read fresh past the warm cache, active+published newest-first filter,
   `limit` capped at 50, contactForPrice hides price, showExactStock gates
   `stockCount`, stock bucket from threshold, image urls sorted by
   sortOrder, allowlist absence assertions (no shopId/sku/cost/trackingType/
   condition — `description` carries the PUBLIC text), preview works while
   OFF
14. ✅ Returns (WF15) — preview settlement (Udhar-cap, cash picture,
   stamp-validated), overpaid sale ⇒ refund capped at paid sum (both
   `refundExceedsAvailable`'), line rules (unknown saleItemId 404, accessory
   over-return, duplicate phone line, missing quantity, SOLD−unit check),
   create: stock restore (phone SOLD→IN_STOCK / accessory +qty), DAMAGED is
   a restore+write-off pair with net-zero stock, refund > 0 writes REFUND
   cash OUT (isOverdraft on confirm), overdraft prompt writes nothing,
   CANCELLED sale refused pre-tx and under the tx lock, list tenancy/
   date-range wiring, 404 cross-shop; downstream: sale cancel blocked by
   returns, payments/ledger/dashboard all use the WF15 formula
15. ✅ Owner cash (WF16) — investment writes ONE OWNER_INVESTMENT IN row
   with no transaction, date default + blank-note rules; withdrawal locks
   the shop row before the cash aggregate, writes OWNER_WITHDRAWAL OUT,
   prompts with a 200 shortfall and writes nothing when the drawer cannot
cover it, saves `isOverdraft` on confirm, 404s a missing shop; the
    controller answers 201 on save and 200 on the prompt for each
16. ✅ Cash reconciliations (WF17) — matching count stores the row with NO
    movement; drawer-ahead writes an IN adjustment, drawer-behind an OUT one
    (amount = |difference|, movementDate = PKT business day); non-zero
    difference without a reason → 400 (whitespace-only reason included),
    nothing written; missing shop row → 404; list scopes to shop with
    reason search + business-day bounds on `reconciledAt` and sort wiring
17. ✅ Reports (WF18) — range resolution (from > to → 400, > 366 days →
    400); sales profit + outstanding formulas with CANCELLED excluded in the
    where; purchase opening-stock outstanding 0 + summary count split;
    expense category-name resolution + breakdown sorted desc; profit
    per-day rows across the whole range + net formula; customer outstanding/
    overdue with future dueDates not counted + snapshot ignores the range
    (from/to = businessToday()); supplier payable with `isOpeningStock:
    false` in the where; inventory serialized-vs-quantity stock + lowStock;
    best-sellers sorted by quantity desc; controller wraps JSON in the
    envelope, `format=csv` sets text/csv + attachment headers and returns a
    string, `format=pdf` is a 400 today
18. `psql "$DATABASE_URL" -f test/verify-constraints.sql` in CI after every
     migration change — any `NOT BLOCKED` is a regression to fix immediately

Current state: **57 unit suites / 744 tests**, all passing.

### E2E suite (built)

`npm run test:e2e` boots the **real `AppModule` in-process** (no port) with
supertest against a dedicated database (`dukan_pro` + `_e2e` suffix), so it
never touches dev data. `globalSetup` creates the DB, runs
`prisma migrate deploy`, TRUNCATEs every table (row triggers only fire on
DELETE, so TRUNCATE is safe) and seeds the platform admin. Each spec calls
`harness.provisionShop()` — admin login → create shop → set the owner
password → owner login — so shops are fully isolated and specs share nothing
but the schema. `maxWorkers: 1` (one worker, one DB).

```
test/
├── setup-env.ts            rewrites DATABASE_URL → the _e2e database
└── e2e/
    ├── e2e-env.ts          DB suffix + admin/owner credentials
    ├── global-setup.ts     create DB, migrate deploy, truncate, seed admin
    ├── harness.ts          in-process app, provisionShop(), api(), helpers
    ├── auth.e2e-spec.ts    onboarding / login / setup-password / suspension
    ├── money-path.e2e-spec.ts  the full WF6→9→10→15→13→16→17→14 loop
    ├── tenancy.e2e-spec.ts     cross-shop 404s + shopId-in-body 400s
    ├── store.e2e-spec.ts       R1.2 settings / publish / public catalog
    └── reports.e2e-spec.ts     WF18 reports + CSV export
```

Current state: **5 e2e suites / 59 tests**, all passing. Run a single file by
appending its path: `npm run test:e2e -- test/e2e/store.e2e-spec.ts`.

---

## 17. Dev scripts & environment

```bash
cp .env.example .env.development   # DATABASE_URL, JWT_SECRET, CORS_ORIGINS
npm install
npm run prisma:generate            # → src/generated/prisma/
npm run start:dev                  # http://localhost:4000 ; /api = Swagger
```

| Script | Purpose |
|---|---|
| `npm run build` | compile to `dist/` |
| `npm run lint` | ESLint with `--fix` |
| `npm run test` / `test:cov` | Jest unit tests |
| `npm run test:e2e` | Jest e2e |
| `npm run prisma:migrate:dev` / `:deploy` / `:status` / `:studio` | migrations |

⚠️ Node **>= 24.15.0**. Use `nvm use 24`. Bun is fine for `npm install` but
**not** for running the server — `bcrypt` is native and Prisma officially
supports Node. Jest needs `--experimental-vm-modules` because NestJS 12 is
ESM-only; the scripts already include it — do not strip it.

`DATABASE_URL` for ad-hoc SQL:
```bash
grep -m1 '^DATABASE_URL=' .env.development | cut -d= -f2- | sed 's/?schema=public//'
```

---

*Keep this file in sync with reality. If you add a module, a rule, or change the
release plan, **update this file first**, then write the code.*
