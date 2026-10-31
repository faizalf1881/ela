import "server-only";
import type { Prisma, StoreSetting, WaConversation, WaOrderDraft } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { inr } from "../utils";
import { assertSlotAvailable, getAvailability, humanDate, toDbDate } from "../delivery";
import { getMembership } from "../membership";
import { orderTotals, priceCart, type CartLine } from "../order-pricing";
import { activeGateway, GATEWAY_LABEL, onlineAmountDue, payLink } from "../payments";
import { finalizeOrder, OutOfStockError } from "../fulfillment";
import { notifyNewOrderToAdmin, notifyOrderStatus } from "../notify";
import { liveMenu, type Dish } from "./catalog";
import * as ui from "./messages";

/**
 * Ordering on WhatsApp (spec #8–#14). The customer taps through the menu or
 * tells the assistant what they want; this module keeps their cart, walks
 * them through area → time → address → name → summary, and turns the
 * confirmed summary into a real order with a payment link.
 *
 * Every step re-reads the live menu, delivery rules and store status, and an
 * order is only created at exactly the total the customer last saw.
 */

type Item = { id: string; qty: number };

export type OrderIntent =
  | { type: "menu"; body?: string }
  | { type: "category"; name: string; page: number }
  | { type: "suggest"; ids: string[]; body: string }
  | { type: "dish"; id: string }
  /** Change a dish's quantity by `qty` (negative = fewer). */
  | { type: "add"; id: string; qty: number }
  /** The customer typed an exact quantity. */
  | { type: "set"; id: string; qty: number }
  | { type: "add_many"; items: Item[] }
  | { type: "remove"; id: string }
  | { type: "cart" }
  | { type: "edit" }
  | { type: "clear" }
  | { type: "checkout" }
  | { type: "change_details" }
  | { type: "area"; id: string }
  | { type: "area_page"; page: number }
  | { type: "slot"; date: string; slotId: string }
  | { type: "address_saved" }
  | { type: "address_new" }
  | { type: "address"; text: string }
  | { type: "name"; text: string }
  | { type: "pay"; method: "online" | "cod" }
  | { type: "resend_link" }
  | { type: "cancel" };

const itemsOf = (d: { items: Prisma.JsonValue } | null): Item[] =>
  (Array.isArray(d?.items) ? (d!.items as unknown as Item[]) : []).filter((i) => i && typeof i.id === "string" && Number.isInteger(i.qty) && i.qty > 0);

/** A tapped button or list row → what to do. */
export function intentFromReply(id: string | null | undefined): OrderIntent | null {
  if (!id?.startsWith("o:")) return null;
  const [, k, a, b] = id.split(":");
  switch (k) {
    case "m":
      return { type: "menu" };
    case "c":
      return a ? { type: "category", name: decodeURIComponent(a), page: Math.max(0, Number(b) || 0) } : { type: "menu" };
    case "d":
      return a ? { type: "dish", id: a } : null;
    case "q":
      return a ? { type: "add", id: a, qty: Number(b) || 1 } : null;
    case "r":
      return a ? { type: "remove", id: a } : null;
    case "k":
      return { type: "cart" };
    case "e":
      return { type: "edit" };
    case "clr":
      return { type: "clear" };
    case "x":
      return { type: "checkout" };
    case "ch":
      return { type: "change_details" };
    case "a":
      return a ? { type: "area", id: a } : null;
    case "ap":
      return { type: "area_page", page: Math.max(0, Number(a) || 0) };
    case "s":
      return a && b ? { type: "slot", date: a, slotId: b } : null;
    case "as":
      return { type: "address_saved" };
    case "an":
      return { type: "address_new" };
    case "p":
      return { type: "pay", method: a === "cod" ? "cod" : "online" };
    case "pl":
      return { type: "resend_link" };
    case "cn":
      return { type: "cancel" };
  }
  return null;
}

/**
 * Typed words that need no AI: a few ordering keywords, and answers to the
 * question we just asked (a quantity, the address, the name).
 */
export function textIntent(body: string, type: string, draft: Pick<WaOrderDraft, "step"> | null): OrderIntent | null {
  const t = body.trim();
  const plain = t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const step = draft?.step ?? "BROWSING";
  if (step.startsWith("QTY:") && /^\d{1,2}$/.test(plain)) return { type: "set", id: step.slice(4), qty: Number(plain) };
  if (step === "ADDRESS") {
    if (type === "location") return { type: "address", text: t.replace(/^\[location\]\s*/, "") };
    const question = /\?\s*$/.test(t) || /^(what|when|how|can|could|do|does|is|are|why|where|which|will)\b/i.test(t);
    if (type === "text" && t.length >= 8 && !question) return { type: "address", text: t };
  }
  if (step === "NAME" && type === "text" && t.length >= 2 && t.length <= 60 && !t.includes("?") && plain.split(" ").length <= 5) return { type: "name", text: t };
  if (/^(menu|show menu|view menu|full menu|see menu|the menu|menu please|order|order food|i want to order|place an order|start order|order now)$/.test(plain)) return { type: "menu" };
  if (/^(cart|my cart|view cart|basket)$/.test(plain)) return { type: "cart" };
  if (/^(checkout|check out)$/.test(plain)) return { type: "checkout" };
  if (step === "PAYMENT" && /^(pay|pay now|payment|payment link|link|send link|send payment link)$/.test(plain)) return { type: "resend_link" };
  return null;
}

type Ctx = {
  conv: WaConversation;
  draft: WaOrderDraft;
  customer: { id: string; name: string | null; address: string | null } | null;
  setting: StoreSetting | null;
  menu: Dish[];
};

async function save(ctx: Ctx, data: Prisma.WaOrderDraftUpdateInput) {
  ctx.draft = await prisma.waOrderDraft.update({ where: { id: ctx.draft.id }, data });
}

const qtyIn = (ctx: Ctx, id: string) => itemsOf(ctx.draft).find((i) => i.id === id)?.qty ?? 0;
/** The cart with one dish set to `qty` (0 removes it), keeping the order dishes were added in. */
function withQty(items: Item[], id: string, qty: number): Item[] {
  if (qty <= 0) return items.filter((i) => i.id !== id);
  return items.some((i) => i.id === id) ? items.map((i) => (i.id === id ? { id, qty } : i)) : [...items, { id, qty }];
}
/** After an order the cart empties. The area and name are remembered; the address is offered again (saved on the customer) to confirm. */
const AFTER_ORDER: Prisma.WaOrderDraftUpdateInput = { items: [], step: "BROWSING", quotedTotal: null, orderId: null, deliveryDate: null, deliverySlotId: null, address: null };

async function featured(ctx: Ctx) {
  const content = await prisma.siteContent.findUnique({ where: { id: 1 }, select: { featuredItemId: true, featuredLabel: true } });
  const dish = content?.featuredItemId ? ctx.menu.find((d) => d.id === content.featuredItemId) : undefined;
  return dish ? { dish, label: content!.featuredLabel } : null;
}

async function cartOut(ctx: Ctx, notes: string[] = []) {
  const { lines, problems } = await priceCart(itemsOf(ctx.draft));
  return ui.cartMessage({ lines, notes: [...notes, ...problems] });
}

async function areaOut(ctx: Ctx, page: number) {
  const [locations, m] = await Promise.all([prisma.deliveryLocation.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }), getMembership(ctx.customer?.id)]);
  return ui.areaMessage(locations, page, m.active && m.freeDelivery);
}

/** Runs one step of the conversation and returns the replies to send. */
export async function applyIntent(conversationId: string, intent: OrderIntent): Promise<ui.Out[]> {
  const conv = await prisma.waConversation.findUniqueOrThrow({ where: { id: conversationId } });
  const draft = await prisma.waOrderDraft.upsert({ where: { conversationId }, create: { conversationId }, update: {} });
  const [customer, setting, menu] = await Promise.all([
    prisma.customer.findUnique({ where: { phone: conv.phone }, select: { id: true, name: true, address: true } }),
    prisma.storeSetting.findUnique({ where: { id: 1 } }),
    liveMenu(),
  ]);
  return run({ conv, draft, customer, setting, menu }, intent);
}

async function run(ctx: Ctx, intent: OrderIntent): Promise<ui.Out[]> {
  switch (intent.type) {
    case "menu":
      await save(ctx, { step: "BROWSING" });
      return [ui.menuMessage(ctx.menu, { featured: await featured(ctx), body: intent.body })];
    case "category":
      return [ui.categoryMessage(ctx.menu, intent.name, intent.page)];
    case "suggest": {
      const picked = [...new Map(intent.ids.map((id) => ctx.menu.find((d) => d.id === id)).filter((d): d is Dish => !!d && !d.soldOut).map((d) => [d.id, d])).values()];
      return [picked.length ? ui.suggestMessage(picked, intent.body) : ui.menuMessage(ctx.menu, { featured: await featured(ctx), body: intent.body })];
    }
    case "dish": {
      const d = ctx.menu.find((x) => x.id === intent.id);
      if (!d || d.soldOut) {
        const why = d ? `Sorry, ${d.name} is sold out for today.` : "Sorry, that dish isn't on the menu right now.";
        return [ui.menuMessage(ctx.menu, { body: `${why} Here's what we have:` })];
      }
      await save(ctx, { step: `QTY:${d.id}` });
      return [ui.dishMessage(d, qtyIn(ctx, d.id))];
    }
    case "add":
    case "set":
    case "remove": {
      const d = ctx.menu.find((x) => x.id === intent.id);
      const current = qtyIn(ctx, intent.id);
      let target = intent.type === "remove" ? 0 : intent.type === "set" ? intent.qty : current + intent.qty;
      const notes: string[] = [];
      if (target > 0) {
        if (!d || d.soldOut) return [ui.menuMessage(ctx.menu, { body: d ? `Sorry, ${d.name} just sold out. Here's what's left:` : "Sorry, that dish isn't on the menu right now. Here's what we have:" })];
        if (target > 50) {
          target = 50;
          notes.push("Up to 50 of a dish can be ordered here — for more, just ask and our team will help.");
        }
        if (d.stock !== null && target > d.stock) {
          target = d.stock;
          notes.push(`Only ${d.stock} × ${d.name} left today, so your order has ${d.stock}.`);
        }
      }
      await save(ctx, { items: withQty(itemsOf(ctx.draft), intent.id, Math.max(0, target)), step: "BROWSING", quotedTotal: null });
      return [await cartOut(ctx, notes)];
    }
    case "add_many": {
      const notes: string[] = [];
      let items = itemsOf(ctx.draft);
      for (const it of intent.items) {
        const d = ctx.menu.find((x) => x.id === it.id);
        if (!d || d.soldOut) {
          notes.push(d ? `${d.name} is sold out today.` : "One dish you asked for isn't on the menu today.");
          continue;
        }
        let qty = (items.find((i) => i.id === d.id)?.qty ?? 0) + Math.max(1, Math.min(50, Math.round(it.qty)));
        if (d.stock !== null && qty > d.stock) {
          qty = d.stock;
          notes.push(`Only ${d.stock} × ${d.name} left today.`);
        }
        items = withQty(items, d.id, qty);
      }
      await save(ctx, { items, step: "BROWSING", quotedTotal: null });
      return [await cartOut(ctx, notes)];
    }
    case "cart":
      await save(ctx, { step: "BROWSING" });
      return [await cartOut(ctx)];
    case "edit": {
      const { lines } = await priceCart(itemsOf(ctx.draft));
      return [lines.length ? ui.editMessage(lines) : await cartOut(ctx)];
    }
    case "clear":
      await save(ctx, { items: [], step: "BROWSING", quotedTotal: null });
      return [ui.cartMessage({ lines: [], notes: ["Done — your order is cleared."] })];
    case "checkout":
      return checkout(ctx);
    case "change_details":
      await save(ctx, { deliveryLocationId: null, deliveryDate: null, deliverySlotId: null, address: null, quotedTotal: null });
      return checkout(ctx);
    case "area": {
      const loc = await prisma.deliveryLocation.findFirst({ where: { id: intent.id, active: true } });
      if (!loc) return ["Please choose one of these areas:", await areaOut(ctx, 0)];
      await save(ctx, { deliveryLocationId: loc.id, deliveryDate: null, deliverySlotId: null, quotedTotal: null });
      return checkout(ctx);
    }
    case "area_page":
      return [await areaOut(ctx, intent.page)];
    case "slot": {
      const problem = ctx.draft.deliveryLocationId ? await assertSlotAvailable(intent.date, intent.slotId, ctx.draft.deliveryLocationId) : "Please choose your area first.";
      if (problem) return [problem, ...(await checkout(ctx))];
      await save(ctx, { deliveryDate: intent.date, deliverySlotId: intent.slotId, quotedTotal: null });
      return checkout(ctx);
    }
    case "address_saved":
      if (ctx.customer?.address) await save(ctx, { address: ctx.customer.address, quotedTotal: null });
      return checkout(ctx);
    case "address_new": {
      await save(ctx, { step: "ADDRESS", address: null, quotedTotal: null });
      const loc = ctx.draft.deliveryLocationId ? await prisma.deliveryLocation.findUnique({ where: { id: ctx.draft.deliveryLocationId } }) : null;
      return [ui.addressMessage(null, loc?.name ?? "your area")];
    }
    case "address":
      await save(ctx, { address: intent.text.replace(/\s+/g, " ").slice(0, 300), quotedTotal: null });
      return checkout(ctx);
    case "name":
      await save(ctx, { customerName: intent.text.replace(/\s+/g, " ").slice(0, 80) });
      return checkout(ctx);
    case "pay":
      return pay(ctx, intent.method);
    case "resend_link": {
      const pending = await pendingOrder(ctx);
      return pending ? [await linkOut(pending)] : [{ kind: "buttons", body: "There's no payment waiting right now.", buttons: [{ id: "o:m", title: "View menu" }] }];
    }
    case "cancel":
      return cancel(ctx);
  }
}

/** The next question of checkout, or the order summary once everything is known. */
async function checkout(ctx: Ctx): Promise<ui.Out[]> {
  if (ctx.setting && !ctx.setting.acceptingOrders) return [ctx.setting.closedMessage || "We're not taking orders right now — please check back soon."];
  const items = itemsOf(ctx.draft);
  if (!items.length) return [ui.cartMessage({ lines: [] })];
  const { lines, problems } = await priceCart(items);
  if (problems.length) {
    // Keep what can still be ordered and show the customer what changed.
    await save(ctx, { items: items.filter((i) => lines.some((l) => l.menuItemId === i.id)), quotedTotal: null, step: "BROWSING" });
    return [await cartOut(ctx, problems)];
  }

  const locations = await prisma.deliveryLocation.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  if (!locations.length) return ["Sorry, we can't take delivery orders here right now. A team member will help you shortly."];
  let loc = locations.find((l) => l.id === ctx.draft.deliveryLocationId);
  if (!loc && locations.length === 1) {
    loc = locations[0];
    await save(ctx, { deliveryLocationId: loc.id });
  }
  if (!loc) {
    await save(ctx, { step: "AREA" });
    return [await areaOut(ctx, 0)];
  }

  if ((await prisma.deliverySlot.count({ where: { active: true } })) > 0) {
    const chosen = ctx.draft.deliveryDate && ctx.draft.deliverySlotId && !(await assertSlotAvailable(ctx.draft.deliveryDate, ctx.draft.deliverySlotId, loc.id));
    if (!chosen) {
      const { days } = await getAvailability(loc.id);
      if (!days.length) return [`Sorry, there are no delivery times left to book for ${loc.name} right now. Please try again later.`];
      await save(ctx, { step: "SLOT", deliveryDate: null, deliverySlotId: null });
      return [ui.slotMessage(days)];
    }
  }

  if (!ctx.draft.address) {
    await save(ctx, { step: "ADDRESS" });
    return [ui.addressMessage(ctx.customer?.address ?? null, loc.name)];
  }
  if (!ctx.draft.customerName) {
    const known = ctx.customer?.name || ctx.conv.profileName;
    if (!known) {
      await save(ctx, { step: "NAME" });
      return [ui.NAME_QUESTION];
    }
    await save(ctx, { customerName: known.slice(0, 80) });
  }
  return review(ctx, lines, loc);
}

type Loc = { id: string; name: string; area: string | null; deliveryFee: number };

async function review(ctx: Ctx, lines: CartLine[], loc: Loc): Promise<ui.Out[]> {
  const [membership, gateway] = await Promise.all([getMembership(ctx.customer?.id), activeGateway()]);
  const codEnabled = ctx.setting?.codEnabled ?? true;
  if (!gateway && !codEnabled) return ["Sorry, we can't take payments here right now. A team member will help you shortly."];
  const totals = orderTotals(lines, { membership, deliveryFee: loc.deliveryFee });
  await save(ctx, { step: "REVIEW", quotedTotal: totals.total });
  const slot = ctx.draft.deliverySlotId ? await prisma.deliverySlot.findUnique({ where: { id: ctx.draft.deliverySlotId } }) : null;
  return [
    ui.reviewMessage({
      lines,
      totals,
      area: loc.name,
      address: ctx.draft.address!,
      when: slot && ctx.draft.deliveryDate ? `${humanDate(ctx.draft.deliveryDate)}, ${slot.label}` : null,
      name: ctx.draft.customerName!,
      member: membership.active ? membership.planName : null,
      online: !!gateway,
      cod: { enabled: codEnabled, confirmAmount: ctx.setting?.codConfirmAmount ?? 0 },
    }),
  ];
}

/** The order made from this cart that is still waiting to be paid, if any. */
async function pendingOrder(ctx: Ctx) {
  if (!ctx.draft.orderId) return null;
  const o = await prisma.order.findUnique({ where: { id: ctx.draft.orderId } });
  if (o && o.status === "PENDING" && (o.paymentStatus === "UNPAID" || o.paymentStatus === "FAILED")) return o;
  await save(ctx, { orderId: null });
  return null;
}

async function linkOut(o: { id: string; total: number; paymentMethod: string; codBalanceDue: number }) {
  const gateway = await activeGateway();
  return ui.payLinkMessage({
    ref: `#${o.id.slice(-6).toUpperCase()}`,
    total: o.total,
    amount: onlineAmountDue(o),
    codBalance: o.codBalanceDue,
    url: payLink(o.id),
    gateway: gateway ? GATEWAY_LABEL[gateway] : null,
  });
}

/**
 * The customer confirmed the summary. Everything is checked again — the menu,
 * the area and time, the store — and the order is created only if the total is
 * still exactly what they were shown. Then: a payment link, or (cash on
 * delivery) the order is placed straight away.
 */
async function pay(ctx: Ctx, method: "online" | "cod"): Promise<ui.Out[]> {
  const pending = await pendingOrder(ctx);
  if (pending) return [await linkOut(pending)];
  if (ctx.draft.step !== "REVIEW" || ctx.draft.quotedTotal === null) return checkout(ctx);
  if (ctx.setting && !ctx.setting.acceptingOrders) return [ctx.setting.closedMessage || "We're not taking orders right now — please check back soon."];

  const { lines, problems } = await priceCart(itemsOf(ctx.draft));
  if (problems.length || !lines.length) return checkout(ctx);
  const loc = ctx.draft.deliveryLocationId ? await prisma.deliveryLocation.findFirst({ where: { id: ctx.draft.deliveryLocationId, active: true } }) : null;
  if (!loc || !ctx.draft.address) return checkout(ctx);
  const slotsConfigured = (await prisma.deliverySlot.count({ where: { active: true } })) > 0;
  if (slotsConfigured) {
    const problem = ctx.draft.deliveryDate && ctx.draft.deliverySlotId ? await assertSlotAvailable(ctx.draft.deliveryDate, ctx.draft.deliverySlotId, loc.id) : "Please choose a delivery time.";
    if (problem) {
      await save(ctx, { deliveryDate: null, deliverySlotId: null, quotedTotal: null });
      return [problem, ...(await checkout(ctx))];
    }
  }

  const membership = await getMembership(ctx.customer?.id);
  const totals = orderTotals(lines, { membership, deliveryFee: loc.deliveryFee });
  if (totals.total !== ctx.draft.quotedTotal) {
    return [`Heads up — a price changed since I showed you the total. Here's your updated order (${inr(totals.total)}):`, ...(await review(ctx, lines, loc))];
  }
  const codEnabled = ctx.setting?.codEnabled ?? true;
  if (method === "cod" && !codEnabled) return ["Cash on delivery isn't available right now — please pay online.", ...(await review(ctx, lines, loc))];
  const codConfirm = method === "cod" ? Math.min(Math.max(0, ctx.setting?.codConfirmAmount ?? 0), totals.total) : 0;
  const needsGateway = method === "online" || codConfirm > 0;
  const gateway = needsGateway ? await activeGateway() : null;
  if (needsGateway && !gateway) {
    return method === "online" && codEnabled
      ? ["Online payment isn't available right now — you can choose Cash on delivery.", ...(await review(ctx, lines, loc))]
      : ["Sorry, we can't take payments here right now. A team member will help you shortly."];
  }

  // WhatsApp has verified this number, so it identifies the customer.
  const name = ctx.draft.customerName || ctx.conv.profileName || "Customer";
  const customer = await prisma.customer.upsert({
    where: { phone: ctx.conv.phone },
    create: { phone: ctx.conv.phone, name, address: ctx.draft.address },
    update: { address: ctx.draft.address, ...(ctx.customer?.name ? {} : { name }) },
  });
  if (ctx.conv.customerId !== customer.id) await prisma.waConversation.update({ where: { id: ctx.conv.id }, data: { customerId: customer.id } });

  const placeNow = method === "cod" && codConfirm === 0;
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      customerName: name,
      customerPhone: `+${ctx.conv.phone}`,
      address: `${ctx.draft.address}, ${loc.name}${loc.area ? ` (${loc.area})` : ""}`,
      deliveryLocationId: loc.id,
      deliveryDate: slotsConfigured && ctx.draft.deliveryDate ? toDbDate(ctx.draft.deliveryDate) : null,
      deliverySlotId: slotsConfigured ? ctx.draft.deliverySlotId : null,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      membershipDiscount: totals.membershipDiscount,
      deliveryFee: totals.deliveryFee,
      total: totals.total,
      paymentMethod: method === "cod" ? "cod" : gateway!,
      codBalanceDue: method === "cod" ? totals.total - codConfirm : 0,
      status: placeNow ? "PLACED" : "PENDING",
      paymentStatus: "UNPAID",
      source: "whatsapp",
      notes: "Ordered on WhatsApp",
      items: { create: lines.map((l) => ({ menuItemId: l.menuItemId, name: l.name, mrp: l.mrp, price: l.price, qty: l.qty })) },
    },
  });
  const ref = `#${order.id.slice(-6).toUpperCase()}`;
  await audit({
    actor: { type: "customer", id: customer.id, label: ctx.conv.phone },
    action: "order.created",
    entityType: "order",
    entityId: order.id,
    summary: `WhatsApp order placed (₹${order.total}, ${order.paymentMethod})`,
    metadata: { via: "whatsapp", total: order.total, deliveryFee: order.deliveryFee, location: loc.name, deliveryDate: ctx.draft.deliveryDate, items: lines.map((l) => ({ name: l.name, qty: l.qty, price: l.price })) },
  });

  if (!placeNow) {
    await save(ctx, { step: "PAYMENT", orderId: order.id });
    return [await linkOut(order)];
  }

  // Cash on delivery: nothing to collect online, so it is placed now.
  let placed;
  try {
    placed = await finalizeOrder(order.id, { strict: true });
  } catch (e) {
    if (e instanceof OutOfStockError) {
      await prisma.order.delete({ where: { id: order.id } }).catch(() => {});
      return [`${e.message} Your order wasn't placed.`, ...(await checkout(ctx))];
    }
    throw e;
  }
  await save(ctx, AFTER_ORDER);
  await notifyOrderStatus(placed.id, null);
  await notifyNewOrderToAdmin(placed);
  // The "order confirmed" update is the confirmation; say it ourselves only if that update is switched off.
  const confirming = (ctx.setting?.notifyStatuses ?? ["PLACED"]).includes("PLACED");
  return confirming ? [] : [`✅ Order ${ref} placed — ${inr(placed.total)} to pay in cash on delivery. Thank you!`];
}

async function cancel(ctx: Ctx): Promise<ui.Out[]> {
  const pending = await pendingOrder(ctx);
  if (pending) {
    await prisma.order.updateMany({ where: { id: pending.id, status: "PENDING" }, data: { status: "CANCELLED", statusChangedAt: new Date() } });
    await audit({
      actor: { type: "customer", id: pending.customerId ?? undefined, label: ctx.conv.phone },
      action: "order.cancelled_by_customer",
      entityType: "order",
      entityId: pending.id,
      summary: `Unpaid WhatsApp order #${pending.id.slice(-6).toUpperCase()} cancelled by the customer`,
    });
  }
  await save(ctx, AFTER_ORDER);
  return [{ kind: "buttons", body: "Okay — nothing has been ordered. Whenever you're ready, I'm here.", buttons: [{ id: "o:m", title: "View menu" }] }];
}

/** What the assistant needs to know about this customer's cart and checkout. */
export async function orderingFacts(conversationId: string): Promise<string> {
  const draft = await prisma.waOrderDraft.findUnique({ where: { conversationId } });
  const items = itemsOf(draft);
  const { lines } = items.length ? await priceCart(items) : { lines: [] as CartLine[] };
  const out = [lines.length ? `Cart: ${lines.map((l) => `${l.qty}× ${l.name} (${inr(l.price)} each)`).join(", ")}.` : "Cart: empty."];
  const waiting: Record<string, string> = {
    AREA: "their delivery area (a list was sent)",
    SLOT: "a delivery time (a list was sent)",
    ADDRESS: "their delivery address",
    NAME: "the name for the order",
    REVIEW: "them to confirm the order summary (buttons were sent)",
    PAYMENT: "payment — a secure payment link was sent",
  };
  const step = draft?.step ?? "BROWSING";
  if (waiting[step]) out.push(`Waiting for: ${waiting[step]}.`);
  else if (step.startsWith("QTY:")) out.push("Waiting for: how many of the dish they picked.");
  if (draft?.orderId) {
    const o = await prisma.order.findUnique({ where: { id: draft.orderId } });
    if (o?.status === "PENDING") out.push(`Payment pending: order #${o.id.slice(-6).toUpperCase()}, total ${inr(o.total)}.`);
  }
  return out.join("\n");
}
