# Ela & Co. — Kerala Restaurant Ordering Platform

A production-grade, full-stack **Next.js 15** ordering platform for *Ela & Co. / Ela
Cuisine*. Customers browse a live menu, log in via **WhatsApp OTP**, order and pay
with **Razorpay** (or Cash on Delivery), and get a **printable invoice**. **Admins**
manage the menu (prices, discounts, stock), open/close the store, see **sales
analytics**, and create **kitchen staff**; **kitchen staff** move each order through
*Confirmed → Preparing → On the way → Delivered*.

Design is ported from the original Ela & Co. site (forest-green + gold + ivory,
Cormorant Garamond).

---

## Features

**Customer (Zomato/Swiggy-style)**
- WhatsApp OTP login (with dev-console fallback)
- Menu with **category tabs, search, discount badges, MRP strikethrough, sold-out &
  low-stock states**, and inline **quantity steppers**
- Sticky mobile cart bar
- Razorpay online payment (UPI/cards/wallets) **or** Cash on Delivery
- Order history with live status + **printable invoice** (sequential invoice numbers)

**Admin**
- Full menu CRUD with **per-item discount %** and **stock limits**
- **Stop/resume taking orders** (store open/close) — customers see a closed banner
- **Analytics dashboard**: daily / weekly / monthly revenue charts, best & least
  sellers, items sold, average order value, discounts given, status breakdown
- Create & remove **kitchen-staff** accounts
- See & update every order

**Kitchen**
- Live order board, update status through to delivered

**Engineering**
- **Full audit trail** — every mutating action (orders, payments, menu, staff, store settings, logins) is recorded in an `AuditLog` table with actor, IP, and before/after metadata; browsable at **Admin → Audit**
- PostgreSQL + Prisma with **real migrations**
- Server-side price/stock recomputation (never trusts the client)
- **Razorpay signature verification** (HMAC-SHA256, timing-safe)
- **Edge middleware** guarding `/admin`, `/kitchen`, `/orders`
- JWT httpOnly session cookies (jose), bcrypt staff passwords, Zod validation
- Security headers, SEO (`robots`, `sitemap`, `manifest`), `next/image` optimization
- **40-check automated end-to-end test**

## Roles

| Role         | Login                              | Access                                            |
| ------------ | ---------------------------------- | ------------------------------------------------- |
| **Customer** | WhatsApp OTP → `/login`            | Order, pay, track, view invoices                  |
| **Admin**    | Username+password → `/staff/login` | Menu, discounts, stock, store toggle, analytics, staff, all orders |
| **Kitchen**  | Username+password → `/staff/login` | Order board, update status                        |

---

## Run locally (Postgres in Docker)

```bash
cd ela-nextjs
npm install

# 1. Start Postgres (or use your own and edit DATABASE_URL in .env)
docker run -d --name ela-postgres -e POSTGRES_PASSWORD=ela_dev_pw -e POSTGRES_DB=ela -p 5432:5432 postgres:16-alpine

# 2. Migrate + seed (admin account + 5 menu items + store settings)
npm run db:deploy      # applies migrations
npm run db:seed

# 3. Run
npm run dev            # http://localhost:3000
```

`.env` is pre-filled for local Docker Postgres and your Razorpay/WhatsApp keys.

### Test it in the browser
- **Customer:** add meals → cart → checkout → log in (the **OTP prints in the terminal**)
  → pay with Razorpay test card `4111 1111 1111 1111` (any future expiry/CVV) or UPI
  `success@razorpay`, or choose Cash on Delivery → view your invoice under **My Orders**.
- **Admin:** `/staff/login` → `admin` / `Ela@Admin2026` → Orders, Analytics, Menu
  (set discounts/stock, toggle store), Kitchen Staff.
- **Kitchen:** create a staff account in admin, then log in at `/staff/login`.

---

## Automated end-to-end test

Drives all roles + the full Razorpay create/verify flow against a running server.

```bash
# terminal 1 — server with output captured so the test can read the OTP
npm run build
npx next start > .next/e2e-server.log 2>&1

# terminal 2
SERVER_LOG=.next/e2e-server.log npm run test:e2e
```

Covers: menu, admin/kitchen auth & guards, menu CRUD + discounts, OTP login,
Razorpay order + signature verify (valid & tampered), invoice generation, COD +
stock decrement, kitchen status flow, store open/close, and analytics.

---

## Deploy to Vercel

1. Push this folder to a Git repo and import it in Vercel.
2. Create a Postgres database (**Supabase**, **Neon**, or **Vercel Postgres**).
3. In Vercel → **Settings → Environment Variables**, add everything from
   `.env.example` (DB URLs, `JWT_SECRET`, `ADMIN_*`, `RAZORPAY_*`,
   `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `WHATSAPP_*`, `NEXT_PUBLIC_SITE_URL`).
   - `DATABASE_URL` → pooled connection (Supabase port `6543`, `?pgbouncer=true`)
   - `DIRECT_URL` → direct connection (port `5432`) — used for migrations
4. Set the **Build Command** to `npm run vercel-build` (runs `prisma migrate deploy`
   before building, so your DB schema is always applied). Then seed once locally
   against the prod `DATABASE_URL`: `npm run db:seed`.

> The default `build` script does **not** run migrations, so local builds never need a
> live DB. `vercel-build` does — use it for deploys.

---

## Going live with real WhatsApp OTP

The dev fallback prints OTPs to the server console. To deliver them for real:
1. Set `WHATSAPP_PHONE_NUMBER_ID` (numeric, from Meta → WhatsApp → API Setup).
2. Create & get approval for an **Authentication** template → `WHATSAPP_TEMPLATE_NAME`.
3. Use a **permanent** token for `WHATSAPP_TOKEN`.
4. Set `OTP_DEV_MODE="false"`.

> ⚠️ **Rotate the Razorpay secret and WhatsApp token** — they were shared in plain
> text. Regenerate both in their dashboards. Secrets live only in `.env` (gitignored)
> and `RAZORPAY_KEY_SECRET` never reaches the browser.

---

## API reference

| Method | Endpoint                    | Role     | Purpose                              |
| ------ | --------------------------- | -------- | ------------------------------------ |
| POST   | `/api/auth/otp/request`     | public   | Send WhatsApp OTP                    |
| POST   | `/api/auth/otp/verify`      | public   | Verify OTP, start customer session   |
| POST   | `/api/auth/staff/login`     | public   | Admin / kitchen login                |
| POST   | `/api/auth/logout`          | any      | Clear session                        |
| GET    | `/api/auth/me`              | any      | Current session                      |
| GET    | `/api/menu`                 | public   | Available menu (`?all=1` for admin)  |
| POST   | `/api/menu`                 | admin    | Create item (price/discount/stock)   |
| PATCH/DELETE | `/api/menu/[id]`      | admin    | Update / delete item                 |
| POST   | `/api/orders`               | customer | Place order **+ Razorpay order**     |
| GET    | `/api/orders`               | any      | Own orders (staff: all)              |
| GET    | `/api/orders/[id]`          | owner/staff | Single order (for invoice)        |
| PATCH  | `/api/orders/[id]/status`   | staff    | Update order status                  |
| POST   | `/api/payments/verify`      | customer | **Verify Razorpay signature**        |
| GET    | `/api/settings`             | public   | Store open state                     |
| PATCH  | `/api/settings`             | admin    | Open/close store                     |
| GET    | `/api/admin/analytics`      | admin    | Sales series, top items, summary     |
| GET    | `/api/admin/audit`          | admin    | Audit log (filter by action / search)|
| GET/POST | `/api/staff`              | admin    | List / create kitchen staff          |
| DELETE | `/api/staff/[id]`           | admin    | Remove kitchen staff                 |
