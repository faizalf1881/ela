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

  // ---------- Customer OTP ----------
  section("Customer WhatsApp OTP login");
  const phone = "9" + String(Date.now()).slice(-9); // unique 10-digit
  const reqOtp = await new Client().fetch("/api/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) });
  ok(reqOtp.status === 200, "request OTP → 200");
  const code = await readOtp("91" + phone);
  ok(!!code, `OTP captured from server log (${code})`);

  const customer = new Client();
  const badVerify = await customer.fetch("/api/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, code: "000000" }) });
  ok(badVerify.status === 400, "wrong OTP → 400");
  const verify = await customer.fetch("/api/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, code, name: "E2E Customer" }) });
  ok(verify.status === 200, "correct OTP → 200 (logged in)");

  // ---------- Razorpay order + verify ----------
  section("Order + Razorpay create + signature verify");
  const orderItems = [
    { id: discounted!.id, qty: 2 },
    { id: menu.find((m) => m.id !== discounted!.id)!.id, qty: 1 },
  ];
  const orderRes = await customer.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ items: orderItems, name: "E2E Customer", phone: "+91" + phone, address: "1 Test St, Kochi 682001", paymentMethod: "razorpay" }),
  });
  const orderData = await orderRes.json();
  ok(orderRes.status === 200, `create razorpay order → 200 ${orderRes.status !== 200 ? JSON.stringify(orderData) : ""}`);
  ok(!!orderData.razorpay?.orderId?.startsWith("order_"), "Razorpay order_id returned");
  ok(orderData.order.discountTotal > 0, `discount applied (saved ₹${orderData.order?.discountTotal})`);

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
    body: JSON.stringify({ items: [{ id: testItem.id, qty: 3 }], name: "E2E", phone: "+91" + phone, address: "1 Test St", paymentMethod: "cod" }),
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
    body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "E2E", phone: "+91" + phone, address: "1 Test St", paymentMethod: "cod" }),
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
