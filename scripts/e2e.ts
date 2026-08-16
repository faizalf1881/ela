/**
 * End-to-end test — drives the running app over HTTP across all roles.
 * Run:  npm run build && npm start  (in one shell), then  npm run test:e2e
 * Or use scripts/run-e2e.ps1 which orchestrates both.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const LOG = process.env.SERVER_LOG || path.join(process.cwd(), ".next", "e2e-server.log");

// ---- read a few secrets from .env (no dotenv dependency) ----
function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {}
  return out;
}
const ENV = readEnv();
const KEY_SECRET = ENV.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET || "";
const ADMIN_USER = ENV.ADMIN_USERNAME || "admin";
const ADMIN_PASS = ENV.ADMIN_PASSWORD || "Ela@Admin2026";

// ---- tiny test harness ----
let passed = 0;
let failed = 0;
const fails: string[] = [];
function ok(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    fails.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}
function section(t: string) {
  console.log(`\n▸ ${t}`);
}

// ---- cookie-aware client ----
class Client {
  cookie = "";
  async fetch(pathname: string, opts: RequestInit = {}) {
    const headers = new Headers(opts.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    if (opts.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const res = await fetch(BASE + pathname, { ...opts, headers, redirect: "manual" });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const [pair] = sc.split(";");
      const [name] = pair.split("=");
      if (name.trim() === "ela_session") this.cookie = pair.trim();
    }
    return res;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const OTP_FILE = process.env.OTP_LOG_FILE || path.join(process.cwd(), ".next", "otp-dev.log");

async function readOtp(phone: string): Promise<string | null> {
  for (let i = 0; i < 30; i++) {
    // Preferred: dedicated OTP file (reliable, flushed per write).
    try {
      const raw = fs.readFileSync(OTP_FILE, "utf8");
      const re = new RegExp(`^${phone}\\s+(\\d{6})$`, "gm");
      let last: string | null = null;
      let m: RegExpExecArray | null;
      while ((m = re.exec(raw))) last = m[1];
      if (last) return last;
    } catch {}
    // Fallback: parse the server stdout log.
    try {
      const raw = fs.readFileSync(LOG, "utf8");
      const re = new RegExp(`\\[Ela OTP\\]\\s+${phone}\\s+\\S+\\s+(\\d{6})`, "g");
      let last: string | null = null;
      let m: RegExpExecArray | null;
      while ((m = re.exec(raw))) last = m[1];
      if (last) return last;
    } catch {}
    await sleep(400);
  }
  return null;
}

function sign(orderId: string, paymentId: string) {
  return crypto.createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
}

async function main() {
  console.log(`E2E against ${BASE}\n`);

  // ---------- Public menu ----------
  section("Public menu");
  const menuRes = await new Client().fetch("/api/menu");
  const menu = (await menuRes.json()).items as { id: string; name: string; price: number; discountPercent: number }[];
  ok(menuRes.status === 200, "GET /api/menu → 200");
  ok(menu.length >= 5, `menu has ${menu.length} items (>=5)`);
  const discounted = menu.find((m) => m.discountPercent > 0);
  ok(!!discounted, "at least one discounted item exists");

  // ---------- Admin ----------
  section("Admin auth + guards");
  const admin = new Client();
  const alRes = await admin.fetch("/api/auth/staff/login", {
    method: "POST",
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  ok(alRes.status === 200, "admin login → 200");
  const me = await (await admin.fetch("/api/auth/me")).json();
  ok(me.user?.role === "admin", "session role = admin");

  const anonMenu = await new Client().fetch("/api/menu", { method: "POST", body: JSON.stringify({ name: "x", price: 100 }) });
  ok(anonMenu.status === 403, "anonymous POST /api/menu → 403");

  section("Admin menu CRUD + discount");
  const createRes = await admin.fetch("/api/menu", {
    method: "POST",
    body: JSON.stringify({ name: "E2E Test Dish", price: 200, discountPercent: 25, stock: 10, category: "Test" }),
  });
  ok(createRes.status === 201, "create item → 201");
  const testItem = (await createRes.json()).item as { id: string };
  const patchRes = await admin.fetch(`/api/menu/${testItem.id}`, { method: "PATCH", body: JSON.stringify({ price: 240 }) });
  ok(patchRes.status === 200, "update item → 200");

  section("Admin creates kitchen staff");
  const kitchenUser = `kitchen_e2e_${Date.now().toString().slice(-6)}`;
  const kitchenPass = "kitchen123";
  const staffRes = await admin.fetch("/api/staff", {
    method: "POST",
    body: JSON.stringify({ username: kitchenUser, password: kitchenPass, name: "E2E Cook" }),
  });
  ok(staffRes.status === 201, "create kitchen staff → 201");
  const shortPw = await admin.fetch("/api/staff", { method: "POST", body: JSON.stringify({ username: "x_e2e", password: "12" }) });
  ok(shortPw.status === 400, "reject short password → 400");

  // ---------- Kitchen ----------
  section("Kitchen auth");
  const kitchen = new Client();
  const klRes = await kitchen.fetch("/api/auth/staff/login", { method: "POST", body: JSON.stringify({ username: kitchenUser, password: kitchenPass }) });
  ok(klRes.status === 200, "kitchen login → 200");
  const kme = await (await kitchen.fetch("/api/auth/me")).json();
  ok(kme.user?.role === "kitchen", "session role = kitchen");

  // ---------- Customer OTP: sign up vs login ----------
  section("Customer WhatsApp OTP sign-up & login");
  const phone = "9" + String(Date.now()).slice(-9); // unique 10-digit

  // Unregistered number cannot "log in" — it is guided to sign up (spec #2).
  const loginUnknown = await new Client().fetch("/api/auth/otp/request", { method: "POST", body: JSON.stringify({ phone, mode: "login" }) });
  const luJson = await loginUnknown.json();
  ok(loginUnknown.status === 404 && luJson.notRegistered === true, "login with unregistered number → 404 + notRegistered");

  const reqOtp = await new Client().fetch("/api/auth/otp/request", { method: "POST", body: JSON.stringify({ phone, mode: "signup" }) });
  ok(reqOtp.status === 200, "sign-up OTP → 200");
  const code = await readOtp("91" + phone);
  ok(!!code, `OTP captured from server log (${code})`);

  const customer = new Client();
  const badVerify = await customer.fetch("/api/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, code: "000000" }) });
  ok(badVerify.status === 400, "wrong OTP → 400");
  const verify = await customer.fetch("/api/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, code, name: "E2E Customer" }) });
  ok(verify.status === 200, "correct OTP → 200 (account created + logged in)");
  const meCust = await (await customer.fetch("/api/auth/me")).json();
  ok(meCust.user?.name === "E2E Customer", "profile name saved at sign-up (not asked again)");

  // Now registered: login mode is accepted (throttle makes an immediate resend 429).
  const loginKnown = await new Client().fetch("/api/auth/otp/request", { method: "POST", body: JSON.stringify({ phone, mode: "login" }) });
  ok(loginKnown.status === 200 || loginKnown.status === 429, "login with registered number accepted (no 404)");

  // ---------- Delivery locations ----------
  section("Delivery locations");
  const locRes = await admin.fetch("/api/locations", {
    method: "POST",
    body: JSON.stringify({ name: "E2E Area " + Date.now().toString().slice(-5), area: "Test zone", deliveryFee: 45, active: true }),
  });
  const locJson = await locRes.json();
  ok(locRes.status === 201, `admin creates delivery location → 201 ${locRes.status !== 201 ? JSON.stringify(locJson) : ""}`);
  const locationId: string = locJson.location.id;
  const pubLocs = await (await new Client().fetch("/api/locations")).json();
  ok(pubLocs.locations.some((l: { id: string }) => l.id === locationId), "location visible publicly");
  const custLoc = await customer.fetch("/api/locations", { method: "POST", body: JSON.stringify({ name: "Nope" }) });
  ok(custLoc.status === 403, "customer cannot create locations → 403");

  // ---------- Coupons ----------
  section("Coupons");
  const couponCode = "E2E" + Date.now().toString().slice(-6);
  const cRes = await admin.fetch("/api/coupons", {
    method: "POST",
    body: JSON.stringify({ code: couponCode, discountType: "PERCENT", value: 10, minOrder: 100, active: true }),
  });
  ok(cRes.status === 201, `admin creates coupon → 201 ${cRes.status !== 201 ? JSON.stringify(await cRes.json()) : ""}`);
  const dupe = await admin.fetch("/api/coupons", { method: "POST", body: JSON.stringify({ code: couponCode, discountType: "PERCENT", value: 5 }) });
  ok(dupe.status === 409, "duplicate coupon code → 409");
  const badCoupon = await customer.fetch("/api/coupons/validate", { method: "POST", body: JSON.stringify({ code: "NOPE" + Date.now(), subtotal: 500 }) });
  ok((await badCoupon.json()).ok === false, "invalid coupon rejected");
  const lowCart = await customer.fetch("/api/coupons/validate", { method: "POST", body: JSON.stringify({ code: couponCode, subtotal: 50 }) });
  ok((await lowCart.json()).ok === false, "coupon below min order rejected");
  const goodCoupon = await customer.fetch("/api/coupons/validate", { method: "POST", body: JSON.stringify({ code: couponCode, subtotal: 500 }) });
  const gc = await goodCoupon.json();
  ok(gc.ok === true && gc.discount === 50, `valid coupon → ₹${gc.discount} off 500`);

  // ---------- Razorpay order + verify ----------
  section("Order + Razorpay create + signature verify");
  const orderItems = [
    { id: discounted!.id, qty: 2 },
    { id: menu.find((m) => m.id !== discounted!.id)!.id, qty: 1 },
  ];
  const orderRes = await customer.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ items: orderItems, name: "E2E Customer", phone: "+91" + phone, deliveryLocationId: locationId, couponCode, paymentMethod: "razorpay" }),
  });
  const orderData = await orderRes.json();
  ok(orderRes.status === 200, `create razorpay order → 200 ${orderRes.status !== 200 ? JSON.stringify(orderData) : ""}`);
  ok(!!orderData.razorpay?.orderId?.startsWith("order_"), "Razorpay order_id returned");
  ok(orderData.order.discountTotal > 0, `discount applied (saved ₹${orderData.order?.discountTotal})`);
  ok(orderData.order.couponDiscount > 0 && orderData.order.couponCode === couponCode, `coupon applied server-side (−₹${orderData.order?.couponDiscount})`);
  ok(orderData.order.deliveryFee === 45, `delivery fee from location (₹${orderData.order?.deliveryFee})`);
  ok(
    orderData.order.total === orderData.order.subtotal - orderData.order.couponDiscount + orderData.order.deliveryFee,
    "total = subtotal − coupon + delivery",
  );

  const rzpOrderId = orderData.razorpay.orderId;
  const dbOrderId = orderData.order.id;
  const fakePayment = "pay_e2e_" + crypto.randomBytes(6).toString("hex");

  const badSig = await customer.fetch("/api/payments/verify", {
    method: "POST",
    body: JSON.stringify({ razorpay_order_id: rzpOrderId, razorpay_payment_id: fakePayment, razorpay_signature: "deadbeef" }),
  });
  ok(badSig.status === 400, "bad signature → 400 (not marked paid)");

  const goodSig = sign(rzpOrderId, fakePayment);
  const verifyPay = await customer.fetch("/api/payments/verify", {
    method: "POST",
    body: JSON.stringify({ razorpay_order_id: rzpOrderId, razorpay_payment_id: fakePayment, razorpay_signature: goodSig }),
  });
  const paid = await verifyPay.json();
  ok(verifyPay.status === 200, "valid signature → 200");
  ok(paid.order?.paymentStatus === "PAID", "order marked PAID");
  ok(!!paid.order?.invoiceNo?.startsWith("ELA-"), `invoice generated (${paid.order?.invoiceNo})`);

  section("Customer order history + single order");
  const myOrders = await (await customer.fetch("/api/orders")).json();
  ok(Array.isArray(myOrders.orders) && myOrders.orders.some((o: { id: string }) => o.id === dbOrderId), "order appears in history");
  const single = await customer.fetch(`/api/orders/${dbOrderId}`);
  ok(single.status === 200, "GET /api/orders/[id] → 200");

  // ---------- COD + stock decrement ----------
  section("Cash on Delivery + stock decrement");
  const before = ((await (await admin.fetch("/api/menu?all=1")).json()).items as { id: string; stock: number | null }[]).find((m) => m.id === testItem.id);
  // add testItem to menu availability check: order the test dish (stock 10) via COD
  const codRes = await customer.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ items: [{ id: testItem.id, qty: 3 }], name: "E2E", phone: "+91" + phone, deliveryLocationId: locationId, paymentMethod: "cod" }),
  });
  const cod = await codRes.json();
  ok(codRes.status === 200 && cod.paymentMethod === "cod", "COD order placed → 200");
  ok(!!cod.order?.invoiceNo, "COD order has invoice immediately");
  const after = ((await (await admin.fetch("/api/menu?all=1")).json()).items as { id: string; stock: number | null }[]).find((m) => m.id === testItem.id);
  ok((before?.stock ?? 0) - (after?.stock ?? 0) === 3, `stock decremented 3 (${before?.stock} → ${after?.stock})`);

  // ---------- Kitchen status flow ----------
  section("Kitchen updates status");
  const st1 = await kitchen.fetch(`/api/orders/${dbOrderId}/status`, { method: "PATCH", body: JSON.stringify({ status: "OUT_FOR_DELIVERY" }) });
  ok(st1.status === 200, "kitchen → On the way (200)");
  const st2 = await kitchen.fetch(`/api/orders/${dbOrderId}/status`, { method: "PATCH", body: JSON.stringify({ status: "DELIVERED" }) });
  ok((await st2.json()).order?.status === "DELIVERED", "kitchen → Delivered");
  const custStatus = await customer.fetch(`/api/orders/${dbOrderId}/status`, { method: "PATCH", body: JSON.stringify({ status: "PLACED" }) });
  ok(custStatus.status === 403, "customer cannot change status → 403");

  // ---------- Store open/close ----------
  section("Store open/close");
  await admin.fetch("/api/settings", { method: "PATCH", body: JSON.stringify({ acceptingOrders: false }) });
  const closedOrder = await customer.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "E2E", phone: "+91" + phone, deliveryLocationId: locationId, paymentMethod: "cod" }),
  });
  ok(closedOrder.status === 403, "orders blocked when store closed → 403");
  await admin.fetch("/api/settings", { method: "PATCH", body: JSON.stringify({ acceptingOrders: true }) });
  const reopened = await (await new Client().fetch("/api/settings")).json();
  ok(reopened.acceptingOrders === true, "store reopened");

  // ---------- Analytics ----------
  section("Analytics");
  for (const range of ["daily", "weekly", "monthly"]) {
    const a = await (await admin.fetch(`/api/admin/analytics?range=${range}`)).json();
    ok(Array.isArray(a.series) && a.series.length > 0, `${range}: series present (${a.series?.length} buckets)`);
  }
  const daily = await (await admin.fetch("/api/admin/analytics?range=daily")).json();
  ok(daily.summary.totalOrders >= 2, `analytics counts orders (${daily.summary.totalOrders})`);
  ok(daily.topItems.length > 0, "top sellers computed");
  ok(daily.summary.totalRevenue > 0, `revenue tracked (₹${daily.summary.totalRevenue})`);

  // ---------- Accounts (invoices) ----------
  section("Accounts module");
  const acc = await (await admin.fetch("/api/admin/accounts")).json();
  ok(Array.isArray(acc.invoices) && acc.invoices.length > 0, `invoices listed (${acc.invoices?.length})`);
  ok(acc.invoices.some((i: { id: string }) => i.id === dbOrderId), "paid order appears in accounts");
  ok(acc.summary.total > 0, `accounts summary totals (₹${acc.summary?.total})`);
  const paidOnly = await (await admin.fetch("/api/admin/accounts?status=PAID")).json();
  ok(paidOnly.invoices.every((i: { paymentStatus: string }) => i.paymentStatus === "PAID"), "status filter works");
  const manual = await admin.fetch("/api/admin/accounts", {
    method: "POST",
    body: JSON.stringify({ customerName: "Walk-in E2E", customerPhone: "+919000000000", items: [{ name: "Sadya", price: 300, qty: 2 }], paid: true }),
  });
  const manualJson = await manual.json();
  ok(manual.status === 201 && manualJson.order?.invoiceNo, `manual invoice created (${manualJson.order?.invoiceNo})`);
  ok(manualJson.order?.total === 600, "manual invoice total computed");
  const custAcc = await customer.fetch("/api/admin/accounts");
  ok(custAcc.status === 403, "accounts are admin-only → 403");

  // ---------- CRM ----------
  section("CRM module");
  const crm = await (await admin.fetch("/api/admin/crm")).json();
  ok(Array.isArray(crm.customers) && crm.customers.length > 0, `CRM lists customers (${crm.customers?.length})`);
  const crmMe = crm.customers.find((c: { phone: string }) => c.phone.endsWith(phone.slice(-10)));
  ok(!!crmMe, "E2E customer present in CRM");
  ok(crmMe.totalOrders >= 2 && crmMe.totalSpent > 0, `aggregates computed (${crmMe?.totalOrders} orders, ₹${crmMe?.totalSpent})`);
  const crmPatch = await admin.fetch(`/api/admin/crm/${crmMe.id}`, { method: "PATCH", body: JSON.stringify({ notes: "VIP e2e" }) });
  ok(crmPatch.status === 200, "admin can save CRM notes");

  // ---------- Reviews ----------
  section("Reviews management");
  const revCreate = await admin.fetch("/api/reviews", {
    method: "POST",
    body: JSON.stringify({ authorName: "E2E Reviewer", location: "Trivandrum", rating: 5, body: "Excellent sadya, e2e verified.", published: true }),
  });
  const revJson = await revCreate.json();
  ok(revCreate.status === 201, "admin creates review → 201");
  const reviewId: string = revJson.review.id;
  const pubRevs = await (await new Client().fetch("/api/reviews")).json();
  ok(pubRevs.reviews.some((r: { id: string }) => r.id === reviewId), "published review is public");
  const submitted = await new Client().fetch("/api/reviews/submit", {
    method: "POST",
    body: JSON.stringify({ authorName: "Walk-in", location: "Pattom", rating: 4, body: "Submitted via collection link." }),
  });
  ok(submitted.status === 200, "public review submission → 200");
  const allRevs = await (await admin.fetch("/api/reviews?all=1")).json();
  ok(allRevs.reviews.some((r: { source: string; published: boolean }) => r.source === "collected" && !r.published), "submitted review is unpublished (moderation)");
  const pubRevs2 = await (await new Client().fetch("/api/reviews")).json();
  ok(!pubRevs2.reviews.some((r: { source: string }) => r.source === "collected"), "unmoderated review not shown publicly");
  await admin.fetch(`/api/reviews/${reviewId}`, { method: "DELETE" });

  // ---------- Support tickets ----------
  section("Support tickets");
  const tRes = await customer.fetch("/api/tickets", {
    method: "POST",
    body: JSON.stringify({ category: "Delivery Issue", subject: "E2E test complaint", body: "The order arrived late.", orderId: dbOrderId }),
  });
  const tJson = await tRes.json();
  ok(tRes.status === 201 && tJson.ticket?.ticketNo?.startsWith("TKT-"), `ticket created (${tJson.ticket?.ticketNo})`);
  const ticketId: string = tJson.ticket.id;
  const staffReply = await admin.fetch(`/api/tickets/${ticketId}`, { method: "PATCH", body: JSON.stringify({ message: "Sorry! Looking into it.", internal: false }) });
  ok(staffReply.status === 200, "admin replies to ticket");
  await admin.fetch(`/api/tickets/${ticketId}`, { method: "PATCH", body: JSON.stringify({ message: "Internal: refund approved", internal: true }) });
  const custView = await (await customer.fetch("/api/tickets")).json();
  const myTicket = custView.tickets.find((t: { id: string }) => t.id === ticketId);
  ok(!!myTicket, "customer sees own ticket");
  ok(!myTicket.messages.some((m: { body: string }) => m.body.includes("Internal:")), "internal note hidden from customer");
  const staffView = await (await admin.fetch("/api/tickets")).json();
  const adminTicket = staffView.tickets.find((t: { id: string }) => t.id === ticketId);
  ok(adminTicket.messages.some((m: { internal: boolean }) => m.internal), "admin sees internal note");
  const custEscalate = await customer.fetch(`/api/tickets/${ticketId}`, { method: "PATCH", body: JSON.stringify({ status: "RESOLVED" }) });
  ok(custEscalate.status === 403, "customer cannot set ticket status → 403");
  const resolved = await admin.fetch(`/api/tickets/${ticketId}`, { method: "PATCH", body: JSON.stringify({ status: "RESOLVED" }) });
  ok((await resolved.json()).ticket?.status === "RESOLVED", "admin resolves ticket");

  // ---------- Label QR scan lookup ----------
  section("Delivery label scan");
  const scanFull = await kitchen.fetch("/api/orders/scan", { method: "POST", body: JSON.stringify({ code: dbOrderId }) });
  ok((await scanFull.json()).order?.id === dbOrderId, "scan by full order id finds order");
  const scanShort = await kitchen.fetch("/api/orders/scan", { method: "POST", body: JSON.stringify({ code: dbOrderId.slice(-6) }) });
  ok(scanShort.status === 200, "scan by short code finds order");
  const scanBad = await kitchen.fetch("/api/orders/scan", { method: "POST", body: JSON.stringify({ code: "zzzznotanorder" }) });
  ok(scanBad.status === 404, "unknown scan code → 404");
  const scanCust = await customer.fetch("/api/orders/scan", { method: "POST", body: JSON.stringify({ code: dbOrderId }) });
  ok(scanCust.status === 403, "customers cannot scan → 403");

  // ---------- Audit trail ----------
  section("Audit trail");
  const auditRes = await admin.fetch("/api/admin/audit?limit=100");
  const auditData = await auditRes.json();
  ok(auditRes.status === 200, "GET /api/admin/audit → 200 (admin)");
  ok(auditData.total > 0, `audit recorded ${auditData.total} events`);
  const acts = new Set((auditData.logs as { action: string }[]).map((l) => l.action));
  for (const a of ["order.created", "order.status_changed", "order.paid", "menu.created", "auth.staff_login", "auth.customer_login", "settings.updated"]) {
    ok(acts.has(a), `audit captured ${a}`);
  }
  const anonAudit = await new Client().fetch("/api/admin/audit");
  ok(anonAudit.status === 403, "audit viewer is admin-only → 403 for anon");

  // ---------- cleanup ----------
  section("Cleanup");
  const del = await admin.fetch(`/api/menu/${testItem.id}`, { method: "DELETE" });
  ok(del.status === 200, "test menu item deleted");

  // ---------- summary ----------
  console.log(`\n${"=".repeat(48)}`);
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("Failures:");
    for (const f of fails) console.log("  - " + f);
    process.exit(1);
  } else {
    console.log("✅ All end-to-end checks passed.");
  }
}

main().catch((e) => {
  console.error("E2E crashed:", e);
  process.exit(1);
});
