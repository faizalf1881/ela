import "server-only";
import { after } from "next/server";
import { prisma } from "./db";
import { audit, type AuditActor } from "./audit";
import { notifyOrderStatus } from "./notify";
import type { OrderStatus } from "./order-status";

/** The fulfilment path, in order. PENDING (unpaid) and CANCELLED sit outside it. */
export const FLOW: OrderStatus[] = ["PLACED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"];

/**
 * A second read of the same label inside this window is treated as a duplicate,
 * not a request for the next step. Camera and USB scanners both double-read.
 */
export const SCAN_COOLDOWN_MS = 8_000;

/** Keeps fulfilment statuses only, in flow order, always with PLACED and DELIVERED. */
export function normalizeScanSteps(steps: readonly string[] | null | undefined): OrderStatus[] {
  const chosen = new Set<string>(steps && steps.length ? steps : FLOW);
  chosen.add("PLACED");
  chosen.add("DELIVERED");
  return FLOW.filter((s) => chosen.has(s));
}

export type ScanDecision = { ok: true; next: OrderStatus } | { ok: false; reason: string; final: boolean };

/** Where a scan should move an order next, or why it can't move at all. */
export function nextScanStep(current: OrderStatus, steps: OrderStatus[]): ScanDecision {
  if (current === "PENDING") return { ok: false, reason: "is still awaiting payment, so it can't be moved on yet.", final: false };
  if (current === "CANCELLED") return { ok: false, reason: "was cancelled, so there is nothing to update.", final: true };
  if (current === "DELIVERED") return { ok: false, reason: "is already delivered. That is the final step.", final: true };
  const at = FLOW.indexOf(current);
  const next = steps.find((s) => FLOW.indexOf(s) > at);
  if (!next) return { ok: false, reason: "has no further step in the scan workflow.", final: true };
  return { ok: true, next };
}

export class StatusChangeError extends Error {
  constructor(
    message: string,
    public httpStatus: number,
  ) {
    super(message);
    this.name = "StatusChangeError";
  }
}

/**
 * The single way an order's status changes after placement (board buttons, QR
 * scans). The write is conditional on the status we read, so two people acting
 * on the same order at once cannot both apply a transition. A no-op (same
 * status) changes nothing and notifies no one; a real transition is audited and
 * the customer is told about it after the response has been sent.
 */
export async function changeOrderStatus(opts: {
  orderId: string;
  to: OrderStatus;
  /** Apply only if the order is still in this status. */
  expectFrom?: OrderStatus;
  actor: AuditActor;
  via: "board" | "scan";
  req?: Request;
}) {
  const before = await prisma.order.findUnique({ where: { id: opts.orderId } });
  if (!before) throw new StatusChangeError("Order not found", 404);
  const from = before.status as OrderStatus;

  if (opts.expectFrom && from !== opts.expectFrom) {
    throw new StatusChangeError("This order was just updated by someone else. Please try again.", 409);
  }
  if (from === opts.to) {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: opts.orderId }, include: { items: true } });
    return { changed: false, from, order };
  }

  const res = await prisma.order.updateMany({
    where: { id: opts.orderId, status: from },
    data: { status: opts.to, statusChangedAt: new Date() },
  });
  if (res.count === 0) {
    throw new StatusChangeError("This order was just updated by someone else. Please try again.", 409);
  }

  const order = await prisma.order.findUniqueOrThrow({ where: { id: opts.orderId }, include: { items: true } });
  await audit({
    actor: opts.actor,
    action: "order.status_changed",
    entityType: "order",
    entityId: order.id,
    summary: `Order #${order.id.slice(-6).toUpperCase()}: ${from} → ${opts.to}${opts.via === "scan" ? " (QR scan)" : ""}`,
    metadata: { from, to: opts.to, via: opts.via },
    req: opts.req,
  });

  // WhatsApp runs after the response: a slow or failing send must never delay
  // the kitchen or undo the status change.
  after(() => notifyOrderStatus(order.id, from));

  return { changed: true, from, order };
}
