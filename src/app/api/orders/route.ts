import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { razorpay } from "@/lib/razorpay";
import { effectivePrice } from "@/lib/pricing";
import { finalizeOrder } from "@/lib/fulfillment";
import { notifyOrderStatus, notifyNewOrderToAdmin } from "@/lib/notify";
import { audit, actorFrom } from "@/lib/audit";
import { evaluateCoupon } from "@/lib/coupon";

export const runtime = "nodejs";

const bodySchema = z.object({
  items: z.array(z.object({ id: z.string(), qty: z.number().int().min(1).max(50) })).min(1),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(6).max(20),
  deliveryLocationId: z.string().trim().min(1),
  couponCode: z.string().trim().max(40).optional(),
  paymentMethod: z.enum(["razorpay", "cod"]).default("razorpay"),
});

// GET /api/orders — customer: own orders; staff/admin: all orders.
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;

  const where =
    s.role === "customer"
      ? { customerId: s.sub }
      : status
        ? { status: status as never }
        : {};

  const orders = await prisma.order.findMany({
    where,
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ orders });
}

// POST /api/orders — customer places an order; creates a Razorpay order when paying online.
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "customer") {
    return NextResponse.json({ error: "Please log in to place an order." }, { status: 401 });
  }

  // Store open/closed guard.
  const setting = await prisma.storeSetting.findUnique({ where: { id: 1 } });
  if (setting && !setting.acceptingOrders) {
    return NextResponse.json(
      { error: setting.closedMessage || "We're not accepting orders right now. Please check back soon." },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid order details" }, { status: 400 });
  }
  const { items, name, phone, deliveryLocationId, couponCode, paymentMethod } = parsed.data;

  // Delivery location must exist and be active — it sets the delivery fee & address.
  const location = await prisma.deliveryLocation.findFirst({ where: { id: deliveryLocationId, active: true } });
  if (!location) {
    return NextResponse.json({ error: "Please choose a valid delivery location." }, { status: 400 });
  }
  const address = location.area ? `${location.name}, ${location.area}` : location.name;

  // Recompute prices & validate stock from the DB — never trust the client.
  const ids = items.map((i) => i.id);
  const menu = await prisma.menuItem.findMany({ where: { id: { in: ids }, available: true } });
  const menuById = new Map(menu.map((m) => [m.id, m]));

  const lineItems: { menuItemId: string; name: string; mrp: number; price: number; qty: number }[] = [];
  for (const i of items) {
    const m = menuById.get(i.id);
    if (!m) continue;
    if (m.stock !== null && m.stock < i.qty) {
      return NextResponse.json(
        { error: m.stock <= 0 ? `“${m.name}” is sold out.` : `Only ${m.stock} × “${m.name}” left.` },
        { status: 409 },
      );
    }
    lineItems.push({
      menuItemId: m.id,
      name: m.name,
      mrp: m.price,
      price: effectivePrice(m.price, m.discountPercent),
      qty: i.qty,
    });
  }

  if (lineItems.length === 0) {
    return NextResponse.json({ error: "None of the selected items are available." }, { status: 400 });
  }

  const subtotal = lineItems.reduce((n, i) => n + i.price * i.qty, 0);
  const discountTotal = lineItems.reduce((n, i) => n + (i.mrp - i.price) * i.qty, 0);
  const deliveryFee = subtotal > 0 ? location.deliveryFee : 0;

  // Coupon — re-validated server-side against the live subtotal (never trust the client).
  let couponDiscount = 0;
  let appliedCode: string | null = null;
  if (couponCode) {
    const cr = await evaluateCoupon(couponCode, subtotal);
    if (!cr.ok) return NextResponse.json({ error: cr.error }, { status: 400 });
    couponDiscount = cr.discount;
    appliedCode = cr.code;
  }

  const total = Math.max(0, subtotal - couponDiscount) + deliveryFee;

  if (total < 1) {
    return NextResponse.json({ error: "Order total too low." }, { status: 400 });
  }

  const created = await prisma.order.create({
    data: {
      customerId: s.sub,
      customerName: name,
      customerPhone: phone,
      address,
      deliveryLocationId: location.id,
      subtotal,
      discountTotal,
      couponCode: appliedCode,
      couponDiscount,
      deliveryFee,
      total,
      paymentMethod,
      status: paymentMethod === "cod" ? "PLACED" : "PENDING",
      paymentStatus: "UNPAID",
      items: { create: lineItems },
    },
    include: { items: true },
  });

  // Count the redemption once the order exists.
  if (appliedCode) {
    await prisma.coupon.update({ where: { code: appliedCode }, data: { usedCount: { increment: 1 } } }).catch(() => {});
  }

  await audit({
    actor: actorFrom(s),
    action: "order.created",
    entityType: "order",
    entityId: created.id,
    summary: `Order placed (₹${total}, ${paymentMethod})`,
    metadata: { total, subtotal, discountTotal, couponCode: appliedCode, couponDiscount, deliveryFee, location: location.name, paymentMethod, items: lineItems.map((i) => ({ name: i.name, qty: i.qty, price: i.price })) },
    req,
  });

  // Cash on delivery — finalize immediately (invoice + stock).
  if (paymentMethod === "cod") {
    const order = await finalizeOrder(created.id);
    await notifyOrderStatus(order);
    await notifyNewOrderToAdmin(order);
    return NextResponse.json({ order, paymentMethod: "cod" });
  }

  // Online payment — create a Razorpay order (amount in paise).
  try {
    const rp = await razorpay().orders.create({
      amount: total * 100,
      currency: "INR",
      receipt: created.id,
      notes: { orderId: created.id, customer: phone },
    });

    await prisma.order.update({ where: { id: created.id }, data: { razorpayOrderId: rp.id } });

    return NextResponse.json({
      order: created,
      paymentMethod: "razorpay",
      razorpay: {
        orderId: rp.id,
        amount: rp.amount,
        currency: rp.currency,
        keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      },
    });
  } catch (e) {
    const msg = String((e as { error?: { description?: string } })?.error?.description || e);
    const authError = /authentication|unauthorized|key_id|invalid api key/i.test(msg);
    await prisma.order.delete({ where: { id: created.id } }).catch(() => {});
    // eslint-disable-next-line no-console
    console.error("[Razorpay] create order failed:", msg);
    return NextResponse.json(
      { error: authError ? "Payment gateway auth failed." : "Could not start payment. Try again." },
      { status: authError ? 401 : 500 },
    );
  }
}
