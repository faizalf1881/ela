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
- **Help & complaints portal** (`/support`) — raise a ticket **with photo/PDF evidence**,
  track status, reply in-thread
- **Membership** (`/membership`) — subscribe with **Razorpay AutoPay (eMandate)**, get an
  automatic discount + free delivery on every order, a **premium gold interface**, and
  self-service cancellation. Meal plans ask for the delivery area, time and first day
- **Order confirmation sound** — the restaurant's sound plays once when an order is
  confirmed (never on refresh)
- **Phone-first ordering** — compact menu cards, a sticky total + Place order bar,
  16px fields (no iOS zoom), no sideways scrolling from 360px up

**Admin**
- **Accounts** — every invoice with filters (status / method / date / customer),
  totals, CSV export and **manual invoice creation**
- Full menu CRUD with **per-item discount %** and **stock limits**
- **Delivery locations** — add/edit/remove areas, per-area fee, activate/deactivate
- **Coupons** — percent or fixed, min order, max discount, usage limits, validity dates
- **Memberships** — two plan types: *discount memberships* (perks on normal orders)
  and **meal plans** that automatically generate a daily order for the subscriber
  (dish list, service weekdays, duration). See subscribers, recurring revenue and
  payment history, and trigger today's generation manually
- **Delivery schedule** — order cut-off time, service weekdays, booking window, and
  the delivery time slots customers choose from (individually closable per date)
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
- **Exports everywhere** — **Excel (.xlsx)**, **CSV** and **PDF/print** for Orders,
  Invoices, Customers, Subscriptions, Complaints, Analytics, Menu and Coupons
- **Dish photo upload** — pick an image from the device (no image hosting needed)
- Complaints support **file attachments** and **assignment to a staff member**

- **WhatsApp chats** (Admin → WhatsApp) — every customer conversation linked to the CRM,
  answered by an **AI assistant (OpenAI or Ollama)** until a person takes over; switch
  back to AI any time; handling states, history and the customer's orders beside the chat
- **WhatsApp order updates** — automatic message on every status change, with a
  **message log** (sent / delivered / read / failed + reason) and one-tap retry
- **New-order alert** — the restaurant's sound + a full-screen green alert with the
  order's details on every admin/kitchen screen; never replays on refresh
- **Settings** — alert sound upload, QR scan steps, WhatsApp message wording/template,
  AI provider, **payment gateway** (Cashfree / Razorpay) and **WhatsApp ordering** on/off
- **Website** (Admin → Website) — the homepage dish (pick any menu dish + badge such as
  Today's Special / Most Popular; price, photo and serving come live from Menu), an
  **offer banner** with coupon code, hero highlights, rating badge, delivery time,
  opening hours, phone, email, address and social links — no code changes needed
- **Ordering on WhatsApp** — customers browse the live menu, build a cart, pick area,
  time and address and confirm the exact total by tapping buttons and lists; the AI
  understands typed requests ("dinner for one") and suggests real dishes; a **secure
  payment link** is sent and the order is confirmed only by the gateway's verified
  payment (or placed at once for cash on delivery)
- **Quick reply / templates** in every chat — pick an approved WhatsApp template, fill in
  its variables, preview, send (works outside the 24-hour window); **New chat** starts a
  conversation with any number; "AI is typing…" for staff and WhatsApp's typing
  indicator for the customer
- **Bulk WhatsApp** (Admin → Bulk WhatsApp) — campaigns with approved templates:
  upload an **Excel/CSV** list (numbers validated, duplicates / invalid / opted-out shown),
  or pick customers from the CRM; map variables per person; preview; confirm consent;
  send; track **sent / delivered / read / failed** per person and in total; export
- **Payments** — Cashfree or Razorpay for website checkout and WhatsApp links, every
  order's payment link (`/pay/<id>`), "Check payment", and **refunds** from the Orders board

**Kitchen**
- Live order board, update status through to delivered
- **Printable delivery label with a scannable QR code** (encodes the order id, no status)
- **Scan to advance** — scanning a label (USB scanner or phone camera, label after
  label) moves the order to its next step; double reads are ignored

**Engineering**
- **Full audit trail** — every mutating action (orders, payments, menu, staff, store settings, logins) is recorded in an `AuditLog` table with actor, IP, and before/after metadata; browsable at **Admin → Audit**
- PostgreSQL + Prisma with **real migrations**
- Server-side price/stock recomputation (never trusts the client)
- **Payments only from the gateway's word** — Razorpay signature, Cashfree order read
  back from its API, or a signed webhook (HMAC-SHA256, timing-safe); applied once,
  never for less than is due
- **Edge middleware** guarding `/admin`, `/kitchen`, `/orders`
- JWT httpOnly session cookies (jose), bcrypt staff passwords, Zod validation
- Security headers, SEO (`robots`, `sitemap`, `manifest`), `next/image` optimization
- **Automated end-to-end test** (500+ checks) covering every module above, run against
  local stand-ins for WhatsApp, OpenAI/Ollama, Razorpay and Cashfree (nothing real is
  ever messaged or charged)
- Uploads stored in Postgres (2 MB/file cap) — no external object store to configure

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
# terminal 1 — server pointed at the test's WhatsApp/AI stand-in (port 4010),
# output captured so the test can read the OTP
npm run build
WHATSAPP_API_BASE=http://127.0.0.1:4010/v21.0 WHATSAPP_TOKEN=e2e-token \
WHATSAPP_PHONE_NUMBER_ID=100200300 WHATSAPP_BUSINESS_ACCOUNT_ID=900800700 \
WHATSAPP_APP_SECRET=e2e-app-secret WHATSAPP_VERIFY_TOKEN=e2e-verify AI_REPLY_DELAY_MS=1000 \
RAZORPAY_API_BASE=http://127.0.0.1:4010 CASHFREE_API_BASE=http://127.0.0.1:4010/pg \
CASHFREE_APP_ID=e2e-cf-app CASHFREE_SECRET_KEY=e2e-cf-secret CASHFREE_ENV=sandbox \
CRON_SECRET=e2e-cron-secret NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
npx next start > .next/e2e-server.log 2>&1

# terminal 2 (use a freshly migrated + seeded database)
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

## Meal plans (automatic daily orders)

A plan can be a **discount membership** or a **meal plan**. A meal plan carries a
dish list, the weekdays it is served, and an optional duration. Each morning a
Vercel Cron job calls `/api/cron/meal-plans` and creates that day's order for every
active subscriber — prepaid (zero balance), tagged **Subscription** on the Orders
board, and invoiced so the kitchen and stock counts behave normally.

- Generation is **idempotent**: a unique `(subscription, delivery date)` index means
  re-running never double-orders.
- It respects start/end dates, cancellation, pause, and the plan's service days.
- **Closing the store pauses it.** On a holiday the scheduled run stands down and
  logs why; an admin can still press *Generate today* → **Generate anyway** to serve
  prepaid subscribers when the storefront is merely closed to new web orders.
- Set **`CRON_SECRET`** in Vercel so only Vercel Cron (or a signed-in admin) can
  trigger it. The schedule lives in `vercel.json` (01:30 UTC = 07:00 IST, before the
  order cut-off).

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

## WhatsApp: order updates, customer chat and the AI assistant

1. **Webhook** — Meta → your app → WhatsApp → Configuration → Webhook:
   callback `https://YOUR-DOMAIN/api/webhooks/whatsapp`, verify token = the value of
   `WHATSAPP_VERIFY_TOKEN`, subscribe to **messages**. Set `WHATSAPP_APP_SECRET`
   (App settings → Basic → App secret): unsigned events are refused.
2. **Order updates** — work as soon as WhatsApp is configured. Free-text messages only
   reach customers who messaged you in the last 24 hours, so create a **Utility**
   template with the body `Hi {{1}}, here's an update on your Ela & Co. order {{2}}: {{3}}`
   and enter its name in **Admin → Settings → WhatsApp order updates**. Failures show in
   **Admin → WhatsApp Log** (never undo the order's status) and can be retried.
3. **AI assistant** — **Admin → Settings → AI assistant**: choose OpenAI (paste the API
   key — stored encrypted, never shown again) or Ollama (a server reachable from the
   internet), then **Test connection**. With the AI off, every chat waits for staff.
   The assistant sees only the menu/delivery rules and the one customer's own records,
   and hands the chat to a person for complaints, refunds, payment problems or when
   unsure. Staff take over / switch back in **Admin → WhatsApp**.

### Ordering, templates and bulk messages on WhatsApp

4. **Webhook fields** — subscribe to **messages** *and* **user_preferences** (WhatsApp's own
   "stop marketing messages" choice is then honoured automatically).
5. **Templates** — set `WHATSAPP_BUSINESS_ACCOUNT_ID` (WhatsApp Manager → Account tools →
   WhatsApp Business Account ID) so approved templates sync (the token needs the
   `whatsapp_business_management` permission). Without it, add templates by hand in
   **Bulk WhatsApp → Templates** — exactly as approved in WhatsApp Manager.
6. **Ordering** — on by default (**Settings → WhatsApp ordering**, with a checklist). It
   needs an online gateway and/or cash on delivery, delivery areas, and ideally the AI
   assistant; taps and the word "menu" work even with the AI off.
7. **Bulk campaigns** — only to people who agreed to hear from you (the screen asks you to
   confirm). Replying **STOP** opts out (START opts back in). Long lists are sent in
   batches; set **`CRON_SECRET`** so each batch hands over to the next on its own.
8. **Billing (Meta, from 1 Oct 2026)** — service replies are free for the first 1,000 per
   number per month, then charged; templates are charged per delivered message. Keep a
   payment method on the WhatsApp account, and **move India billing to INR before
   31 Dec 2026** or Meta stops delivering messages on 1 Jan 2027.

The Graph API version defaults to **v24.0** (v21.0 stops working on 21 Jan 2027); set
`WHATSAPP_API_VERSION` to use another.

## Payments: Cashfree (and Razorpay)

**Settings → Payments** chooses the gateway for website checkout and WhatsApp payment
links: *Automatic* (Cashfree once its keys are set, otherwise Razorpay), *Cashfree* or
*Razorpay*. Memberships with AutoPay stay on Razorpay (mandates can't move).

1. Cashfree dashboard → **Payment Gateway → Developers → API Keys** → generate the App ID
   and Secret Key (use *Switch to Test* for test keys).
2. In Vercel add **`CASHFREE_APP_ID`** and **`CASHFREE_SECRET_KEY`** (optionally
   `CASHFREE_ENV=sandbox|production`; test keys are recognised automatically), then **Redeploy**.
3. Cashfree → **Developers → Whitelisting** → add your website's domain (needed for live payments).
4. Webhooks are sent to `https://YOUR-DOMAIN/api/webhooks/cashfree` automatically with every
   order; adding the same URL under Developers → Webhooks is optional.
5. Make sure **`NEXT_PUBLIC_SITE_URL`** is the site's real address — payment links use it.

An order is marked paid only when the gateway confirms it (signed webhook, or the order
read back from Cashfree's API) — never because a link was opened. Refunds: **Orders →
Refund…** (through the gateway, or record one made outside).

## Going live with real WhatsApp OTP

The dev fallback prints OTPs to the server console. To deliver them for real:
1. Set `WHATSAPP_PHONE_NUMBER_ID` (numeric, from Meta → WhatsApp → API Setup).
2. Create & get approval for an **Authentication** template → `WHATSAPP_TEMPLATE_NAME`.
3. Use a **permanent** token for `WHATSAPP_TOKEN`.
4. Set `OTP_DEV_MODE="false"`.

> ⚠️ **Rotate the Razorpay secret, WhatsApp token and OpenAI key** — they were shared in
> plain text. Regenerate them in their dashboards. Secrets live only in `.env` (gitignored)
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
| GET    | `/api/delivery/availability`| public   | Bookable delivery dates + time slots |
| GET/POST | `/api/slots`              | admin    | List / create delivery time slots    |
| PATCH/DELETE | `/api/slots/[id]`     | admin    | Edit, close a date, or remove a slot |
| POST   | `/api/cron/meal-plans`      | cron/admin | Generate today's meal-plan orders  |
| POST   | `/api/uploads`              | admin/customer | Upload dish photos / complaint files |
| GET    | `/api/media/[id]`           | mixed    | Serve a file (menu public, tickets private) |
| GET    | `/api/admin/export`         | admin    | `?type=…&format=xlsx\|csv` report export |
| GET    | `/api/site`                 | public   | Website contact / delivery details   |
| GET/PATCH | `/api/admin/site`        | admin    | Homepage dish, offer banner, contact details |
| POST   | `/api/payments/cashfree/verify` | customer | Confirm a Cashfree checkout with Cashfree's API |
| POST   | `/api/webhooks/cashfree`    | Cashfree | **Signed** payment / refund events    |
| POST   | `/api/pay/[id]`, `/api/pay/[id]/confirm` | link key | Pay an order from its payment link |
| GET/POST | `/api/admin/orders/[id]/payment` | admin | Payment link · ask the gateway if paid |
| POST   | `/api/admin/orders/[id]/refund` | admin  | Refund (gateway or recorded), optional cancel |
| GET/POST | `/api/admin/whatsapp/templates` | admin | Templates · add one by hand        |
| POST   | `/api/admin/whatsapp/templates/sync` | admin | Sync templates from Meta        |
| POST   | `/api/admin/whatsapp/conversations` | admin | New chat with a template          |
| POST   | `/api/admin/whatsapp/conversations/[id]/template` | admin | Quick reply: send a template |
| POST   | `/api/admin/whatsapp/conversations/[id]/typing` | admin | Show the customer "typing…"   |
| GET    | `/api/admin/whatsapp/health` | admin   | Number quality + messaging limit      |
| GET/POST | `/api/admin/campaigns`    | admin    | Campaigns · new draft                 |
| GET/PATCH/DELETE | `/api/admin/campaigns/[id]` | admin | Detail · message mapping & consent · delete draft |
| POST/DELETE | `/api/admin/campaigns/[id]/recipients` | admin | Add (sheet rows / CRM) · remove |
| POST   | `/api/admin/campaigns/import` | admin  | Read an Excel / CSV list              |
| POST   | `/api/admin/campaigns/[id]/send` · `/cancel` · `/process` | admin/cron | Send, stop, continue |
| GET    | `/api/admin/campaigns/[id]/export` | admin | Per-recipient delivery report (CSV) |
