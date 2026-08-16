import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { finalizeOrder } from "@/lib/fulfillment";
import { audit, actorFrom } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

// GET /api/admin/accounts — all generated invoices with filters.
export async function GET(req: Request) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || ""; // PAID | UNPAID | FAILED
  const method = searchParams.get("method") || ""; // razorpay | cod | manual
  const q = (searchParams.get("q") || "").trim();
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Prisma.OrderWhereInput = { invoiceNo: { not: null } };
  if (status) where.paymentStatus = status as Prisma.OrderWhereInput["paymentStatus"];
  if (method) where.paymentMethod = method;
  if (from || to) {
    where.createdAt = {};
    if (from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(from);
    if (to) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(`${to}T23:59:59`);
  }
  if (q) {
    where.OR = [
      { invoiceNo: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { customerPhone: { contains: q } },
    ];
  }

  const orders = await prisma.order.findMany({
    where,
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  type InvoiceRow = {
    id: string;
    invoiceNo: string | null;
    createdAt: Date;
    customerName: string;
    customerPhone: string;
    total: number;
    paymentMethod: string;
    paymentStatus: string;
    paymentType: string;
    items: string;
    itemCount: number;
    kind: "order" | "subscription";
  };

  let invoices: InvoiceRow[] = orders.map((o) => ({
    id: o.id,
    invoiceNo: o.invoiceNo,
    createdAt: o.createdAt,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    total: o.total,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    paymentType: o.source === "manual" ? "Manual" : "One-Time",
    items: o.items.map((i) => `${i.name} × ${i.qty}`).join(", "),
    itemCount: o.items.reduce((n, i) => n + i.qty, 0),
    kind: "order",
  }));

  // Membership charges are money in too — surface them alongside order invoices
  // so Accounts reconciles to everything the business collected.
  const wantsSubs = !method || method === "razorpay";
  const wantsPaid = !status || status === "PAID";
  if (wantsSubs && wantsPaid) {
    const charges = await prisma.subscriptionCharge.findMany({
      where: {
        ...(from || to
          ? { paidAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}) } }
          : {}),
      },
      include: { subscription: { include: { customer: true, plan: true } } },
      orderBy: { paidAt: "desc" },
      take: 500,
    });

    const subRows: InvoiceRow[] = charges
      .filter((c) => {
        if (!q) return true;
        const hay = `${c.subscription.customer.name ?? ""} ${c.subscription.customer.phone} ${c.subscription.plan.name}`.toLowerCase();
        return hay.includes(q.toLowerCase());
      })
      .map((c) => ({
        id: c.subscriptionId,
        invoiceNo: `SUB-${c.id.slice(-6).toUpperCase()}`,
        createdAt: c.paidAt,
        customerName: c.subscription.customer.name ?? "Member",
        customerPhone: c.subscription.customer.phone,
        total: c.amount,
        paymentMethod: "razorpay",
        paymentStatus: "PAID",
        paymentType: "Subscription",
        items: `${c.subscription.plan.name} membership`,
        itemCount: 1,
        kind: "subscription",
      }));

    invoices = [...invoices, ...subRows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  const summary = {
    count: invoices.length,
    total: invoices.reduce((n, i) => n + i.total, 0),
    paid: invoices.filter((i) => i.paymentStatus === "PAID").reduce((n, i) => n + i.total, 0),
  };

  return NextResponse.json({ invoices, summary });
}

const createSchema = z.object({
  customerName: z.string().trim().min(1).max(120),
  customerPhone: z.string().trim().min(4).max(20),
  items: z.array(z.object({ name: z.string().trim().min(1).max(160), price: z.number().int().min(0).max(1_000_000), qty: z.number().int().min(1).max(999) })).min(1),
  paid: z.boolean().default(true),
});

// POST /api/admin/accounts — admin creates a manual invoice.
export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  const { customerName, customerPhone, items, paid } = parsed.data;

  const subtotal = items.reduce((n, i) => n + i.price * i.qty, 0);
  if (subtotal < 1) return NextResponse.json({ error: "Invoice total too low." }, { status: 400 });

  const created = await prisma.order.create({
    data: {
      customerName,
      customerPhone,
      address: "Manual invoice",
      source: "manual",
      subtotal,
      discountTotal: 0,
      deliveryFee: 0,
      total: subtotal,
      paymentMethod: "manual",
      status: "DELIVERED",
      paymentStatus: paid ? "PAID" : "UNPAID",
      items: { create: items.map((i) => ({ name: i.name, mrp: i.price, price: i.price, qty: i.qty })) },
    },
  });
  const order = await finalizeOrder(created.id); // assigns invoice number

  await audit({
    actor: actorFrom(s),
    action: "invoice.created_manual",
    entityType: "order",
    entityId: order.id,
    summary: `Manual invoice ${order.invoiceNo} for ${customerName} (₹${subtotal})`,
    metadata: { customerName, customerPhone, total: subtotal, paid },
    req,
  });

  return NextResponse.json({ order }, { status: 201 });
}
