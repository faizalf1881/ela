import "server-only";
import { prisma } from "./db";

export type ReportRow = Record<string, string | number>;
export type Report = { title: string; rows: ReportRow[] };

export const REPORT_TYPES = ["orders", "invoices", "customers", "subscriptions", "complaints", "analytics", "menu", "coupons"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

const d = (x: Date | null | undefined) => (x ? new Date(x).toLocaleString("en-IN") : "");
const day = (x: Date | null | undefined) => (x ? new Date(x).toLocaleDateString("en-IN") : "");

const METHOD: Record<string, string> = { razorpay: "Online", cod: "Cash on Delivery", manual: "Manual" };

/** Builds the rows behind every admin export (CSV / Excel / PDF share this). */
export async function buildReport(type: ReportType): Promise<Report> {
  switch (type) {
    case "orders": {
      const orders = await prisma.order.findMany({ include: { items: true }, orderBy: { createdAt: "desc" }, take: 5000 });
      return {
        title: "Orders",
        rows: orders.map((o) => ({
          Order: `#${o.id.slice(-6).toUpperCase()}`,
          Invoice: o.invoiceNo ?? "",
          Date: d(o.createdAt),
          Customer: o.customerName,
          Phone: o.customerPhone,
          Address: o.address,
          Items: o.items.map((i) => `${i.name} x${i.qty}`).join("; "),
          Subtotal: o.subtotal,
          "Member discount": o.membershipDiscount,
          Coupon: o.couponCode ?? "",
          "Coupon discount": o.couponDiscount,
          Delivery: o.deliveryFee,
          Total: o.total,
          Payment: METHOD[o.paymentMethod] ?? o.paymentMethod,
          Paid: o.paymentStatus,
          Status: o.status,
        })),
      };
    }

    case "invoices": {
      // Order invoices + membership charges, so Accounts reconciles to all money in.
      const [orders, charges] = await Promise.all([
        prisma.order.findMany({ where: { invoiceNo: { not: null } }, orderBy: { createdAt: "desc" }, take: 5000 }),
        prisma.subscriptionCharge.findMany({
          include: { subscription: { include: { customer: true, plan: true } } },
          orderBy: { paidAt: "desc" },
          take: 5000,
        }),
      ]);
      const rows: ReportRow[] = [
        ...orders.map((o) => ({
          Invoice: o.invoiceNo ?? "",
          Date: d(o.createdAt),
          Customer: o.customerName,
          Phone: o.customerPhone,
          Amount: o.total,
          Method: METHOD[o.paymentMethod] ?? o.paymentMethod,
          Type: o.source === "manual" ? "Manual" : "One-Time",
          Status: o.paymentStatus,
        })),
        ...charges.map((c) => ({
          Invoice: `SUB-${c.id.slice(-6).toUpperCase()}`,
          Date: d(c.paidAt),
          Customer: c.subscription.customer.name ?? "",
          Phone: c.subscription.customer.phone,
          Amount: c.amount,
          Method: "Online",
          Type: "Subscription",
          Status: "PAID",
        })),
      ].sort((a, b) => String(b.Date).localeCompare(String(a.Date)));
      return { title: "Invoices & payments", rows };
    }

    case "customers": {
      const customers = await prisma.customer.findMany({
        include: { orders: true, subscriptions: { include: { plan: true } } },
        orderBy: { createdAt: "desc" },
        take: 5000,
      });
      return {
        title: "Customers (CRM)",
        rows: customers.map((c) => {
          const active = c.orders.filter((o) => o.status !== "CANCELLED");
          const sub = c.subscriptions.find((s) => s.status === "ACTIVE");
          return {
            Name: c.name ?? "",
            Phone: c.phone,
            Address: c.address ?? "",
            Registered: day(c.createdAt),
            "Total orders": c.orders.length,
            "Total spent": active.reduce((n, o) => n + o.total, 0),
            "Last order": day(c.orders[0]?.createdAt),
            "Last login": d(c.lastLoginAt),
            Membership: sub ? sub.plan.name : "None",
            "Renewal date": day(sub?.currentEnd),
            Notes: c.notes ?? "",
          };
        }),
      };
    }

    case "subscriptions": {
      const subs = await prisma.subscription.findMany({
        include: { customer: true, plan: true, charges: true },
        orderBy: { createdAt: "desc" },
        take: 5000,
      });
      return {
        title: "Subscriptions",
        rows: subs.map((s) => ({
          Customer: s.customer.name ?? "",
          Phone: s.customer.phone,
          Plan: s.plan.name,
          Amount: s.plan.price,
          Cycle: s.plan.interval,
          Status: s.status,
          Started: day(s.startedAt),
          Renews: day(s.currentEnd),
          Payments: s.charges.length,
          "Total paid": s.charges.reduce((n, c) => n + c.amount, 0),
        })),
      };
    }

    case "complaints": {
      const tickets = await prisma.ticket.findMany({
        include: { messages: true, order: true },
        orderBy: { createdAt: "desc" },
        take: 5000,
      });
      return {
        title: "Complaints & support",
        rows: tickets.map((t) => ({
          Ticket: t.ticketNo,
          Date: d(t.createdAt),
          Customer: t.customerName,
          Phone: t.customerPhone,
          Category: t.category,
          Subject: t.subject,
          Order: t.order?.invoiceNo ?? t.orderId ?? "",
          Status: t.status,
          Messages: t.messages.length,
          "Last update": d(t.updatedAt),
        })),
      };
    }

    case "menu": {
      const items = await prisma.menuItem.findMany({ orderBy: [{ sortOrder: "asc" }] });
      return {
        title: "Menu",
        rows: items.map((m) => ({
          Item: m.name,
          Category: m.category,
          Price: m.price,
          "Discount %": m.discountPercent,
          Stock: m.stock ?? "Unlimited",
          Visible: m.available ? "Yes" : "No",
        })),
      };
    }

    case "coupons": {
      const coupons = await prisma.coupon.findMany({ orderBy: { createdAt: "desc" } });
      return {
        title: "Coupons",
        rows: coupons.map((c) => ({
          Code: c.code,
          Type: c.discountType,
          Value: c.value,
          "Min order": c.minOrder ?? "",
          "Max discount": c.maxDiscount ?? "",
          Used: c.usedCount,
          Limit: c.usageLimit ?? "Unlimited",
          Active: c.active ? "Yes" : "No",
          Starts: day(c.startsAt),
          Ends: day(c.endsAt),
        })),
      };
    }

    case "analytics": {
      // Daily revenue for the last 30 days + item performance.
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const orders = await prisma.order.findMany({
        where: { createdAt: { gte: since }, status: { not: "CANCELLED" }, invoiceNo: { not: null } },
        include: { items: true },
      });

      const byDay = new Map<string, { orders: number; revenue: number; items: number }>();
      const byItem = new Map<string, { qty: number; revenue: number }>();
      for (const o of orders) {
        const k = new Date(o.createdAt).toISOString().slice(0, 10);
        const cur = byDay.get(k) ?? { orders: 0, revenue: 0, items: 0 };
        cur.orders++;
        cur.revenue += o.total;
        cur.items += o.items.reduce((n, i) => n + i.qty, 0);
        byDay.set(k, cur);
        for (const i of o.items) {
          const it = byItem.get(i.name) ?? { qty: 0, revenue: 0 };
          it.qty += i.qty;
          it.revenue += i.price * i.qty;
          byItem.set(i.name, it);
        }
      }

      const rows: ReportRow[] = [...byDay.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, v]) => ({
          Date: new Date(date).toLocaleDateString("en-IN"),
          Orders: v.orders,
          "Items sold": v.items,
          Revenue: v.revenue,
          "Avg order value": v.orders ? Math.round(v.revenue / v.orders) : 0,
        }));

      // Blank separator, then per-item performance in the same sheet.
      if (byItem.size) {
        rows.push({ Date: "", Orders: "", "Items sold": "", Revenue: "", "Avg order value": "" });
        rows.push({ Date: "ITEM", Orders: "QTY SOLD", "Items sold": "", Revenue: "REVENUE", "Avg order value": "" });
        for (const [name, v] of [...byItem.entries()].sort((a, b) => b[1].qty - a[1].qty)) {
          rows.push({ Date: name, Orders: v.qty, "Items sold": "", Revenue: v.revenue, "Avg order value": "" });
        }
      }

      return { title: "Analytics (last 30 days)", rows };
    }
  }
}
