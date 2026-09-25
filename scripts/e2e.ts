/**
 * End-to-end test — drives the running app over HTTP across all roles.
 * Run:  npm run build && npm start  (in one shell), then  npm run test:e2e
 * Or use scripts/run-e2e.ps1 which orchestrates both.
 */
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

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
/**
 * Razorpay's mandate-authorisation screen is hosted and can't be scripted, so we
 * activate a membership directly in the DB — everything after this point (benefit
 * pricing, CRM, cancellation) still goes through the real HTTP API.
 */
async function activateMembershipForTest(customerId: string, planId: string): Promise<boolean> {
  const prisma = new PrismaClient();
  try {
    const renews = new Date();
    renews.setMonth(renews.getMonth() + 1);
    await prisma.subscription.create({
      data: {
        customerId,
        planId,
        status: "ACTIVE",
        razorpaySubscriptionId: "sub_e2e_" + crypto.randomBytes(6).toString("hex"),
        startedAt: new Date(),
        currentEnd: renews,
        charges: { create: { amount: 499, razorpayPaymentId: "pay_e2e_" + crypto.randomBytes(6).toString("hex") } },
      },
    });
    return true;
  } catch (e) {
    console.log("    ! could not activate test membership:", (e as Error).message.split("\n")[0]);
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

/** Attach an ACTIVE meal-plan subscription so the generator has something to do. */
async function activateMealPlanForTest(customerId: string, planId: string, locationId: string, slotId: string | undefined, startKey: string, endKey: string | null): Promise<string | null> {
  const prisma = new PrismaClient();
  try {
    const renews = new Date();
    renews.setMonth(renews.getMonth() + 1);
    const sub = await prisma.subscription.create({
      data: {
        customerId,
        planId,
        status: "ACTIVE",
        razorpaySubscriptionId: "sub_meal_" + crypto.randomBytes(6).toString("hex"),
        startedAt: new Date(),
        currentEnd: renews,
        deliveryLocationId: locationId,
        deliverySlotId: slotId ?? null,
        startDate: new Date(`${startKey}T00:00:00.000Z`),
        endDate: endKey ? new Date(`${endKey}T00:00:00.000Z`) : null,
      },
    });
    return sub.id;
  } catch (e) {
    console.log("    ! could not attach meal plan:", (e as Error).message.split("\n")[0]);
    return null;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * A scan within a few seconds of the last status change is treated as a double
 * read. Tests step through the workflow faster than a kitchen would, so they age
 * the last change instead of sleeping.
 */
async function ageStatusChange(orderId: string) {
  const prisma = new PrismaClient();
  try {
    await prisma.order.update({ where: { id: orderId }, data: { statusChangedAt: new Date(Date.now() - 60_000) } });
  } finally {
    await prisma.$disconnect();
  }
}

/** A tiny valid 16-bit mono WAV — stands in for the restaurant's alert sound. */
function tinyWav(): Uint8Array {
  const samples = 800;
  const dataLen = samples * 2;
  const b = Buffer.alloc(44 + dataLen);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + dataLen, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(Math.sin(i / 4) * 8000), 44 + i * 2);
  return new Uint8Array(b);
}

/**
 * Stand-in for the WhatsApp Cloud API. The app under test is started with
 * WHATSAPP_API_BASE pointing here, so no real message can ever be sent.
 * `wa.mode` makes it fail the way the real API does.
 */
type WaCall = { url: string; body: { to?: string; type?: string; text?: { body?: string }; template?: { name?: string; components?: { parameters?: { text?: string }[] }[] } } };
const wa = { calls: [] as WaCall[], mode: "ok" as "ok" | "fail-auth" | "fail-template" | "fail-window", next: 1 };
type AiCall = { url: string; body: { model?: string; messages?: { role: string; content: string }[]; format?: string; response_format?: unknown } };
const ai = { calls: [] as AiCall[], mode: "ok" as "ok" | "fail" };

/** Scripted model: hands off on "refund", otherwise answers normally (so the keyword safety net can be tested). */
function fakeAiAnswer(body: AiCall["body"]): string {
  const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";
  if (/ping/.test(lastUser)) return JSON.stringify({ reply: "pong" });
  if (/refund/i.test(lastUser)) return JSON.stringify({ reply: "I'm sorry about that. A team member will take over here shortly.", handoff: true, reason: "Refund request" });
  return JSON.stringify({ reply: `Thanks! (AI) You said: ${lastUser.slice(0, 40)}`, handoff: false, reason: "" });
}
const WA_APP_SECRET = process.env.E2E_WA_APP_SECRET || "e2e-app-secret";
const WA_VERIFY_TOKEN = process.env.E2E_WA_VERIFY_TOKEN || "e2e-verify";

function startFakeWhatsApp(port = 4010): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: WaCall["body"] = {};
      try {
        body = JSON.parse(raw);
      } catch {}
      const send = (status: number, obj: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      // OpenAI-compatible and Ollama chat endpoints.
      if (req.url?.startsWith("/v1/chat/completions") || req.url?.startsWith("/api/chat")) {
        const aiBody = body as unknown as AiCall["body"];
        ai.calls.push({ url: req.url, body: aiBody });
        if (ai.mode === "fail") return send(500, { error: { message: "The model server had an error" } });
        const content = fakeAiAnswer(aiBody);
        return req.url.startsWith("/api/chat")
          ? send(200, { model: aiBody.model, message: { role: "assistant", content }, done: true })
          : send(200, { choices: [{ index: 0, message: { role: "assistant", content } }] });
      }
      wa.calls.push({ url: req.url || "", body });
      if (wa.mode === "fail-auth") return send(401, { error: { message: "Authentication Error", type: "OAuthException", code: 190 } });
      if (wa.mode === "fail-template" && body.type === "template") return send(404, { error: { message: "(#132001) Template name does not exist in the translation", code: 132001 } });
      if (wa.mode === "fail-window" && body.type === "text") {
        return send(400, { error: { message: "(#131047) Re-engagement message", code: 131047, error_data: { details: "More than 24 hours have passed since the customer last replied." } } });
      }
      send(200, { messaging_product: "whatsapp", contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: `wamid.E2E${wa.next++}` }] });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/** Signs a webhook body the way Meta does (X-Hub-Signature-256). */
function waSign(raw: string) {
  return "sha256=" + crypto.createHmac("sha256", WA_APP_SECRET).update(raw).digest("hex");
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 6000): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  return null;
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

  /** Same as fetch() but never forces a content-type — required for FormData uploads. */
  async fetchRaw(pathname: string, opts: RequestInit = {}) {
    const headers = new Headers(opts.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    return fetch(BASE + pathname, { ...opts, headers, redirect: "manual" });
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
  const waServer = await startFakeWhatsApp();

  // ---------- Public menu ----------
  section("Public menu");
  const menuRes = await new Client().fetch("/api/menu");
  const menu = (await menuRes.json()).items as { id: string; name: string; price: number; discountPercent: number }[];
  ok(menuRes.status === 200, "GET /api/menu → 200");
  ok(menu.length >= 5, `menu has ${menu.length} items (>=5)`);
  const discounted = menu.find((m) => m.discountPercent > 0);
  ok(!!discounted, "at least one discounted item exists");

  // ---------- Branding ----------
  section("Branding (new logo)");
  const homeHtml = await (await new Client().fetch("/")).text();
  ok(homeHtml.includes("brand%2Fela-logo.png") || homeHtml.includes("/brand/ela-logo.png"), "site header uses the new logo");
  ok(!homeHtml.includes("ela-logo.jpeg"), "old logo is no longer referenced");
  const oldLogo = await new Client().fetch("/ela-logo.jpeg");
  ok(oldLogo.status === 404, "old logo file is retired");
  const favicon = await new Client().fetch("/icon.png");
  ok(favicon.status === 200 && (favicon.headers.get("content-type") || "").includes("image/png"), "favicon is the new emblem");
  const manifest = await (await new Client().fetch("/manifest.webmanifest")).json();
  ok(manifest.icons?.some((i: { src: string; purpose?: string }) => i.purpose === "maskable"), "install icon includes a maskable variant");
  const staffLoginHtml = await (await new Client().fetch("/staff/login")).text();
  ok(staffLoginHtml.includes("brand%2Fela-logo.png") || staffLoginHtml.includes("/brand/ela-logo.png"), "admin login shows the new logo");

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

  // Slots are seeded, so every order below must carry a delivery date + slot.
  const availEarly = await (await new Client().fetch(`/api/delivery/availability?locationId=${locationId}`)).json();
  const sched: { deliveryDate?: string; deliverySlotId?: string } =
    availEarly.days?.[0]?.slots?.[0]
      ? { deliveryDate: availEarly.days[0].date, deliverySlotId: availEarly.days[0].slots[0].id }
      : {};

  // ---------- Razorpay order + verify ----------
  section("Order + Razorpay create + signature verify");
  const orderItems = [
    { id: discounted!.id, qty: 2 },
    { id: menu.find((m) => m.id !== discounted!.id)!.id, qty: 1 },
  ];
  const orderRes = await customer.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ items: orderItems, name: "E2E Customer", phone: "+91" + phone, deliveryLocationId: locationId, ...sched, couponCode, paymentMethod: "razorpay" }),
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
    body: JSON.stringify({ items: [{ id: testItem.id, qty: 3 }], name: "E2E", phone: "+91" + phone, deliveryLocationId: locationId, ...sched, paymentMethod: "cod" }),
  });
  const cod = await codRes.json();
  ok(codRes.status === 200 && cod.paymentMethod === "cod", "COD order placed → 200");
  ok(!!cod.order?.invoiceNo, "COD order has invoice immediately");
  const after = ((await (await admin.fetch("/api/menu?all=1")).json()).items as { id: string; stock: number | null }[]).find((m) => m.id === testItem.id);
  ok((before?.stock ?? 0) - (after?.stock ?? 0) === 3, `stock decremented 3 (${before?.stock} → ${after?.stock})`);

  // ---------- Kitchen status flow ----------
  section("Kitchen updates status");
  const st1 = await kitchen.fetch(`/api/orders/${dbOrderId}/status`, { method: "PATCH", body: JSON.stringify({ status: "OUT_FOR_DELIVERY" }) });
  ok(st1.status === 200, "kitchen → Out for delivery (200)");
  const st2 = await kitchen.fetch(`/api/orders/${dbOrderId}/status`, { method: "PATCH", body: JSON.stringify({ status: "DELIVERED" }) });
  ok((await st2.json()).order?.status === "DELIVERED", "kitchen → Delivered");
  const custStatus = await customer.fetch(`/api/orders/${dbOrderId}/status`, { method: "PATCH", body: JSON.stringify({ status: "PLACED" }) });
  ok(custStatus.status === 403, "customer cannot change status → 403");

  // ---------- Store open/close ----------
  section("Store open/close");
  await admin.fetch("/api/settings", { method: "PATCH", body: JSON.stringify({ acceptingOrders: false }) });
  const closedOrder = await customer.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "E2E", phone: "+91" + phone, deliveryLocationId: locationId, ...sched, paymentMethod: "cod" }),
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

  // Printed label: QR + order id + delivery essentials, but never a (soon stale) status.
  const labelRes = await kitchen.fetch(`/orders/${dbOrderId}/label`);
  const labelHtml = await labelRes.text();
  ok(labelRes.status === 200 && labelHtml.includes("<svg"), "delivery label renders with its QR code");
  ok(labelHtml.includes(dbOrderId.slice(-6).toUpperCase()), "label shows the order id");
  ok(labelHtml.includes("/brand/ela-logo.png"), "label carries the new logo");
  ok(
    !/Order confirmed|Preparing|On the way|Out for delivery|Delivered|Cancelled|Awaiting payment|Status/.test(labelHtml),
    "label shows no order status",
  );

  // ---------- QR scan moves the order to its next step (#38) ----------
  section("QR scan advances the order");
  const scanAdv = (code: string, c: Client = kitchen) =>
    c.fetch("/api/orders/scan", { method: "POST", body: JSON.stringify({ code, advance: true }) });
  const scanOrderId: string = cod.order.id;

  const adv1 = await scanAdv(scanOrderId);
  const a1 = await adv1.json();
  ok(adv1.status === 200 && a1.from === "PLACED" && a1.to === "PREPARING", "scan moves Confirmed → Preparing");
  ok(typeof a1.message === "string" && a1.message.includes("Preparing"), `scan returns a confirmation ("${a1.message}")`);

  const dup = await scanAdv(scanOrderId);
  const dupJ = await dup.json();
  ok(dup.status === 409 && dupJ.duplicate === true, "immediate re-read of the same label is ignored");
  const afterDup = await (await admin.fetch(`/api/orders/${scanOrderId}`)).json();
  ok(afterDup.order?.status === "PREPARING", "the double read did not skip a step");

  await ageStatusChange(scanOrderId);
  const adv2 = await (await scanAdv(scanOrderId.slice(-6))).json();
  ok(adv2.to === "OUT_FOR_DELIVERY", "next scan (short code) → Out for delivery");
  await ageStatusChange(scanOrderId);
  const adv3 = await (await scanAdv(cod.order.invoiceNo)).json();
  ok(adv3.to === "DELIVERED", "next scan (invoice number) → Delivered");
  await ageStatusChange(scanOrderId);
  const adv4 = await scanAdv(scanOrderId);
  const a4 = await adv4.json();
  ok(adv4.status === 409 && a4.final === true && /final/i.test(a4.error), "Delivered is final — further scans are refused");

  const unknownScan = await scanAdv("zzzznotanorder");
  ok(unknownScan.status === 404 && /No order/.test((await unknownScan.json()).error), "unknown QR → 404 with a clear message");
  const custAdv = await scanAdv(scanOrderId, customer);
  ok(custAdv.status === 403, "customers cannot advance orders → 403");

  const scanAudit = await (await admin.fetch(`/api/admin/audit?action=order.status_changed&q=${scanOrderId}`)).json();
  ok(scanAudit.logs.filter((l: { summary: string }) => /QR scan/.test(l.summary)).length === 3, "each scan step is in the audit trail");

  // Workflow is configurable by the admin.
  const kGet = await kitchen.fetch("/api/admin/settings");
  ok(kGet.status === 200 && (await kGet.json()).scanSteps?.length === 4, "kitchen can read the scan workflow");
  const kPatch = await kitchen.fetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ scanSteps: ["PLACED", "DELIVERED"] }) });
  ok(kPatch.status === 403, "only admins can change the scan workflow → 403");
  const custGet = await customer.fetch("/api/admin/settings");
  ok(custGet.status === 403, "customers cannot read staff settings → 403");
  const wf = await admin.fetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ scanSteps: ["OUT_FOR_DELIVERY"] }) });
  const wfJ = await wf.json();
  ok(
    wf.status === 200 && JSON.stringify(wfJ.scanSteps) === JSON.stringify(["PLACED", "OUT_FOR_DELIVERY", "DELIVERED"]),
    "admin skips Preparing (Confirmed and Delivered are always kept)",
  );

  const cod2 = await (
    await customer.fetch("/api/orders", {
      method: "POST",
      body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "E2E", phone: "+91" + phone, deliveryLocationId: locationId, ...sched, paymentMethod: "cod" }),
    })
  ).json();
  const skip = await (await scanAdv(cod2.order.id)).json();
  ok(skip.from === "PLACED" && skip.to === "OUT_FOR_DELIVERY", "configured workflow goes Confirmed → Out for delivery");
  await admin.fetch("/api/admin/settings", {
    method: "PATCH",
    body: JSON.stringify({ scanSteps: ["PLACED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"] }),
  });

  // Orders outside the fulfilment path can't be moved by a scan.
  const cancelIt = await kitchen.fetch(`/api/orders/${cod2.order.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "CANCELLED" }) });
  ok(cancelIt.status === 200, "order cancelled from the board");
  await ageStatusChange(cod2.order.id);
  const scanCancelled = await scanAdv(cod2.order.id);
  ok(scanCancelled.status === 409 && /cancelled/.test((await scanCancelled.json()).error), "cancelled order is not advanced");
  const sameAgain = await (await kitchen.fetch(`/api/orders/${cod2.order.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "CANCELLED" }) })).json();
  ok(sameAgain.changed === false, "re-selecting the same status is a no-op (no duplicate customer message)");

  const pend = await (
    await customer.fetch("/api/orders", {
      method: "POST",
      body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "E2E", phone: "+91" + phone, deliveryLocationId: locationId, ...sched, paymentMethod: "razorpay" }),
    })
  ).json();
  const scanPending = await scanAdv(pend.order.id);
  ok(scanPending.status === 409 && /payment/.test((await scanPending.json()).error), "unpaid order is not advanced");

  // ---------- Memberships / subscriptions ----------
  section("Memberships (plans + benefits)");
  const planRes = await admin.fetch("/api/plans", {
    method: "POST",
    body: JSON.stringify({
      name: "E2E Gold",
      description: "Test plan",
      price: 499,
      interval: "MONTHLY",
      discountPercent: 10,
      freeDelivery: true,
      benefits: ["Free delivery", "Priority kitchen"],
      active: true,
    }),
  });
  const planJson = await planRes.json();
  ok(planRes.status === 201, `admin creates plan → 201 ${planRes.status !== 201 ? JSON.stringify(planJson) : ""}`);
  const planId: string = planJson.plan.id;
  const rzpLinked = Boolean(planJson.plan.razorpayPlanId);
  console.log(`    ${rzpLinked ? "·" : "!"} Razorpay plan link: ${rzpLinked ? planJson.plan.razorpayPlanId : "NOT linked (Subscriptions likely disabled on the account)"}`);

  const pubPlans = await (await new Client().fetch("/api/plans")).json();
  ok(pubPlans.plans.some((p: { id: string }) => p.id === planId), "active plan is public");
  const custPlan = await customer.fetch("/api/plans", { method: "POST", body: JSON.stringify({ name: "Nope", price: 1 }) });
  ok(custPlan.status === 403, "customer cannot create plans → 403");

  // No membership yet → member pricing must NOT apply.
  const preMe = await (await customer.fetch("/api/auth/me")).json();
  ok(preMe.membership?.active === false, "customer has no active membership yet");

  // Simulate an activated membership directly in the DB (Razorpay's hosted mandate
  // screen can't be automated), then re-check that benefits apply server-side.
  const activated = await activateMembershipForTest(crmMe.id, planId);
  ok(activated, "test membership activated in DB");

  const memberMe = await (await customer.fetch("/api/auth/me")).json();
  ok(memberMe.membership?.active === true && memberMe.membership?.discountPercent === 10, "session reports active membership + benefits");

  const memberOrder = await customer.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "E2E Member", phone: "+91" + phone, deliveryLocationId: locationId, ...sched, paymentMethod: "cod" }),
  });
  const mo = await memberOrder.json();
  ok(memberOrder.status === 200, "member places order → 200");
  ok(mo.order?.membershipDiscount > 0, `member discount applied (−₹${mo.order?.membershipDiscount})`);
  ok(mo.order?.deliveryFee === 0, "member gets free delivery");
  ok(
    mo.order?.total === mo.order?.subtotal - mo.order?.membershipDiscount - mo.order?.couponDiscount + mo.order?.deliveryFee,
    "member total = subtotal − member discount − coupon + delivery",
  );

  const subsList = await (await customer.fetch("/api/subscriptions")).json();
  ok(subsList.subscriptions?.length > 0, "customer sees own subscription");
  const subId: string = subsList.subscriptions[0].id;

  const dupSub = await customer.fetch("/api/subscriptions", { method: "POST", body: JSON.stringify({ planId }) });
  ok(dupSub.status === 409 || dupSub.status === 503, "cannot double-subscribe while active");

  const crmSub = await (await admin.fetch("/api/admin/crm")).json();
  const crmRow = crmSub.customers.find((c: { id: string }) => c.id === crmMe.id);
  ok(crmRow?.subscriptionStatus === "ACTIVE" && crmRow?.planName === "E2E Gold", "CRM shows subscription status + plan");
  ok(!!crmRow?.renewsAt, "CRM shows renewal date");

  // Webhook must reject an unsigned/forged body.
  const badHook = await new Client().fetch("/api/webhooks/razorpay", {
    method: "POST",
    body: JSON.stringify({ event: "subscription.charged", payload: {} }),
  });
  ok(badHook.status === 400, "unsigned Razorpay webhook rejected → 400");

  const cancelled = await customer.fetch(`/api/subscriptions/${subId}/cancel`, { method: "POST" });
  ok(cancelled.status === 200, "customer cancels membership → 200");
  const afterCancel = await (await customer.fetch("/api/auth/me")).json();
  ok(afterCancel.membership?.active === false, "benefits stop after cancellation");

  // A plan with billing history must be hidden, not hard-deleted (keeps history intact).
  const planDel = await admin.fetch(`/api/plans/${planId}`, { method: "DELETE" });
  const pd = await planDel.json();
  ok(planDel.status === 200, `remove plan with history → 200 ${planDel.status !== 200 ? JSON.stringify(pd) : ""}`);
  ok(pd.deactivated === true && pd.plan?.active === false, "plan with subscriptions is hidden, not deleted");
  const afterDel = await (await new Client().fetch("/api/plans")).json();
  ok(!afterDel.plans.some((p: { id: string }) => p.id === planId), "hidden plan no longer offered publicly");

  // A brand-new plan with no subscribers is safe to hard-delete.
  const throwaway = await admin.fetch("/api/plans", { method: "POST", body: JSON.stringify({ name: "E2E Temp", price: 99, interval: "MONTHLY" }) });
  const tId = (await throwaway.json()).plan.id;
  const tDel = await admin.fetch(`/api/plans/${tId}`, { method: "DELETE" });
  ok(tDel.status === 200 && (await tDel.json()).ok === true, "unused plan is hard-deleted");

  // ---------- Pre-order: delivery date + time slots (#34) ----------
  section("Pre-order delivery scheduling");
  const avail = await (await new Client().fetch(`/api/delivery/availability?locationId=${locationId}`)).json();
  ok(Array.isArray(avail.days), "availability returns a list of days");
  ok(avail.days.length > 0, `${avail.days.length} delivery day(s) offered`);
  ok(typeof avail.cutoffMinutes === "number", `cut-off exposed (${avail.cutoffMinutes} min past midnight)`);
  const firstDay = avail.days[0];
  ok(firstDay.slots.length > 0, `first day has ${firstDay?.slots?.length} slot(s)`);

  // Same-day is only allowed before the cut-off.
  const todayOffered = avail.days.some((d: { isToday: boolean }) => d.isToday);
  ok(avail.cutoffPassed ? !todayOffered : true, avail.cutoffPassed ? "after cut-off: same-day withdrawn" : "before cut-off: same-day may be offered");

  // Scheduling is required once slots exist.
  const noSchedule = await customer.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "E2E", phone: "+91" + phone, deliveryLocationId: locationId, paymentMethod: "cod" }),
  });
  ok(noSchedule.status === 400, "order without a date/slot is rejected → 400");

  const badSlot = await customer.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "E2E", phone: "+91" + phone, deliveryLocationId: locationId, deliveryDate: firstDay.date, deliverySlotId: "does-not-exist", paymentMethod: "cod" }),
  });
  ok(badSlot.status === 409, "unknown slot rejected → 409");

  const pastDate = await customer.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "E2E", phone: "+91" + phone, deliveryLocationId: locationId, deliveryDate: "2020-01-01", deliverySlotId: firstDay.slots[0].id, paymentMethod: "cod" }),
  });
  ok(pastDate.status === 409, "past delivery date rejected → 409");

  const scheduled = await customer.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "E2E", phone: "+91" + phone, deliveryLocationId: locationId, deliveryDate: firstDay.date, deliverySlotId: firstDay.slots[0].id, paymentMethod: "cod" }),
  });
  const sch = await scheduled.json();
  ok(scheduled.status === 200, "scheduled order accepted");
  ok(String(sch.order?.deliveryDate ?? "").startsWith(firstDay.date), "order stores the chosen delivery date");
  ok(sch.order?.deliverySlotId === firstDay.slots[0].id, "order stores the chosen slot");

  // Admin closes that slot for that date; it must disappear and be refused.
  const blocked = await admin.fetch(`/api/slots/${firstDay.slots[0].id}`, { method: "PATCH", body: JSON.stringify({ block: { date: firstDay.date, reason: "capacity" } }) });
  ok(blocked.status === 200, "admin closes a slot for one date");
  const avail2 = await (await new Client().fetch(`/api/delivery/availability?locationId=${locationId}`)).json();
  const day2 = avail2.days.find((d: { date: string }) => d.date === firstDay.date);
  ok(!day2 || !day2.slots.some((sl: { id: string }) => sl.id === firstDay.slots[0].id), "closed slot no longer offered");
  const afterBlock = await customer.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "E2E", phone: "+91" + phone, deliveryLocationId: locationId, deliveryDate: firstDay.date, deliverySlotId: firstDay.slots[0].id, paymentMethod: "cod" }),
  });
  ok(afterBlock.status === 409, "ordering into a closed slot is refused → 409");

  const unblocked = await admin.fetch(`/api/slots/${firstDay.slots[0].id}`, { method: "PATCH", body: JSON.stringify({ unblock: { date: firstDay.date } }) });
  ok(unblocked.status === 200, "admin reopens the slot");

  const custSlot = await customer.fetch("/api/slots", { method: "POST", body: JSON.stringify({ label: "hack", startMinutes: 60, endMinutes: 120 }) });
  ok(custSlot.status === 403, "customers cannot create slots → 403");
  const badRange = await admin.fetch("/api/slots", { method: "POST", body: JSON.stringify({ label: "bad", startMinutes: 600, endMinutes: 500 }) });
  ok(badRange.status === 400, "end-before-start slot rejected → 400");

  // ---------- Cash on Delivery controls (#24 / #25) ----------
  section("Cash on Delivery controls");
  const codOff = await admin.fetch("/api/settings", { method: "PATCH", body: JSON.stringify({ codEnabled: false }) });
  ok(codOff.status === 200 && (await codOff.json()).codEnabled === false, "admin turns COD OFF");

  const pubSettings = await (await new Client().fetch("/api/settings")).json();
  ok(pubSettings.codEnabled === false, "checkout sees COD as unavailable");

  const codBlocked = await customer.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "E2E", phone: "+91" + phone, deliveryLocationId: locationId, deliveryDate: firstDay.date, deliverySlotId: firstDay.slots[0].id, paymentMethod: "cod" }),
  });
  ok(codBlocked.status === 403, "COD order rejected server-side while disabled → 403");

  const codOn = await admin.fetch("/api/settings", { method: "PATCH", body: JSON.stringify({ codEnabled: true, codConfirmAmount: 40 }) });
  const codOnJson = await codOn.json();
  ok(codOn.status === 200 && codOnJson.codEnabled === true && codOnJson.codConfirmAmount === 40, "admin re-enables COD with a Rs.40 confirmation amount");

  const codPartial = await customer.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "E2E", phone: "+91" + phone, deliveryLocationId: locationId, deliveryDate: firstDay.date, deliverySlotId: firstDay.slots[0].id, paymentMethod: "cod" }),
  });
  const cp = await codPartial.json();
  ok(codPartial.status === 200, "COD order with confirmation amount accepted");
  ok(cp.paymentMethod === "cod_confirm", "flow switches to online confirmation payment");
  ok(cp.codConfirmAmount === 40, "charges exactly the configured Rs.40 now");
  ok(cp.razorpay?.amount === 4000, "Razorpay is charged 4000 paise (Rs.40), not the full total");
  ok(cp.codBalanceDue === cp.order.total - 40, "balance due in cash = total - confirmation");
  ok(cp.order.status === "PENDING" && !cp.order.invoiceNo, "order waits for the confirmation payment before it is placed");

  const zeroConfirm = await admin.fetch("/api/settings", { method: "PATCH", body: JSON.stringify({ codConfirmAmount: 0 }) });
  ok(zeroConfirm.status === 200, "admin clears the confirmation amount");
  const plainCod = await customer.fetch("/api/orders", {
    method: "POST",
    body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "E2E", phone: "+91" + phone, deliveryLocationId: locationId, deliveryDate: firstDay.date, deliverySlotId: firstDay.slots[0].id, paymentMethod: "cod" }),
  });
  const pc = await plainCod.json();
  ok(plainCod.status === 200 && pc.paymentMethod === "cod", "plain COD still works when no confirmation amount is set");
  ok(!!pc.order.invoiceNo && pc.order.status === "PLACED", "plain COD is placed and invoiced immediately");

  const custSettings = await customer.fetch("/api/settings", { method: "PATCH", body: JSON.stringify({ codEnabled: false }) });
  ok(custSettings.status === 403, "customers cannot change COD settings → 403");

  // ---------- Uploads (menu photos + complaint attachments) ----------
  section("File uploads");
  // 1x1 transparent PNG
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const pngBlob = new Blob([new Uint8Array(PNG)], { type: "image/png" });

  const menuFd = new FormData();
  menuFd.append("kind", "menu");
  menuFd.append("file", pngBlob, "dish.png");
  const upMenu = await admin.fetchRaw("/api/uploads", { method: "POST", body: menuFd });
  const upMenuJson = await upMenu.json();
  ok(upMenu.status === 201, `admin uploads dish photo → 201 ${upMenu.status !== 201 ? JSON.stringify(upMenuJson) : ""}`);
  const menuUrl: string = upMenuJson.files?.[0]?.url ?? "";
  ok(/^\/api\/media\//.test(menuUrl), "upload returns a media URL");

  const publicImg = await new Client().fetch(menuUrl);
  ok(publicImg.status === 200 && publicImg.headers.get("content-type") === "image/png", "menu photo is publicly served");

  const custMenuFd = new FormData();
  custMenuFd.append("kind", "menu");
  custMenuFd.append("file", pngBlob, "x.png");
  const custMenuUp = await customer.fetchRaw("/api/uploads", { method: "POST", body: custMenuFd });
  ok(custMenuUp.status === 403, "customer cannot upload menu photos → 403");

  const badFd = new FormData();
  badFd.append("kind", "menu");
  badFd.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "application/zip" }), "bad.zip");
  const badUp = await admin.fetchRaw("/api/uploads", { method: "POST", body: badFd });
  ok(badUp.status === 415, "disallowed file type rejected → 415");

  // Attach a photo to a complaint, then check privacy.
  const tFd = new FormData();
  tFd.append("kind", "ticket");
  tFd.append("file", pngBlob, "evidence.png");
  const upTicket = await customer.fetchRaw("/api/uploads", { method: "POST", body: tFd });
  const ticketUrl: string = (await upTicket.json()).files?.[0]?.url ?? "";
  ok(upTicket.status === 201 && !!ticketUrl, "customer uploads complaint evidence → 201");

  const anonMedia = await new Client().fetch(ticketUrl);
  ok(anonMedia.status === 401, "complaint attachment is private to anonymous → 401");

  const tWithFile = await customer.fetch("/api/tickets", {
    method: "POST",
    body: JSON.stringify({ category: "Delivery Issue", subject: "Attachment test", body: "Photo attached.", attachments: [ticketUrl] }),
  });
  const twf = await tWithFile.json();
  ok(tWithFile.status === 201, "complaint created with attachment");
  ok(twf.ticket?.messages?.[0]?.attachments?.[0] === ticketUrl, "attachment stored on the message");

  const ownerMedia = await customer.fetch(ticketUrl);
  ok(ownerMedia.status === 200, "owner can open their own attachment");
  const staffMedia = await admin.fetch(ticketUrl);
  ok(staffMedia.status === 200, "staff can open complaint attachments");

  // ---------- Ticket assignment ----------
  section("Ticket assignment");
  const staffList = await (await admin.fetch("/api/staff")).json();
  const assignee = staffList.staff?.[0];
  ok(!!assignee, "kitchen staff available to assign");
  const assign = await admin.fetch(`/api/tickets/${ticketId}`, { method: "PATCH", body: JSON.stringify({ assignedToId: assignee.id }) });
  ok(assign.status === 200 && (await assign.json()).ticket?.assignedToId === assignee.id, "admin assigns ticket to staff");
  const custAssign = await customer.fetch(`/api/tickets/${ticketId}`, { method: "PATCH", body: JSON.stringify({ assignedToId: assignee.id }) });
  ok(custAssign.status === 403, "customer cannot assign tickets → 403");

  // ---------- Reports: Excel / CSV / PDF ----------
  section("Reports & exports");
  for (const t of ["orders", "invoices", "customers", "subscriptions", "complaints", "analytics", "menu", "coupons"]) {
    const xr = await admin.fetch(`/api/admin/export?type=${t}&format=xlsx`);
    const ct = xr.headers.get("content-type") || "";
    ok(xr.status === 200 && ct.includes("spreadsheetml"), `${t}: Excel export → 200 xlsx`);
  }
  const xlsxBody = await (await admin.fetch("/api/admin/export?type=orders&format=xlsx")).arrayBuffer();
  const sig = Buffer.from(xlsxBody.slice(0, 2)).toString("hex");
  ok(sig === "504b" && xlsxBody.byteLength > 1000, `xlsx is a real workbook (${xlsxBody.byteLength} bytes)`);

  const csvRes = await admin.fetch("/api/admin/export?type=invoices&format=csv");
  const csvText = await csvRes.text();
  ok(csvRes.status === 200 && csvText.includes("Invoice"), "CSV export returns data");
  ok((csvRes.headers.get("content-disposition") || "").includes(".csv"), "CSV downloads as a file");

  const badReport = await admin.fetch("/api/admin/export?type=nonsense&format=csv");
  ok(badReport.status === 400, "unknown report type → 400");
  const custReport = await customer.fetch("/api/admin/export?type=orders&format=csv");
  ok(custReport.status === 403, "exports are admin-only → 403");

  const pdfView = await admin.fetch("/admin/reports/analytics");
  ok(pdfView.status === 200, "PDF/print report view renders (analytics)");

  // Subscription charges must surface in Accounts as "Subscription".
  const accWithSubs = await (await admin.fetch("/api/admin/accounts")).json();
  ok(
    accWithSubs.invoices.some((i: { paymentType: string }) => i.paymentType === "Subscription"),
    "membership charges appear in Accounts as Subscription",
  );

  // ---------- Automated meal-plan ordering (#29-#32) ----------
  section("Meal plans: automated daily orders");
  const today = new Date().toISOString().slice(0, 10);
  const allDays = [0, 1, 2, 3, 4, 5, 6];

  const mealPlanRes = await admin.fetch("/api/plans", {
    method: "POST",
    body: JSON.stringify({
      name: "E2E Veg Meal Plan",
      description: "Daily veg meal",
      price: 2400,
      interval: "MONTHLY",
      kind: "MEAL",
      serviceDays: allDays, // every day, so the test is not weekday-dependent
      durationDays: 30,
      mealItems: [{ menuItemId: menu[1].id, qty: 1 }],
      active: true,
    }),
  });
  const mealPlan = (await mealPlanRes.json()).plan;
  ok(mealPlanRes.status === 201, "admin creates an auto-ordering meal plan → 201");
  ok(mealPlan?.kind === "MEAL" && mealPlan?.mealItems?.length === 1, "plan stores its dish list");

  const noDishes = await admin.fetch("/api/plans", {
    method: "POST",
    body: JSON.stringify({ name: "E2E Empty", price: 100, interval: "MONTHLY", kind: "MEAL", mealItems: [] }),
  });
  ok(noDishes.status === 400, "meal plan without dishes rejected → 400");

  const mealSubId = await activateMealPlanForTest(crmMe.id, mealPlan.id, locationId, sched.deliverySlotId, today, null);
  ok(!!mealSubId, "meal-plan subscription activated for the test customer");

  const gen1 = await admin.fetch(`/api/cron/meal-plans?date=${today}`, { method: "POST" });
  const g1 = await gen1.json();
  ok(gen1.status === 200, "generator runs → 200");
  ok(g1.created.length >= 1, `generated ${g1.created.length} meal order(s)`);

  const gen2 = await admin.fetch(`/api/cron/meal-plans?date=${today}`, { method: "POST" });
  const g2 = await gen2.json();
  ok(g2.created.length === 0, "second run creates nothing (no duplicate for the same day)");
  ok(g2.skipped.some((x: { reason: string }) => x.reason === "already generated"), "duplicate is explicitly skipped");

  const allOrders = await (await admin.fetch("/api/orders")).json();
  const autoOrder = allOrders.orders.find((o: { subscriptionId?: string | null }) => o.subscriptionId === mealSubId);
  ok(!!autoOrder, "generated order is visible on the Orders board");
  ok(autoOrder?.source === "subscription", "order is tagged as a subscription order");
  ok(autoOrder?.status === "PLACED" && !!autoOrder?.invoiceNo, "auto order is placed and invoiced for the kitchen");
  ok(autoOrder?.total === 0 && autoOrder?.paymentStatus === "PAID", "auto order is prepaid (zero balance)");
  ok(autoOrder?.discountTotal === 0, "prepaid meal is not recorded as a discount (keeps discount reports honest)");

  // Prepaid zero-value orders must not distort the sales figures.
  const anaWith = await (await admin.fetch("/api/admin/analytics?range=daily")).json();
  ok(
    !anaWith.series.some((b: { orders: number; revenue: number }) => b.orders > 0 && b.revenue === 0) || anaWith.summary.avgOrder > 0,
    "analytics average order value is not dragged to zero by prepaid meals",
  );
  ok(String(autoOrder?.deliveryDate ?? "").startsWith(today), "auto order carries the service date");

  // Lifecycle: a cancelled subscription stops generating.
  const cancelSub = await admin.fetch(`/api/subscriptions/${mealSubId}/cancel`, { method: "POST" });
  ok(cancelSub.status === 200, "admin cancels the meal subscription");
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const gen3 = await admin.fetch(`/api/cron/meal-plans?date=${tomorrow}`, { method: "POST" });
  const g3 = await gen3.json();
  ok(g3.created.length === 0, "cancelled subscription generates no further orders");

  // Non-service days are respected.
  const mealSubId2 = await activateMealPlanForTest(crmMe.id, mealPlan.id, locationId, sched.deliverySlotId, today, null);
  ok(!!mealSubId2, "second meal subscription activated");
  const onlyOneDay = await admin.fetch(`/api/plans/${mealPlan.id}`, { method: "PATCH", body: JSON.stringify({ serviceDays: [] }) });
  ok(onlyOneDay.status === 200, "admin clears the plan's service days");
  const dayAfter = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const gen4 = await admin.fetch(`/api/cron/meal-plans?date=${dayAfter}`, { method: "POST" });
  const g4 = await gen4.json();
  ok(g4.created.length === 0, "no orders on a non-service day");
  ok(g4.skipped.some((x: { reason: string }) => x.reason === "not a service day"), "non-service day is the recorded reason");

  // A closed store pauses the automatic run, but an admin can still override.
  const closeForMeals = await admin.fetch("/api/settings", { method: "PATCH", body: JSON.stringify({ acceptingOrders: false }) });
  ok(closeForMeals.status === 200, "store closed for the holiday test");
  const mealSubId3 = await activateMealPlanForTest(crmMe.id, mealPlan.id, locationId, sched.deliverySlotId, today, null);
  ok(!!mealSubId3, "third meal subscription activated");
  await admin.fetch(`/api/plans/${mealPlan.id}`, { method: "PATCH", body: JSON.stringify({ serviceDays: allDays }) });

  // Customer-side validation of meal-plan delivery details (runs before any billing).
  const subscribeMeal = (extra: Record<string, unknown>) =>
    customer.fetch("/api/subscriptions", { method: "POST", body: JSON.stringify({ planId: mealPlan.id, ...extra }) });
  const noLoc = await subscribeMeal({});
  ok(noLoc.status === 400 && /delivered/.test((await noLoc.json()).error), "meal plan without a delivery area → 400");
  const badLoc = await subscribeMeal({ deliveryLocationId: "nope" });
  ok(badLoc.status === 400, "meal plan with an unknown delivery area → 400");
  const badMealSlot = await subscribeMeal({ deliveryLocationId: locationId, deliverySlotId: "nope" });
  ok(badMealSlot.status === 400, "meal plan with an unknown delivery time → 400");
  const pastStart = await subscribeMeal({ deliveryLocationId: locationId, startDate: "2020-01-01" });
  ok(pastStart.status === 400, "meal plan starting in the past → 400");
  const validMeal = await subscribeMeal({ deliveryLocationId: locationId, deliverySlotId: sched.deliverySlotId, startDate: tomorrow });
  ok([409, 503].includes(validMeal.status), "valid meal details pass validation (then blocked only by the existing membership)");
  await admin.fetch(`/api/plans/${planId}`, { method: "PATCH", body: JSON.stringify({ active: true }) });
  const discountIgnoresLoc = await customer.fetch("/api/subscriptions", {
    method: "POST",
    body: JSON.stringify({ planId, deliveryLocationId: "nope" }),
  });
  ok([409, 503].includes(discountIgnoresLoc.status), "discount plans ignore delivery fields instead of rejecting them");
  await admin.fetch(`/api/plans/${planId}`, { method: "PATCH", body: JSON.stringify({ active: false }) });

  const closedRun = await admin.fetch(`/api/cron/meal-plans?date=${dayAfter}`, { method: "POST" });
  const cr = await closedRun.json();
  ok(cr.storeClosed === true, "closed store holds back the scheduled generation");
  ok(cr.created.length === 0, "no meal orders created while the store is closed");

  const forcedRun = await admin.fetch(`/api/cron/meal-plans?date=${dayAfter}&force=1`, { method: "POST" });
  const fr = await forcedRun.json();
  ok(!fr.storeClosed && fr.created.length >= 1, "admin can generate anyway for prepaid subscribers");

  await admin.fetch("/api/settings", { method: "PATCH", body: JSON.stringify({ acceptingOrders: true }) });

  const anonCron = await new Client().fetch("/api/cron/meal-plans", { method: "POST" });
  ok(anonCron.status === 401, "generator is not publicly triggerable → 401");
  const custCron = await customer.fetch("/api/cron/meal-plans", { method: "POST" });
  ok(custCron.status === 401, "customers cannot trigger the generator → 401");

  // ---------- New-order alerts + sound (#48–#51) ----------
  section("New-order alerts and sound");
  const anonAlerts = await new Client().fetch("/api/orders/alerts");
  ok(anonAlerts.status === 401, "alert feed needs a login → 401");
  const custAlerts = await customer.fetch("/api/orders/alerts");
  ok(custAlerts.status === 403, "customers cannot read the alert feed → 403");
  const base = await kitchen.fetch("/api/orders/alerts");
  const baseJ = await base.json();
  ok(base.status === 200 && baseJ.baseline === true && !!baseJ.now, "kitchen starts listening (baseline + server clock)");

  const since = baseJ.now as string;
  const alertCod = await (
    await customer.fetch("/api/orders", {
      method: "POST",
      body: JSON.stringify({ items: [{ id: menu[0].id, qty: 2 }], name: "Alert Test", phone: "+91" + phone, deliveryLocationId: locationId, ...sched, paymentMethod: "cod" }),
    })
  ).json();
  const feed1 = await (await kitchen.fetch(`/api/orders/alerts?since=${encodeURIComponent(since)}`)).json();
  const hit = feed1.orders.find((o: { id: string }) => o.id === alertCod.order.id);
  ok(!!hit, "a newly placed COD order appears in the alert feed");
  ok(
    hit?.customerName === "Alert Test" && hit?.items?.[0]?.qty === 2 && !!hit?.deliveryLocation?.name && !!hit?.placedAt,
    "alert carries customer, items, delivery location and placed time",
  );

  const rzpAlert = await (
    await customer.fetch("/api/orders", {
      method: "POST",
      body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "Alert Online", phone: "+91" + phone, deliveryLocationId: locationId, ...sched, paymentMethod: "razorpay" }),
    })
  ).json();
  const feed2 = await (await kitchen.fetch(`/api/orders/alerts?since=${encodeURIComponent(since)}`)).json();
  ok(!feed2.orders.some((o: { id: string }) => o.id === rzpAlert.order.id), "an unpaid online checkout does not alert");
  const alertPay = "pay_alert_" + crypto.randomBytes(5).toString("hex");
  await customer.fetch("/api/payments/verify", {
    method: "POST",
    body: JSON.stringify({ razorpay_order_id: rzpAlert.razorpay.orderId, razorpay_payment_id: alertPay, razorpay_signature: sign(rzpAlert.razorpay.orderId, alertPay) }),
  });
  const feed3 = await (await kitchen.fetch(`/api/orders/alerts?since=${encodeURIComponent(since)}`)).json();
  ok(feed3.orders.some((o: { id: string }) => o.id === rzpAlert.order.id), "it alerts once the payment is verified");

  const dayFeed = await (await admin.fetch(`/api/orders/alerts?since=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}`)).json();
  const boardAll = (await (await admin.fetch("/api/orders")).json()).orders as { id: string; source: string }[];
  const sourceOf = new Map(boardAll.map((o) => [o.id, o.source]));
  ok(
    dayFeed.orders.length > 0 && dayFeed.orders.every((o: { id: string }) => sourceOf.get(o.id) === "web"),
    "meal-plan and manual orders never trigger the new-order alert",
  );

  // Alert sound: uploaded by the admin, stored as-is, public for the customer chime.
  const wav = tinyWav();
  const soundFd = new FormData();
  soundFd.append("kind", "sound");
  soundFd.append("file", new Blob([wav], { type: "audio/wav" }), "ela-order.wav");
  const upSound = await admin.fetchRaw("/api/uploads", { method: "POST", body: soundFd });
  const upSoundJ = await upSound.json();
  ok(upSound.status === 201, `admin uploads the alert sound → 201 ${upSound.status !== 201 ? JSON.stringify(upSoundJ) : ""}`);
  const soundUrl: string = upSoundJ.files?.[0]?.url ?? "";

  const custSoundFd = new FormData();
  custSoundFd.append("kind", "sound");
  custSoundFd.append("file", new Blob([wav], { type: "audio/wav" }), "x.wav");
  ok((await customer.fetchRaw("/api/uploads", { method: "POST", body: custSoundFd })).status === 403, "customers cannot upload alert sounds → 403");
  const txtFd = new FormData();
  txtFd.append("kind", "sound");
  txtFd.append("file", new Blob([new Uint8Array([104, 105])], { type: "text/plain" }), "not-audio.txt");
  ok((await admin.fetchRaw("/api/uploads", { method: "POST", body: txtFd })).status === 415, "non-audio file rejected as a sound → 415");

  const setSound = await admin.fetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ orderSoundUrl: soundUrl }) });
  const setSoundJ = await setSound.json();
  ok(setSound.status === 200 && setSoundJ.orderAlert?.customSound?.name === "ela-order.wav", "admin selects the uploaded sound");
  const kitchenCfg = await (await kitchen.fetch("/api/admin/settings")).json();
  ok(kitchenCfg.orderAlert?.soundUrl === soundUrl, "kitchen screens receive the new sound");
  const pubCfg = await (await new Client().fetch("/api/settings")).json();
  ok(pubCfg.orderSoundUrl === soundUrl, "the customer confirmation uses the same sound");

  const soundRes = await new Client().fetch(soundUrl);
  const soundBytes = new Uint8Array(await soundRes.arrayBuffer());
  ok(
    soundRes.status === 200 && soundRes.headers.get("content-type") === "audio/wav" && soundBytes.length === wav.length && soundBytes.every((b, i) => b === wav[i]),
    "sound is served publicly, byte-for-byte as uploaded",
  );
  const ranged = await new Client().fetch(soundUrl, { headers: { range: "bytes=0-3" } });
  ok(
    ranged.status === 206 && ranged.headers.get("content-range") === `bytes 0-3/${wav.length}` && (await ranged.arrayBuffer()).byteLength === 4,
    "byte ranges supported (needed for iPhone Safari playback)",
  );

  const wrongKind = await admin.fetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ orderSoundUrl: menuUrl }) });
  ok(wrongKind.status === 400, "an image cannot be chosen as the alert sound → 400");
  const tooShort = await admin.fetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ orderAlertSeconds: 1 }) });
  ok(tooShort.status === 400, "alert duration below 3s rejected");
  const secs = await (await admin.fetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ orderAlertSeconds: 12 }) })).json();
  ok(secs.orderAlert?.seconds === 12, "admin sets how long the full-screen alert stays up");
  const kSound = await kitchen.fetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ orderSoundUrl: null }) });
  ok(kSound.status === 403, "kitchen cannot change the alert sound → 403");

  const reset = await (await admin.fetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ orderSoundUrl: null }) })).json();
  ok(reset.orderAlert?.customSound === null && reset.orderAlert?.soundUrl === "/sounds/order-chime.wav", "reset to the built-in chime");
  const chime = await new Client().fetch("/sounds/order-chime.wav");
  ok(chime.status === 200 && (chime.headers.get("content-type") || "").includes("audio"), "built-in chime is served");
  const pubCfg2 = await (await new Client().fetch("/api/settings")).json();
  ok(pubCfg2.orderSoundUrl === "/sounds/order-chime.wav", "customer confirmation falls back to the chime too");
  await admin.fetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ orderAlertSeconds: 8 }) }); // leave the default

  // ---------- WhatsApp order updates + log (#45/#46) ----------
  section("WhatsApp order updates and log");
  type Note = { id: string; orderId: string; toStatus: string; fromStatus: string | null; status: string; messageType: string | null; templateName: string | null; waMessageId: string | null; deliveryStatus: string | null; error: string | null; attempts: number; body: string; response: unknown };
  const notesFor = async (orderId: string): Promise<Note[]> => (await (await admin.fetch(`/api/admin/notifications?orderId=${orderId}`)).json()).notifications;
  const noteFor = (orderId: string, to: string) => waitFor(async () => (await notesFor(orderId)).find((n) => n.toStatus === to && n.status !== "PENDING"));
  const placeCod = async (qty = 1) =>
    (
      await (
        await customer.fetch("/api/orders", {
          method: "POST",
          body: JSON.stringify({ items: [{ id: menu[0].id, qty }], name: "E2E Customer", phone: "+91" + phone, deliveryLocationId: locationId, ...sched, paymentMethod: "cod" }),
        })
      ).json()
    ).order as { id: string; invoiceNo: string };
  const setStatus = (id: string, status: string) => kitchen.fetch(`/api/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });

  const waCfg = (await (await admin.fetch("/api/admin/settings")).json()).notify;
  ok(waCfg?.configured === true && waCfg.statuses.length === 5, "WhatsApp is connected (test stand-in) with all five updates on");

  wa.mode = "ok";
  const nOrder = await placeCod();
  const placedNote = await noteFor(nOrder.id, "PLACED");
  ok(placedNote?.status === "SENT" && !!placedNote.waMessageId && placedNote.messageType === "text", "placing an order sends the 'confirmed' update (logged as sent)");
  const placedCall = wa.calls.find((c) => c.body.text?.body?.includes(nOrder.id.slice(-6).toUpperCase()));
  ok(!!placedCall && placedCall.body.to === "91" + phone && /Order confirmed/.test(placedCall.body.text?.body ?? ""), "it goes to the customer's own WhatsApp number");

  const prep = await setStatus(nOrder.id, "PREPARING");
  ok(prep.status === 200, "kitchen moves the order to Preparing");
  const prepNote = await noteFor(nOrder.id, "PREPARING");
  ok(prepNote?.status === "SENT" && prepNote.fromStatus === "PLACED", "status change triggers an update, recording previous → new status");
  ok(Array.isArray(prepNote?.response) && (prepNote?.response as unknown[]).length === 1, "the WhatsApp API response is stored");

  const sameAgain2 = await setStatus(nOrder.id, "PREPARING");
  await sleep(600);
  ok(sameAgain2.status === 200 && (await notesFor(nOrder.id)).filter((n) => n.toStatus === "PREPARING").length === 1, "no message when the status did not actually change");

  // Webhook: verification handshake + signed delivery receipts.
  const verifyOk = await new Client().fetch(`/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${WA_VERIFY_TOKEN}&hub.challenge=12345`);
  ok(verifyOk.status === 200 && (await verifyOk.text()) === "12345", "webhook verification handshake answers Meta's challenge");
  const verifyBad = await new Client().fetch(`/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`);
  ok(verifyBad.status === 403, "wrong verify token → 403");
  const receipt = (status: string, id: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", statuses: [{ id, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: "91" + phone, ...extra }] } }] }],
    });
  const postHook = (raw: string, sig?: string) =>
    new Client().fetch("/api/webhooks/whatsapp", { method: "POST", body: raw, headers: sig ? { "x-hub-signature-256": sig } : {} });
  const unsigned = await postHook(receipt("delivered", prepNote!.waMessageId!));
  ok(unsigned.status === 401, "unsigned webhook events are rejected → 401");
  const forged = await postHook(receipt("delivered", prepNote!.waMessageId!), "sha256=" + "0".repeat(64));
  ok(forged.status === 401, "wrongly signed webhook events are rejected → 401");
  const dRaw = receipt("delivered", prepNote!.waMessageId!);
  const delivered = await postHook(dRaw, waSign(dRaw));
  ok(delivered.status === 200 && (await delivered.json()).receipts === 1, "signed 'delivered' receipt accepted");
  const rRaw = receipt("read", prepNote!.waMessageId!);
  await postHook(rRaw, waSign(rRaw));
  const lateRaw = receipt("delivered", prepNote!.waMessageId!);
  await postHook(lateRaw, waSign(lateRaw));
  const readNote = (await notesFor(nOrder.id)).find((n) => n.toStatus === "PREPARING");
  ok(readNote?.deliveryStatus === "read", "delivery → read receipts recorded (a late 'delivered' does not undo 'read')");

  // A failed message never rolls the order back; it is logged for follow-up.
  wa.mode = "fail-auth";
  const out = await setStatus(nOrder.id, "OUT_FOR_DELIVERY");
  ok(out.status === 200 && (await out.json()).order?.status === "OUT_FOR_DELIVERY", "status still changes when WhatsApp is down");
  const failedNote = await noteFor(nOrder.id, "OUT_FOR_DELIVERY");
  ok(failedNote?.status === "FAILED" && /access token/i.test(failedNote.error || ""), `failure logged with a reason staff can act on ("${failedNote?.error?.slice(0, 48)}…")`);
  const orderAfterFail = await (await admin.fetch(`/api/orders/${nOrder.id}`)).json();
  ok(orderAfterFail.order?.status === "OUT_FOR_DELIVERY", "order remains Out for delivery after the failed message");
  const failedList = await (await admin.fetch("/api/admin/notifications?status=FAILED")).json();
  ok(failedList.failed24h >= 1 && failedList.notifications.some((n: Note) => n.id === failedNote?.id), "failed updates are listed for admin follow-up");
  const boardNow = (await (await kitchen.fetch("/api/orders")).json()).orders.find((o: { id: string }) => o.id === nOrder.id);
  ok(boardNow?.notifications?.[0]?.status === "FAILED", "the Orders board shows the failed update on the order");
  const custOrders = (await (await customer.fetch("/api/orders")).json()).orders.find((o: { id: string }) => o.id === nOrder.id);
  ok(custOrders && custOrders.notifications === undefined, "customers never see the internal message log");

  wa.mode = "ok";
  const retried = await kitchen.fetch(`/api/admin/notifications/${failedNote!.id}/retry`, { method: "POST" });
  const retriedJ = await retried.json();
  ok(retried.status === 200 && retriedJ.notification?.status === "SENT" && retriedJ.notification.attempts === 2, "retry sends it once WhatsApp is back (2 attempts recorded)");
  const retryAgain = await admin.fetch(`/api/admin/notifications/${failedNote!.id}/retry`, { method: "POST" });
  ok(retryAgain.status === 409, "an update that was sent cannot be sent twice → 409");

  const fRaw = receipt("failed", retriedJ.notification.waMessageId, { errors: [{ code: 131026, title: "Message undeliverable" }] });
  await postHook(fRaw, waSign(fRaw));
  const undeliv = (await notesFor(nOrder.id)).find((n) => n.id === failedNote!.id);
  ok(undeliv?.status === "FAILED" && undeliv.deliveryStatus === "failed" && /131026/.test(undeliv.error || ""), "a 'failed' delivery receipt flags the update for follow-up");

  // Admin controls: which statuses notify, and their wording.
  await admin.fetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ notifyStatuses: ["PLACED", "PREPARING", "OUT_FOR_DELIVERY", "CANCELLED"] }) });
  await setStatus(nOrder.id, "DELIVERED");
  await sleep(900);
  ok(!(await notesFor(nOrder.id)).some((n) => n.toStatus === "DELIVERED"), "a status switched off in Settings sends nothing");
  await admin.fetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ notifyStatuses: ["PLACED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"] }) });

  const custom = await admin.fetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ notifyMessages: { PREPARING: "Hi {name}! {order} is on the stove ({total})." } }) });
  ok(custom.status === 200 && (await custom.json()).notify.custom.PREPARING?.includes("on the stove"), "admin saves custom wording");
  const o2 = await placeCod(2);
  await noteFor(o2.id, "PLACED");
  await setStatus(o2.id, "PREPARING");
  const customNote = await noteFor(o2.id, "PREPARING");
  ok(customNote?.body === `Hi E2E! #${o2.id.slice(-6).toUpperCase()} is on the stove (₹${(await (await admin.fetch(`/api/orders/${o2.id}`)).json()).order.total.toLocaleString("en-IN")}).`, `custom wording with details filled in ("${customNote?.body}")`);
  await admin.fetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ notifyMessages: { PREPARING: null } }) });

  const badTpl = await admin.fetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ waStatusTemplate: "Order Update!" }) });
  ok(badTpl.status === 400, "invalid template name rejected → 400");
  await admin.fetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ waStatusTemplate: "order_status_update", waStatusTemplateLang: "en" }) });
  wa.calls.length = 0;
  await setStatus(o2.id, "OUT_FOR_DELIVERY");
  const tplNote = await noteFor(o2.id, "OUT_FOR_DELIVERY");
  const tplCall = wa.calls.find((c) => c.body.type === "template");
  const tplParams = tplCall?.body.template?.components?.[0]?.parameters?.map((x) => x.text) ?? [];
  ok(tplNote?.messageType === "template" && tplNote.templateName === "order_status_update", "with a template configured, the approved template is used");
  ok(tplParams[0] === "E2E" && tplParams[1] === `#${o2.id.slice(-6).toUpperCase()}` && !!tplParams[2] && !tplParams[2].includes("\n"), "template gets name, order number and a one-line message");

  wa.mode = "fail-template";
  await setStatus(o2.id, "DELIVERED");
  const fbNote = await noteFor(o2.id, "DELIVERED");
  ok(fbNote?.status === "SENT" && fbNote.messageType === "text" && (fbNote.response as unknown[]).length === 2, "if the template is rejected, it falls back to a plain message (both attempts logged)");
  await admin.fetch("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ waStatusTemplate: null }) });

  wa.mode = "fail-window";
  const o3 = await placeCod();
  const windowNote = await noteFor(o3.id, "PLACED");
  ok(windowNote?.status === "FAILED" && /24 hours/.test(windowNote.error || ""), "outside the 24-hour window (no template) the reason is explained");
  wa.mode = "ok";

  const custLog = await customer.fetch("/api/admin/notifications");
  ok(custLog.status === 403, "customers cannot read the message log → 403");

  // Payment callbacks are idempotent: a repeated verify must not reset or re-notify.
  const pay = await (
    await customer.fetch("/api/orders", {
      method: "POST",
      body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "E2E Customer", phone: "+91" + phone, deliveryLocationId: locationId, ...sched, paymentMethod: "razorpay" }),
    })
  ).json();
  const payId = "pay_idem_" + crypto.randomBytes(5).toString("hex");
  const verifyBody = JSON.stringify({ razorpay_order_id: pay.razorpay.orderId, razorpay_payment_id: payId, razorpay_signature: sign(pay.razorpay.orderId, payId) });
  const v1 = await customer.fetch("/api/payments/verify", { method: "POST", body: verifyBody });
  ok(v1.status === 200, "payment verified");
  await noteFor(pay.order.id, "PLACED");
  await setStatus(pay.order.id, "PREPARING");
  const v2 = await customer.fetch("/api/payments/verify", { method: "POST", body: verifyBody });
  const v2j = await v2.json();
  ok(v2.status === 200 && v2j.alreadyVerified === true, "a repeated payment callback is acknowledged");
  const afterRepeat = await (await admin.fetch(`/api/orders/${pay.order.id}`)).json();
  ok(afterRepeat.order?.status === "PREPARING", "…without moving the order back to Confirmed");
  await sleep(600);
  ok((await notesFor(pay.order.id)).filter((n) => n.toStatus === "PLACED").length === 1, "…and without messaging the customer twice");
  const forgedPay = await customer.fetch("/api/payments/verify", {
    method: "POST",
    body: JSON.stringify({ razorpay_order_id: pay.razorpay.orderId, razorpay_payment_id: payId, razorpay_signature: "bad" }),
  });
  const afterForged = await (await admin.fetch(`/api/orders/${pay.order.id}`)).json();
  ok(forgedPay.status === 400 && afterForged.order?.paymentStatus === "PAID", "a bad signature can no longer mark a paid order as failed");

  // ---------- WhatsApp chat with AI / human handling (#39–#44) ----------
  section("WhatsApp chat: inbox, AI and human handling");
  const custPhone = "91" + phone;
  let inboundSeq = 0;
  const inbound = (from: string, text: string, opts: { id?: string; name?: string } = {}) => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "917907577979", phone_number_id: "100200300" },
                contacts: [{ profile: { name: opts.name ?? "Anjali WA" }, wa_id: from }],
                messages: [{ from, id: opts.id ?? `wamid.IN${Date.now()}${inboundSeq++}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
              },
            },
          ],
        },
      ],
    });
    return postHook(raw, waSign(raw));
  };
  type Conv = { id: string; phone: string; customerId: string | null; mode: string; state: string; unreadCount: number; attentionReason: string | null; handledByLabel: string | null; profileName: string | null };
  type ChatMsg = { id: string; sender: string; direction: string; body: string; status: string | null; waMessageId: string | null; staffLabel: string | null };
  const listConvs = async (qs = "") => (await (await admin.fetch(`/api/admin/whatsapp/conversations${qs}`)).json()) as { conversations: Conv[]; counts: Record<string, number> };
  const convByPhone = async (p: string) => (await listConvs()).conversations.find((c) => c.phone === p);
  const detail = async (id: string) =>
    (await (await admin.fetch(`/api/admin/whatsapp/conversations/${id}`)).json()) as {
      conversation: Conv;
      messages: ChatMsg[];
      events: { actorType: string; toMode: string; toState: string; reason: string | null }[];
      updates: { toStatus: string }[];
      context: { customer: { name: string } | null; orders: { ref: string }[] };
      replyWindow: { open: boolean };
    };
  const aiMsgs = async (id: string) => (await detail(id)).messages.filter((m) => m.sender === "AI");
  const convAction = (id: string, action: string, body?: unknown) =>
    admin.fetch(`/api/admin/whatsapp/conversations/${id}/${action}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });
  const lastPrompt = () => ai.calls[ai.calls.length - 1]?.body.messages ?? [];

  // Access: the inbox is admin-only.
  ok((await new Client().fetch("/api/admin/whatsapp/conversations")).status === 401, "inbox needs a login → 401");
  ok((await customer.fetch("/api/admin/whatsapp/conversations")).status === 403, "customers cannot open the inbox → 403");
  ok((await kitchen.fetch("/api/admin/whatsapp/conversations")).status === 403, "kitchen staff cannot open the inbox → 403");

  // A second customer, so privacy can be checked.
  const phone2 = "8" + String(Date.now()).slice(-9);
  await new Client().fetch("/api/auth/otp/request", { method: "POST", body: JSON.stringify({ phone: phone2, mode: "signup" }) });
  const other = new Client();
  await other.fetch("/api/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone: phone2, code: await readOtp("91" + phone2), name: "Zara Other" }) });
  const otherOrder = (
    await (
      await other.fetch("/api/orders", {
        method: "POST",
        body: JSON.stringify({ items: [{ id: menu[0].id, qty: 1 }], name: "Zara Other", phone: "+91" + phone2, deliveryLocationId: locationId, ...sched, paymentMethod: "cod" }),
      })
    ).json()
  ).order as { id: string };

  // AI off (the default): the message waits for a person.
  const firstId = `wamid.FIRST${Date.now()}`;
  const in1 = await inbound(custPhone, "Hi, is the Kerala meal available today?", { id: firstId });
  ok(in1.status === 200 && (await in1.json()).messages === 1, "incoming WhatsApp message accepted (signed webhook)");
  const conv = await waitFor(async () => {
    const c = await convByPhone(custPhone);
    return c?.state === "REQUIRES_ATTENTION" ? c : null;
  });
  ok(!!conv && conv.customerId === crmMe.id, "conversation created and linked to the right CRM customer");
  ok(conv?.unreadCount === 1 && conv.profileName === "Anjali WA", "shows as unread, with the WhatsApp profile name");
  ok(!!conv?.attentionReason && /turned off/i.test(conv.attentionReason), "with the AI off, it is flagged Requires attention");
  const dupeIn = await inbound(custPhone, "Hi, is the Kerala meal available today?", { id: firstId });
  ok((await dupeIn.json()).messages === 0 && (await detail(conv!.id)).messages.length === 1, "a redelivered webhook message is stored only once");

  // AI settings: provider, encrypted key (never returned), test connection.
  const aiKey = "sk-e2e-" + crypto.randomBytes(16).toString("hex");
  const badKey = await admin.fetch("/api/admin/ai", { method: "PATCH", body: JSON.stringify({ openaiKey: "not-a-key" }) });
  ok(badKey.status === 400, "a malformed API key is rejected");
  ok((await kitchen.fetch("/api/admin/ai", { method: "PATCH", body: JSON.stringify({ provider: "OPENAI" }) })).status === 403, "only admins configure the AI → 403");
  const setAi = await admin.fetch("/api/admin/ai", {
    method: "PATCH",
    body: JSON.stringify({ provider: "OPENAI", openaiKey: aiKey, openaiModel: "gpt-4o-mini", openaiBaseUrl: "http://127.0.0.1:4010/v1", instructions: "Mention that Friday is fish day." }),
  });
  const setAiJ = await setAi.json();
  ok(setAi.status === 200 && setAiJ.provider === "OPENAI" && setAiJ.keySource === "admin", "admin selects OpenAI and saves the key");
  ok(!JSON.stringify(setAiJ).includes(aiKey) && setAiJ.keyHint === `${aiKey.slice(0, 7)}…${aiKey.slice(-4)}`, "the key is never sent back — only a hint");
  const aiRowRaw = await (async () => {
    const pc = new PrismaClient();
    try {
      return await pc.aiSetting.findUnique({ where: { id: 1 } });
    } finally {
      await pc.$disconnect();
    }
  })();
  ok(!!aiRowRaw?.openaiKeyEnc?.startsWith("v1:") && !aiRowRaw.openaiKeyEnc.includes(aiKey.slice(7)), "the key is stored encrypted in the database");
  const aiTest = await (await admin.fetch("/api/admin/ai/test", { method: "POST" })).json();
  ok(aiTest.ok === true && aiTest.provider === "OpenAI gpt-4o-mini", "Test connection reaches the provider");

  // The AI answers, using this customer's own data only.
  ai.calls.length = 0;
  await inbound(custPhone, "What does my last order have?");
  const firstAi = await waitFor(async () => {
    const m = await aiMsgs(conv!.id);
    return m.length >= 1 && m[0].status !== "sending" ? m : null;
  });
  ok(!!firstAi && firstAi[0].status === "sent" && !!firstAi[0].waMessageId, "the AI replies through WhatsApp");
  ok(wa.calls.some((c) => c.body.to === custPhone && c.body.text?.body?.startsWith("Thanks! (AI)")), "the reply goes to the customer's WhatsApp");
  const sys = lastPrompt()[0]?.content ?? "";
  ok(sys.includes(`#${nOrder.id.slice(-6).toUpperCase()}`) && sys.includes(menu[0].name), "the AI sees this customer's orders and the live menu");
  ok(sys.includes("Friday is fish day"), "the admin's extra guidance reaches the AI");
  ok(!sys.includes("Zara Other") && !sys.includes(phone2) && !sys.includes(otherOrder.id.slice(-6).toUpperCase()), "no other customer's data is ever in the AI's context");
  ok(lastPrompt().some((m) => m.role === "user" && m.content.includes("Kerala meal available")), "earlier messages are passed as conversation history");
  ok((await convByPhone(custPhone))?.state === "AI_HANDLING", "state returns to AI handling after a good reply");

  // Two quick messages get one reply.
  const before2 = (await aiMsgs(conv!.id)).length;
  await inbound(custPhone, "hello");
  await inbound(custPhone, "are you open today?");
  await waitFor(async () => ((await aiMsgs(conv!.id)).length > before2 ? true : null));
  await sleep(1200);
  ok((await aiMsgs(conv!.id)).length === before2 + 1, "a burst of messages gets a single AI reply");

  // The AI hands over when it should.
  await inbound(custPhone, "I want a refund, the payment went twice");
  const handed = await waitFor(async () => {
    const c = await convByPhone(custPhone);
    return c?.mode === "HUMAN" ? c : null;
  });
  ok(handed?.state === "REQUIRES_ATTENTION" && handed.attentionReason === "Refund request", "refund request → AI hands over (Human mode, Requires attention)");
  const handoffEvent = (await detail(conv!.id)).events.find((e) => e.actorType === "ai" && e.toMode === "HUMAN");
  ok(!!handoffEvent && handoffEvent.reason === "Refund request", "the hand-over is recorded in the handling history");

  const aiBeforeHuman = (await aiMsgs(conv!.id)).length;
  await inbound(custPhone, "hello?? anyone there");
  await sleep(1500);
  const humanNow = await convByPhone(custPhone);
  ok((await aiMsgs(conv!.id)).length === aiBeforeHuman, "in Human mode the AI stays silent");
  ok(humanNow?.state === "REQUIRES_ATTENTION" && (humanNow?.unreadCount ?? 0) > 0, "…and the new message waits, unread, for staff");

  // Staff take over and reply through WhatsApp.
  const take = await convAction(conv!.id, "takeover");
  const takeJ = await take.json();
  ok(take.status === 200 && takeJ.conversation.state === "HUMAN_HANDLING" && takeJ.conversation.handledByLabel === ADMIN_USER, "staff take over (Human handling, by name)");
  const staffMsg = await convAction(conv!.id, "messages", { body: "Sorry about that! I've checked and started your refund." });
  const staffJ = await staffMsg.json();
  ok(staffMsg.status === 200 && staffJ.message.sender === "STAFF" && staffJ.message.staffLabel === ADMIN_USER, "staff reply is sent and recorded as Staff");
  ok(wa.calls.some((c) => c.body.text?.body === "Sorry about that! I've checked and started your refund."), "…through the WhatsApp API");
  const afterStaff = await convByPhone(custPhone);
  ok(afterStaff?.state === "WAITING_CUSTOMER" && afterStaff.unreadCount === 0, "after replying: Waiting for customer, marked read");
  await inbound(custPhone, "thank you!");
  const replied = await waitFor(async () => {
    const c = await convByPhone(custPhone);
    return c?.state === "HUMAN_HANDLING" ? c : null;
  });
  ok(!!replied, "customer replies → back to Human handling (staff's turn)");

  // Switch back to AI: history is kept and used.
  const back = await convAction(conv!.id, "handback");
  ok(back.status === 200 && (await back.json()).conversation.mode === "AI", "switch back to AI");
  const aiSend = await convAction(conv!.id, "messages", { body: "should not send" });
  ok(aiSend.status === 409, "staff can't type over the AI — take over first → 409");
  ai.calls.length = 0;
  await inbound(custPhone, "When will my order arrive?");
  await waitFor(async () => (ai.calls.length ? true : null));
  await sleep(600);
  ok(lastPrompt().some((m) => m.role === "assistant" && m.content.includes("[Team member] Sorry about that")), "the AI resumes with the whole conversation, including what staff said");

  // Repeated switching keeps everything.
  const msgCount = (await detail(conv!.id)).messages.length;
  for (const a of ["takeover", "handback", "takeover", "handback"]) await convAction(conv!.id, a);
  const afterSwitch = await detail(conv!.id);
  ok(afterSwitch.messages.length === msgCount && afterSwitch.conversation.mode === "AI", "AI → Human → AI → Human → AI loses no messages");
  ok(afterSwitch.events.filter((e) => e.actorType === "staff").length >= 6, "every switch is in the handling history");

  // Safety net: clear complaints always reach a person, even if the model misses it.
  await inbound(custPhone, "my food was late and cold");
  const forced = await waitFor(async () => {
    const c = await convByPhone(custPhone);
    return c?.mode === "HUMAN" ? c : null;
  });
  ok(!!forced && forced.state === "REQUIRES_ATTENTION" && /late/.test(forced.attentionReason || ""), "a complaint the model didn't flag is still handed to a person");
  const holding = (await aiMsgs(conv!.id)).pop();
  ok(!!holding && /team/i.test(holding.body) && !holding.body.startsWith("Thanks! (AI)"), "…with a safe holding reply instead of the model's answer");

  // Ollama works the same way.
  await admin.fetch("/api/admin/ai", { method: "PATCH", body: JSON.stringify({ provider: "OLLAMA", ollamaUrl: "http://127.0.0.1:4010", ollamaModel: "llama3.1" }) });
  await convAction(conv!.id, "handback");
  ai.calls.length = 0;
  await inbound(custPhone, "Do you deliver to Kowdiar?");
  await waitFor(async () => (ai.calls.some((c) => c.url.startsWith("/api/chat")) ? true : null));
  const ollamaReply = await waitFor(async () => ((await aiMsgs(conv!.id)).some((m) => m.body.includes("Kowdiar")) ? true : null));
  ok(!!ollamaReply && ai.calls.some((c) => c.url.startsWith("/api/chat") && c.body.model === "llama3.1" && c.body.format === "json"), "switching the provider to Ollama needs no code change");

  // Provider down: flagged, nothing half-sent.
  ai.mode = "fail";
  const aiBeforeFail = (await aiMsgs(conv!.id)).length;
  await inbound(custPhone, "is the payasam sweet?");
  const down = await waitFor(async () => {
    const c = await convByPhone(custPhone);
    return c?.state === "REQUIRES_ATTENTION" ? c : null;
  });
  ok(!!down && /couldn't reply/.test(down.attentionReason || "") && (await aiMsgs(conv!.id)).length === aiBeforeFail, "if the AI provider fails, the chat is flagged for a person");
  ai.mode = "ok";

  // Numbers that never signed up still get help, with no customer data.
  const stranger = "919999" + String(Date.now()).slice(-6);
  ai.calls.length = 0;
  await inbound(stranger, "Hello, do you cater for weddings?", { name: "Stranger" });
  const strangerConv = await waitFor(async () => {
    const c = await convByPhone(stranger);
    return c && (await aiMsgs(c.id)).length ? c : null;
  });
  ok(!!strangerConv && strangerConv.customerId === null, "an unknown number gets its own conversation, not linked to anyone");
  const strangerSys = lastPrompt()[0]?.content ?? "";
  ok(/not a registered customer/.test(strangerSys) && !strangerSys.includes("E2E Customer") && !strangerSys.includes(nOrder.id.slice(-6).toUpperCase()), "…and the AI sees no customer's records for it");

  // Delivery receipts for chat replies.
  const lastAi = (await aiMsgs(conv!.id)).filter((m) => m.waMessageId).pop()!;
  const cr1 = receipt("delivered", lastAi.waMessageId!);
  await postHook(cr1, waSign(cr1));
  const cr2 = receipt("read", lastAi.waMessageId!);
  await postHook(cr2, waSign(cr2));
  ok((await detail(conv!.id)).messages.find((m) => m.id === lastAi.id)?.status === "read", "chat replies show delivered/read receipts");

  // Staff view: CRM context, order updates, search, filters, read.
  const d = await detail(conv!.id);
  ok(d.context.customer?.name === "E2E Customer" && d.context.orders.length > 0, "staff see the customer's profile and recent orders beside the chat");
  ok(d.updates.length > 0 && d.replyWindow.open === true, "…the order updates sent to this number, and the 24-hour reply window");
  ok((await listConvs("?q=Anjali")).conversations.some((c) => c.id === conv!.id), "search by WhatsApp name");
  ok((await listConvs(`?q=${phone.slice(-5)}`)).conversations.some((c) => c.id === conv!.id), "search by phone number");
  ok((await listConvs("?q=payasam")).conversations.some((c) => c.id === conv!.id), "search by message text");
  const attn = await listConvs("?filter=attention");
  ok(attn.conversations.every((c) => c.state === "REQUIRES_ATTENTION") && (attn.counts.REQUIRES_ATTENTION ?? 0) >= 1, "filter: Requires attention (with counts)");
  await convAction(conv!.id, "read");
  ok((await convByPhone(custPhone))?.unreadCount === 0, "opening the chat clears its unread count");

  // WhatsApp's 24-hour rule is respected.
  await convAction(conv!.id, "takeover");
  await (async () => {
    const pc = new PrismaClient();
    try {
      await pc.waConversation.update({ where: { id: conv!.id }, data: { lastInboundAt: new Date(Date.now() - 2 * 86_400_000) } });
    } finally {
      await pc.$disconnect();
    }
  })();
  const late = await convAction(conv!.id, "messages", { body: "Hello?" });
  ok(late.status === 409 && /24 hours/.test((await late.json()).error), "outside the 24-hour window staff are told why a reply can't be sent");

  const summary = await (await admin.fetch("/api/admin/whatsapp/summary")).json();
  ok(typeof summary.attention === "number" && typeof summary.unread === "number", "nav badge summary");
  const aiAudit = await (await admin.fetch("/api/admin/audit?action=ai.settings_updated&limit=5")).json();
  ok(aiAudit.total > 0 && !JSON.stringify(aiAudit.logs).includes(aiKey), "AI settings changes are audited without the key");
  const hand = await (await admin.fetch("/api/admin/audit?action=whatsapp.takeover&limit=1")).json();
  ok(hand.total > 0, "takeovers are audited");

  // ---------- Concurrency: no overselling ----------
  section("Stock safety under concurrent orders");
  const scarce = await admin.fetch("/api/menu", {
    method: "POST",
    body: JSON.stringify({ name: "E2E Last Portion", price: 100, stock: 1, category: "Test" }),
  });
  const scarceItem = (await scarce.json()).item;

  // Five customers grab the last portion at the same instant.
  const rush = await Promise.all(
    Array.from({ length: 5 }, () =>
      customer.fetch("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          items: [{ id: scarceItem.id, qty: 1 }],
          name: "E2E",
          phone: "+91" + phone,
          deliveryLocationId: locationId,
          ...sched,
          paymentMethod: "cod",
        }),
      }),
    ),
  );
  const accepted = rush.filter((r) => r.status === 200).length;
  ok(accepted === 1, `only 1 of 5 simultaneous orders accepted for the last portion (got ${accepted})`);
  ok(rush.filter((r) => r.status === 409).length === 4, "the other four are refused with 409, not oversold");

  const afterRush = await (await new Client().fetch("/api/menu?all=1")).json();
  const scarceAfter = (await (await admin.fetch("/api/menu?all=1")).json()).items.find((i: { id: string }) => i.id === scarceItem.id);
  ok(scarceAfter?.stock === 0, `stock lands exactly on 0, never negative (got ${scarceAfter?.stock})`);
  void afterRush;

  await admin.fetch(`/api/menu/${scarceItem.id}`, { method: "DELETE" });

  // ---------- Audit trail ----------
  section("Audit trail");
  const auditRes = await admin.fetch("/api/admin/audit?limit=100");
  const auditData = await auditRes.json();
  ok(auditRes.status === 200, "GET /api/admin/audit → 200 (admin)");
  ok(auditData.total > 0, `audit recorded ${auditData.total} events`);
  for (const a of ["order.created", "order.status_changed", "order.paid", "menu.created", "auth.staff_login", "auth.customer_login", "settings.updated", "notification.retried"]) {
    const hit = await (await admin.fetch(`/api/admin/audit?action=${a}&limit=1`)).json();
    ok(hit.total > 0, `audit captured ${a}`);
  }
  const anonAudit = await new Client().fetch("/api/admin/audit");
  ok(anonAudit.status === 403, "audit viewer is admin-only → 403 for anon");

  // ---------- cleanup ----------
  section("Cleanup");
  const del = await admin.fetch(`/api/menu/${testItem.id}`, { method: "DELETE" });
  ok(del.status === 200, "test menu item deleted");

  waServer.close();

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
