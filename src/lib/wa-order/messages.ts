import "server-only";
import { inr } from "../utils";
import { siteUrl } from "../payments";
import type { CartLine } from "../order-pricing";
import type { DayDTO } from "../delivery";
import type { ChatListRow, Interactive } from "../whatsapp";
import { categoriesOf, type Dish } from "./catalog";

/**
 * The ordering assistant's WhatsApp messages (spec #14): lists to pick from,
 * buttons to tap, a payment link button — so the customer rarely has to type.
 * Every button and row id starts with "o:" and is read back by the flow; the
 * texts are clipped to WhatsApp's limits where they are sent.
 */

export type Out = string | Interactive;

const priceText = (d: Dish) => (d.mrp > d.price ? `${inr(d.price)} (was ${inr(d.mrp)})` : inr(d.price));

function dishRow(d: Dish): ChatListRow {
  return { id: `o:d:${d.id}`, title: d.name, description: [priceText(d), d.servingInfo, d.description].filter(Boolean).join(" · ") };
}

/** A dish photo WhatsApp can fetch (it needs a public https address). */
function publicImage(url: string | null): string | undefined {
  if (!url) return undefined;
  if (/^https:\/\//i.test(url)) return url;
  const base = siteUrl();
  return url.startsWith("/") && base.startsWith("https://") ? `${base}${url}` : undefined;
}

export function menuMessage(menu: Dish[], opts: { featured?: { dish: Dish; label: string } | null; body?: string } = {}): Out {
  const orderable = menu.filter((d) => !d.soldOut);
  if (!orderable.length) return "Our menu is being prepared right now — please check back a little later.";
  const featured = opts.featured && !opts.featured.dish.soldOut ? opts.featured : null;
  const intro = opts.body || "What would you like today? Tap *View menu* to choose a dish.";
  const body = featured ? `${intro}\n\n⭐ ${featured.label}: *${featured.dish.name}* — ${priceText(featured.dish)}` : intro;

  // A small menu fits in one list, grouped by category: one tap to a dish.
  if (orderable.length <= 10) {
    const sections = categoriesOf(menu).map((c) => ({ title: c.name, rows: orderable.filter((d) => d.category === c.name).map(dishRow) }));
    return { kind: "list", header: "Ela & Co. menu", body, button: "View menu", sections };
  }
  const cats = categoriesOf(menu).slice(0, featured ? 9 : 10);
  const rows: ChatListRow[] = [
    ...(featured ? [{ id: `o:d:${featured.dish.id}`, title: `⭐ ${featured.dish.name}`, description: `${featured.label} · ${priceText(featured.dish)}` }] : []),
    ...cats.map((c) => ({ id: `o:c:${encodeURIComponent(c.name)}:0`, title: c.name, description: `${c.count} dish${c.count === 1 ? "" : "es"} · from ${inr(c.from)}` })),
  ];
  return { kind: "list", header: "Ela & Co. menu", body, button: "View menu", sections: [{ title: "Menu", rows }] };
}

export function categoryMessage(menu: Dish[], name: string, page: number): Out {
  const dishes = menu.filter((d) => d.category === name && !d.soldOut);
  if (!dishes.length) return menuMessage(menu, { body: `Nothing left in ${name} right now — here's the rest of today's menu.` });
  const start = page * 9;
  const rest = dishes.slice(start);
  const rows = rest.length > 10 ? rest.slice(0, 9).map(dishRow) : rest.slice(0, 10).map(dishRow);
  if (rest.length > 10) rows.push({ id: `o:c:${encodeURIComponent(name)}:${page + 1}`, title: "More dishes →", description: `${rest.length - 9} more in ${name}` });
  return { kind: "list", header: name, body: `*${name}* — tap a dish to add it to your order.`, button: "Choose a dish", sections: [{ title: name, rows }] };
}

/** The assistant's recommendations, as a list the customer can tap. */
export function suggestMessage(dishes: Dish[], body: string): Out {
  return { kind: "list", body, button: "See dishes", sections: [{ title: "Suggested for you", rows: dishes.slice(0, 10).map(dishRow) }] };
}

export function dishMessage(d: Dish, inCart: number): Out {
  const body = [
    `*${d.name}* — ${d.mrp > d.price ? `${inr(d.price)} ~${inr(d.mrp)}~` : inr(d.price)}`,
    d.description,
    d.servingInfo ? `🍽️ ${d.servingInfo}` : "",
    "",
    inCart ? `You have ${inCart} in your order.` : "How many would you like?",
  ]
    .filter((l, i, all) => l || (i > 0 && all[i - 1]))
    .join("\n");
  return {
    kind: "buttons",
    body,
    imageUrl: publicImage(d.imageUrl),
    footer: "Or type how many, e.g. 5",
    buttons: inCart
      ? [
          { id: `o:q:${d.id}:1`, title: "Add one more" },
          { id: `o:q:${d.id}:-1`, title: "Remove one" },
          { id: "o:k", title: "View my order" },
        ]
      : [1, 2, 3].map((n) => ({ id: `o:q:${d.id}:${n}`, title: String(n) })),
  };
}

export function cartMessage(c: { lines: CartLine[]; notes?: string[] }): Out {
  const notes = (c.notes ?? []).filter(Boolean);
  if (!c.lines.length) {
    return { kind: "buttons", body: [...notes, "Your order is empty."].join("\n"), buttons: [{ id: "o:m", title: "View menu" }] };
  }
  const subtotal = c.lines.reduce((n, l) => n + l.price * l.qty, 0);
  const body = [
    ...(notes.length ? [...notes, ""] : []),
    "🛒 *Your order*",
    ...c.lines.map((l) => `${l.qty}× ${l.name} — ${inr(l.price * l.qty)}`),
    "",
    `Subtotal: *${inr(subtotal)}*`,
    "Delivery is added at checkout.",
  ].join("\n");
  return {
    kind: "buttons",
    body,
    buttons: [
      { id: "o:x", title: "Checkout" },
      { id: "o:m", title: "Add more" },
      { id: "o:e", title: "Edit order" },
    ],
  };
}

export function editMessage(lines: CartLine[]): Out {
  const rows: ChatListRow[] = [
    ...lines.slice(0, 8).map((l) => ({ id: `o:d:${l.menuItemId}`, title: `Change ${l.name}`, description: `${l.qty} in your order · ${inr(l.price)} each` })),
    { id: "o:ch", title: "Change delivery details", description: "Area, time or address" },
    { id: "o:clr", title: "Clear my order", description: "Remove everything and start again" },
  ];
  return { kind: "list", body: "What would you like to change?", button: "Edit order", sections: [{ title: "Edit", rows }] };
}

export function areaMessage(locations: { id: string; name: string; area: string | null; deliveryFee: number }[], page: number, freeDelivery: boolean): Out {
  const start = page * 9;
  const rest = locations.slice(start);
  const rows: ChatListRow[] = (rest.length > 10 ? rest.slice(0, 9) : rest.slice(0, 10)).map((l) => ({
    id: `o:a:${l.id}`,
    title: l.name,
    description: [l.area, freeDelivery || l.deliveryFee <= 0 ? "Free delivery" : `Delivery ${inr(l.deliveryFee)}`].filter(Boolean).join(" · "),
  }));
  if (rest.length > 10) rows.push({ id: `o:ap:${page + 1}`, title: "More areas →", description: `${rest.length - 9} more` });
  return { kind: "list", body: "📍 Where should we deliver? Choose your area.", button: "Choose area", sections: [{ title: "Delivery areas", rows }] };
}

export function slotMessage(days: DayDTO[]): Out {
  let left = 10;
  const sections = days
    .map((d) => {
      const rows = d.slots.slice(0, left).map((s) => ({ id: `o:s:${d.date}:${s.id}`, title: s.label, description: d.label }));
      left -= rows.length;
      return { title: d.label, rows };
    })
    .filter((s) => s.rows.length);
  return { kind: "list", body: "🕐 When should we deliver? Pick a time.", button: "Choose a time", sections };
}

export function addressMessage(saved: string | null, area: string): Out {
  if (saved) {
    return {
      kind: "buttons",
      body: `📍 Deliver to this address in *${area}*?\n\n${saved}`,
      buttons: [
        { id: "o:as", title: "Use this address" },
        { id: "o:an", title: "New address" },
      ],
    };
  }
  return `📍 Please type your delivery address in *${area}* — house or flat, street and a landmark. You can also share your location.`;
}

export const NAME_QUESTION = "👤 What name should we put on the order?";

export function reviewMessage(r: {
  lines: CartLine[];
  totals: { subtotal: number; membershipDiscount: number; deliveryFee: number; total: number };
  area: string;
  address: string;
  when: string | null;
  name: string;
  member: string | null;
  online: boolean;
  cod: { enabled: boolean; confirmAmount: number };
}): Out {
  const t = r.totals;
  const lines = ["🧾 *Your order*", ...r.lines.map((l) => `${l.qty}× ${l.name} — ${inr(l.price * l.qty)}`), "", `Subtotal: ${inr(t.subtotal)}`];
  if (t.membershipDiscount > 0) lines.push(`${r.member ?? "Member"} discount: −${inr(t.membershipDiscount)}`);
  lines.push(`Delivery (${r.area}): ${t.deliveryFee > 0 ? inr(t.deliveryFee) : "Free"}`, `*Total: ${inr(t.total)}*`, "", `📍 ${r.address}, ${r.area}`);
  if (r.when) lines.push(`🕐 ${r.when}`);
  lines.push(`👤 ${r.name}`);
  const body = lines.join("\n");
  const pay = { id: "o:p:online", title: `Pay ${inr(t.total)}` };
  const cod = { id: "o:p:cod", title: "Cash on delivery" };
  const edit = { id: "o:e", title: "Edit order" };
  const cancel = { id: "o:cn", title: "Cancel" };
  const buttons = r.online && r.cod.enabled ? [pay, cod, edit] : r.online ? [pay, edit, cancel] : [cod, edit, cancel];
  const confirm = Math.min(r.cod.confirmAmount, t.total);
  return {
    kind: "buttons",
    body,
    buttons,
    footer: r.cod.enabled && confirm > 0 ? `Cash on delivery: pay ${inr(confirm)} now to confirm, the rest in cash` : undefined,
  };
}

export function payLinkMessage(o: { ref: string; total: number; amount: number; codBalance: number; url: string; gateway: string | null }): Out {
  const body =
    o.amount >= o.total
      ? `🧾 Order ${o.ref} — *${inr(o.total)}*\nTap below to pay securely by UPI or card. Your order is confirmed as soon as the payment goes through.`
      : `🧾 Order ${o.ref} — *${inr(o.total)}*\nPay *${inr(o.amount)}* now to confirm your order; the remaining ${inr(o.codBalance)} is paid in cash on delivery.`;
  return { kind: "cta_url", body, displayText: `Pay ${inr(o.amount)}`, url: o.url, footer: o.gateway ? `Secure payment by ${o.gateway}` : undefined };
}

/** Puts the assistant's own words in front of the first message (one message instead of two). */
export function withLead(outs: Out[], lead: string): Out[] {
  const text = lead.trim();
  if (!text) return outs;
  if (!outs.length) return [text];
  const [first, ...rest] = outs;
  if (typeof first === "string") return [`${text}\n\n${first}`, ...rest];
  return [{ ...first, body: `${text}\n\n${first.body}` }, ...rest];
}
