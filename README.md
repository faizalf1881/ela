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
- **Separate Login & Sign Up** — login takes only a WhatsApp number; unregistered
  numbers are told to sign up. Name is collected **once** at sign-up and never asked
  again (checkout auto-fills name + phone from the profile).
- Menu with **category tabs, search, discount badges, MRP strikethrough, Stock Out &
  low-stock states**, and inline **quantity steppers**
- **Delivery-location picker** (admin-managed areas, each with its own delivery fee)
- **Coupon codes** applied at checkout with instant discount preview
- Razorpay online payment (UPI/cards/wallets) **or** Cash on Delivery
- Order history with live status + **printable invoice** (sequential invoice numbers)
- **Help & complaints portal** (`/support`) — raise a ticket, track status, reply in-thread
- **Membership** (`/membership`) — subscribe with **Razorpay AutoPay (eMandate)**, get an
  automatic discount + free delivery on every order, a **premium gold interface**, and
  self-service cancellation

**Admin**
- **Accounts** — every invoice with filters (status / method / date / customer),
  totals, CSV export and **manual invoice creation**
- Full menu CRUD with **per-item discount %** and **stock limits**
- **Delivery locations** — add/edit/remove areas, per-area fee, activate/deactivate
- **Coupons** — percent or fixed, min order, max discount, usage limits, validity dates
- **Memberships** — create subscription plans (price, billing cycle, order discount,
  free delivery, benefit list), see subscribers, recurring revenue and payment history
- **CRM** — customer directory with order history, lifetime spend, preferred payment,
  last activity and internal notes
- **Reviews** — publish/unpublish/edit/delete testimonials + a shareable
  **review-collection link** with a moderation queue
- **Support** — all complaints with filters, threaded replies, **internal notes**,
  status workflow, WhatsApp notifications
- **Stop/resume taking orders** (store open/close) — customers see a closed banner
- **Analytics dashboard**: daily / weekly / monthly revenue charts, best & least
  sellers, items sold, average order value, discounts given, status breakdown
- Create & remove **kitchen-staff** accounts; see & update every order
- **CSV export** on Orders, Accounts, CRM and Support

**Kitchen**
- Live order board, update status through to delivered
- **Printable delivery label with a scannable QR code** (encodes the order id)
- **Scan box** — scan a label (or type an order/invoice number) to jump to that order

**Engineering**
- **Full audit trail** — every mutating action (orders, payments, menu, staff, store settings, logins) is recorded in an `AuditLog` table with actor, IP, and before/after metadata; browsable at **Admin → Audit**
- PostgreSQL + Prisma with **real migrations**
- Server-side price/stock recomputation (never trusts the client)
- **Razorpay signature verification** (HMAC-SHA256, timing-safe)
- **Edge middleware** guarding `/admin`, `/kitchen`, `/orders`
- JWT httpOnly session cookies (jose), bcrypt staff passwords, Zod validation
- Security headers, SEO (`robots`, `sitemap`, `manifest`), `next/image` optimization
- **112-check automated end-to-end test** covering every module above

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

Covers: menu, admin/kitchen auth & guards, menu CRUD + discounts, **sign-up vs login**
(unregistered numbers rejected), Razorpay order + signature verify (valid & tampered),
**coupons** (validity, min-order, duplicates, server-side re-check), **delivery
locations** (fees, permissions), invoice generation, COD + stock decrement, kitchen
status flow, store open/close, analytics, **Accounts** (filters + manual invoice),
**CRM** aggregates, **review moderation**, **support tickets** (internal notes stay
hidden from customers), **label QR scan lookup**, and the audit trail.

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

## Turning on memberships

1. **Razorpay → Subscriptions** must be enabled on the account (it is used to hold the
   customer's **eMandate/AutoPay** authorisation).
2. **Add the webhook** so renewals keep memberships active:
   - URL `https://YOUR-DOMAIN/api/webhooks/razorpay`
   - Events: `subscription.charged`, `activated`, `halted`, `paused`, `resumed`,
     `cancelled`, `completed`
   - Put the webhook secret in **`RAZORPAY_WEBHOOK_SECRET`**. Unsigned calls are rejected.
3. **Admin → Memberships** → edit the seeded plans (price, cycle, order discount, free
   delivery, benefits) and switch them **Live**. Plans are seeded **inactive** so nothing
   ever sells at a placeholder price.

Each plan is mirrored into Razorpay on save. If a plan shows *"Not linked to Razorpay"*,
subscriptions aren't enabled on the account yet — fix that, then save the plan again.
Changing a live plan's price or cycle creates a **new** Razorpay plan; existing members
keep their old rate until they resubscribe.

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
| GET    | `/api/locations`            | public   | Active delivery areas (`?all=1` admin)|
| POST   | `/api/locations`            | admin    | Add a delivery area                  |
| PATCH/DELETE | `/api/locations/[id]` | admin    | Update / remove a delivery area      |
| GET/POST | `/api/coupons`            | admin    | List / create coupons                |
| PATCH/DELETE | `/api/coupons/[id]`   | admin    | Update / delete a coupon             |
| POST   | `/api/coupons/validate`     | customer | Validate a code against the cart     |
| GET/POST | `/api/admin/accounts`     | admin    | Invoice list (filters) / manual invoice |
| GET    | `/api/admin/crm`            | admin    | Customer directory + aggregates      |
| PATCH  | `/api/admin/crm/[id]`       | admin    | Save CRM notes / address             |
| GET    | `/api/reviews`              | public   | Published reviews (`?all=1` admin)   |
| POST   | `/api/reviews`              | admin    | Add a review                         |
| PATCH/DELETE | `/api/reviews/[id]`   | admin    | Edit / publish / delete a review     |
| POST   | `/api/reviews/submit`       | public   | Submit a review (awaits moderation)  |
| GET/POST | `/api/tickets`            | any      | List tickets / raise a complaint     |
| PATCH  | `/api/tickets/[id]`         | any      | Reply, internal note, change status  |
| POST   | `/api/orders/scan`          | staff    | Look an order up from a label QR     |
| GET    | `/api/plans`                | public   | Live membership plans (`?all=1` admin)|
| POST   | `/api/plans`                | admin    | Create a plan (mirrors into Razorpay)|
| PATCH/DELETE | `/api/plans/[id]`     | admin    | Update / hide / delete a plan        |
| GET/POST | `/api/subscriptions`      | any      | List memberships / start one (eMandate)|
| POST   | `/api/subscriptions/verify` | customer | **Verify mandate signature**, activate |
| POST   | `/api/subscriptions/[id]/cancel` | owner/admin | Cancel at cycle end          |
| POST   | `/api/webhooks/razorpay`    | Razorpay | **Signed** recurring-billing events  |
