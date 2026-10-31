import { NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { activeGateway, startOnlinePayment } from "@/lib/payments";
import { effectivePrice } from "@/lib/pricing";
import { orderTotals } from "@/lib/order-pricing";
import { finalizeOrder, OutOfStockError } from "@/lib/fulfillment";
import { notifyOrderStatus, notifyNewOrderToAdmin } from "@/lib/notify";
import { audit, actorFrom } from "@/lib/audit";
import { evaluateCoupon } from "@/lib/coupon";
import { getMembership } from "@/lib/membership";
import { assertSlotAvailable, toDbDate } from "@/lib/delivery";

export const runtime = "nodejs";

const bodySchema = z.object({
  items: z.array(z.object({ id: z.string(), qty: z.number().int().min(1).max(50) })).min(1),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(6).max(20),
  deliveryLocationId: z.string().trim().min(1),
  couponCode: z.string().trim().max(40).optional(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  deliverySlotId: z.string().trim().min(1).optional(),
  // "razorpay" is what older checkout pages send for "pay online".
  paymentMethod: z.enum(["online", "razorpay", "cod"]).default("online"),
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

  const staff = s.role !== "customer";
  const orders = await prisma.order.findMany({
    where,
    include: {
      items: true,
      deliverySlot: { select: { id: true, label: true } },
      // Staff see the latest WhatsApp update per order, so a failure is noticed.
      ...(staff
        ? {
            notifications: {
              orderBy: { createdAt: "desc" as const },
              take: 1,
              select: { id: true, toStatus: true, status: true, deliveryStatus: true, error: true, createdAt: true },
            },
          }
        : {}),
    },
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
  const { items, name, phone, deliveryLocationId, couponCode, deliveryDate, deliverySlotId } = parsed.data;
  const paymentMethod = parsed.data.paymentMethod === "cod" ? "cod" : "online";

  // COD availability is an admin setting — enforce it here, not just in the UI.
  if (paymentMethod === "cod" && setting && !setting.codEnabled) {
    return NextResponse.json(
      { error: "Cash on Delivery isn't available right now. Please pay online." },
      { status: 403 },
    );
  }

  // Delivery location must exist and be active — it sets the delivery fee & address.
  const location = await prisma.deliveryLocation.findFirst({ where: { id: deliveryLocationId, active: true } });
  if (!location) {
    return NextResponse.json({ error: "Please choose a valid delivery location." }, { status: 400 });
  }
  const address = location.area ? `${location.name}, ${location.area}` : location.name;

  // Pre-order scheduling. Slots are optional only while none are configured, so
  // an existing shop keeps working until the admin sets its delivery windows up.
  const slotsConfigured = (await prisma.deliverySlot.count({ where: { active: true } })) > 0;
  if (slotsConfigured) {
    if (!deliveryDate || !deliverySlotId) {
      return NextResponse.json({ error: "Please choose a delivery date and time." }, { status: 400 });
    }
    const problem = await assertSlotAvailable(deliveryDate, deliverySlotId, location.id);
    if (problem) return NextResponse.json({ error: problem }, { status: 409 });
  }

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

  // Membership benefits — resolved server-side from the active subscription.
  const membership = await getMembership(s.sub);
  const { subtotal } = orderTotals(lineItems, { membership, deliveryFee: location.deliveryFee });

  // Coupon — re-validated server-side against the live subtotal (never trust the client).
  let couponDiscount = 0;
  let appliedCode: string | null = null;
  if (couponCode) {
    const cr = await evaluateCoupon(couponCode, subtotal);
    if (!cr.ok) return NextResponse.json({ error: cr.error }, { status: 400 });
    couponDiscount = cr.discount;
    appliedCode = cr.code;
  }

  // The same formula the WhatsApp assistant uses (lib/order-pricing).
  const { discountTotal, membershipDiscount, deliveryFee, total } = orderTotals(lineItems, { membership, deliveryFee: location.deliveryFee, couponDiscount });

  if (total < 1) {
    return NextResponse.json({ error: "Order total too low." }, { status: 400 });
  }

  // COD confirmation: collect part of the total online now, the rest in cash on
  // delivery. Never charge more than the order is worth.
  const codConfirmAmount =
    paymentMethod === "cod" ? Math.min(Math.max(0, setting?.codConfirmAmount ?? 0), total) : 0;
  const codBalanceDue = paymentMethod === "cod" ? total - codConfirmAmount : 0;
  const collectsCodConfirmation = codConfirmAmount > 0;

  // Online money goes through the gateway chosen in Settings → Payments.
  const gateway = paymentMethod === "online" || collectsCodConfirmation ? await activeGateway() : null;
  if ((paymentMethod === "online" || collectsCodConfirmation) && !gateway) {
    return NextResponse.json(
      { error: paymentMethod === "cod" ? "Cash on Delivery needs a small online confirmation payment, which isn't available right now." : "Online payment isn't available right now. Please choose Cash on Delivery or try again later." },
      { status: 503 },
    );
  }

  const created = await prisma.order.create({
    data: {
      customerId: s.sub,
      customerName: name,
      customerPhone: phone,
      address,
      deliveryLocationId: location.id,
      deliveryDate: deliveryDate ? toDbDate(deliveryDate) : null,
      deliverySlotId: slotsConfigured ? deliverySlotId : null,
      subtotal,
      discountTotal,
      couponCode: appliedCode,
      couponDiscount,
      membershipDiscount,
      deliveryFee,
      total,
      // The gateway that takes the money is recorded as the method (razorpay | cashfree).
      paymentMethod: paymentMethod === "cod" ? "cod" : gateway!,
      codBalanceDue,
      status: paymentMethod === "cod" && !collectsCodConfirmation ? "PLACED" : "PENDING",
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
    summary: `Order placed (₹${total}, ${created.paymentMethod})`,
    metadata: { total, subtotal, discountTotal, couponCode: appliedCode, couponDiscount, deliveryFee, location: location.name, deliveryDate: deliveryDate ?? null, paymentMethod: created.paymentMethod, items: lineItems.map((i) => ({ name: i.name, qty: i.qty, price: i.price })) },
    req,
  });

  // Cash on delivery with no confirmation fee — finalize immediately (invoice +
  // stock). Nothing has been charged yet, so if the last portion went to another
  // customer in the meantime we roll the order back rather than oversell.
  if (paymentMethod === "cod" && !collectsCodConfirmation) {
    try {
      const order = await finalizeOrder(created.id, { strict: true });
      // WhatsApp after the response: never slows (or fails) the checkout.
      after(async () => {
        await notifyOrderStatus(order.id, null);
        await notifyNewOrderToAdmin(order);
      });
      return NextResponse.json({ order, paymentMethod: "cod" });
    } catch (e) {
      if (e instanceof OutOfStockError) {
        await prisma.order.delete({ where: { id: created.id } }).catch(() => {});
        if (appliedCode) {
          await prisma.coupon.update({ where: { code: appliedCode }, data: { usedCount: { decrement: 1 } } }).catch(() => {});
        }
        return NextResponse.json({ error: e.message }, { status: 409 });
      }
      throw e;
    }
  }

  // Online payment — full total, or just the COD confirmation slice.
  try {
    const start = await startOnlinePayment(created, gateway!, new URL(req.url).origin);
    return NextResponse.json({
      order: created,
      paymentMethod: collectsCodConfirmation ? "cod_confirm" : start.gateway,
      gateway: start.gateway,
      codConfirmAmount,
      codBalanceDue,
      ...(start.gateway === "razorpay" ? { razorpay: start.razorpay } : { cashfree: start.cashfree }),
    });
  } catch (e) {
    const msg = String((e as { error?: { description?: string } })?.error?.description || (e as Error)?.message || e);
    const authError = /authentication|unauthori[sz]ed|key_id|invalid api key|client id|client secret/i.test(msg) || (e as { status?: number })?.status === 401;
    await prisma.order.delete({ where: { id: created.id } }).catch(() => {});
    if (appliedCode) {
      await prisma.coupon.update({ where: { code: appliedCode }, data: { usedCount: { decrement: 1 } } }).catch(() => {});
    }
    // eslint-disable-next-line no-console
    console.error(`[${gateway}] create payment failed:`, msg);
    return NextResponse.json(
      { error: authError ? "Payment gateway auth failed." : "Could not start payment. Try again." },
      { status: authError ? 401 : 500 },
    );
  }
}
