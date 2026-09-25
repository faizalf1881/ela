import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { actorFrom } from "@/lib/audit";
import { STATUS_LABEL, type OrderStatus } from "@/lib/order-status";
import { changeOrderStatus, nextScanStep, normalizeScanSteps, SCAN_COOLDOWN_MS, StatusChangeError } from "@/lib/order-flow";

export const runtime = "nodejs";

const schema = z.object({
  code: z.string().trim().min(3).max(200),
  /** true = move the order to its next workflow step (label scanning). */
  advance: z.boolean().optional().default(false),
});

async function findOrder(raw: string) {
  // A scanner may deliver a URL — take the last path segment.
  const code = raw.includes("/") ? raw.split("/").filter(Boolean).pop()! : raw;
  const exact = await prisma.order.findUnique({ where: { id: code }, include: { items: true } });
  if (exact) return exact;
  return prisma.order.findFirst({
    where: { OR: [{ invoiceNo: code.toUpperCase() }, { id: { endsWith: code.toLowerCase() } }] },
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * POST /api/orders/scan — staff scan a delivery-label QR (or type an order id /
 * short code / invoice number).
 *
 * With `advance: true` (what the Orders board sends) the order moves straight to
 * the next step of the admin-configured workflow, e.g. Confirmed → Preparing →
 * Out for delivery → Delivered. Without it, the order is only looked up.
 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role === "customer") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That doesn't look like an order code." }, { status: 400 });

  const order = await findOrder(parsed.data.code.trim());
  if (!order) return NextResponse.json({ error: "No order matches that code." }, { status: 404 });
  if (!parsed.data.advance) return NextResponse.json({ order });

  const ref = `#${order.id.slice(-6).toUpperCase()}`;
  const current = order.status as OrderStatus;

  const setting = await prisma.storeSetting.findUnique({ where: { id: 1 }, select: { scanSteps: true } });
  const decision = nextScanStep(current, normalizeScanSteps(setting?.scanSteps));
  if (!decision.ok) {
    return NextResponse.json({ error: `Order ${ref} ${decision.reason}`, order, final: decision.final }, { status: 409 });
  }

  // The same label read twice in quick succession is one scan, not two steps.
  if (order.statusChangedAt && Date.now() - order.statusChangedAt.getTime() < SCAN_COOLDOWN_MS) {
    return NextResponse.json(
      {
        error: `Order ${ref} was just moved to ${STATUS_LABEL[current]}. Scan again in a few seconds for the next step.`,
        order,
        duplicate: true,
      },
      { status: 409 },
    );
  }

  try {
    const res = await changeOrderStatus({
      orderId: order.id,
      to: decision.next,
      expectFrom: current,
      actor: actorFrom(s),
      via: "scan",
      req,
    });
    return NextResponse.json({
      order: res.order,
      from: current,
      to: decision.next,
      message: `Order ${ref}: ${STATUS_LABEL[current]} → ${STATUS_LABEL[decision.next]}`,
    });
  } catch (e) {
    if (e instanceof StatusChangeError) return NextResponse.json({ error: e.message, order }, { status: e.httpStatus });
    throw e;
  }
}
