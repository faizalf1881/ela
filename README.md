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

Already git-committed and configured — `vercel.json` sets the build command
(`npm run vercel-build`, which runs `prisma migrate deploy`) and pins the
**Mumbai (`bom1`)** region for low latency in India.

1. **Create a Neon Postgres DB** (free) — [neon.tech](https://neon.tech) → new project.
   From the **Connection string** widget copy two strings:
   - `DATABASE_URL` → the **pooled** string (host has `-pooler`)
   - `DIRECT_URL` → the **direct** string (toggle *Connection pooling* off; no `-pooler`)

   Both should end with `?sslmode=require`.
2. **Import the repo** ([faizalf1881/ela](https://github.com/faizalf1881/ela)) in Vercel.
3. **Set env vars** in Vercel → *Settings → Environment Variables* (copy from
   `.env.example`): `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `ADMIN_USERNAME`,
   `ADMIN_PASSWORD`, `RAZORPAY_*`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `WHATSAPP_*`,
   `NEXT_PUBLIC_SITE_URL`, `OTP_DEV_MODE=false`. **Do not** set `OTP_LOG_FILE`.
4. **Deploy.** The build applies migrations automatically. Then **seed once**
   against the production DB (locally, with prod `DATABASE_URL` in `.env`):
   `npm run db:seed`.

> Set env vars **before** the first deploy — the build runs `prisma migrate deploy`
> and needs `DIRECT_URL`.

### Performance / caching
- The **homepage is ISR-cached** (static HTML from the CDN, regenerated at most
  every 5 min) and **busted instantly** when an admin edits the menu or toggles the
  store (`revalidateTag`). Local load test: **~210 req/s, p99 323 ms** on one
  machine — on Vercel's CDN the homepage scales effectively without limit.
- Menu + store-status reads use the **Data Cache**, so they don't hit Postgres on
  every request. Order/stock writes always re-check **live** DB stock, so caching
  never causes overselling.
- **Neon free** handles a real single-restaurant workload comfortably; the pooled
  `DATABASE_URL` keeps serverless connection counts bounded. Upgrade to paid only to
  remove cold starts or for much higher concurrency.

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
