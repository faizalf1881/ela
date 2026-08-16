import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { notifyTicket } from "@/lib/notify";
import type { Prisma } from "@prisma/client";

const TICKET_CATEGORIES = [
  "Order Issue",
  "Payment Issue",
  "Delivery Issue",
  "Refund Request",
  "Subscription Issue",
  "Technical Issue",
  "Feedback",
  "Other",
] as const;

// GET /api/tickets — customer: own tickets. staff/admin: all (with filters).
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "";
  const category = searchParams.get("category") || "";
  const q = (searchParams.get("q") || "").trim();

  let where: Prisma.TicketWhereInput = {};
  if (s.role === "customer") {
    where = { customerId: s.sub };
  } else {
    if (status) where.status = status as Prisma.TicketWhereInput["status"];
    if (category) where.category = category;
    if (q) {
      where.OR = [
        { ticketNo: { contains: q, mode: "insensitive" } },
        { customerName: { contains: q, mode: "insensitive" } },
        { customerPhone: { contains: q } },
        { subject: { contains: q, mode: "insensitive" } },
        { orderId: { contains: q } },
      ];
    }
  }

  const tickets = await prisma.ticket.findMany({
    where,
    include: {
      messages: {
        // customers never see internal admin notes
        where: s.role === "customer" ? { internal: false } : {},
        orderBy: { createdAt: "asc" },
      },
      order: { select: { id: true, invoiceNo: true, total: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return NextResponse.json({ tickets });
}

const createSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  subject: z.string().trim().min(3).max(160),
  body: z.string().trim().min(5).max(4000),
  orderId: z.string().trim().max(60).optional(),
  attachments: z.array(z.string().regex(/^\/api\/media\/[A-Za-z0-9_-]+$/)).max(3).optional().default([]),
});

// POST /api/tickets — customer raises a complaint / support ticket.
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "customer") return NextResponse.json({ error: "Please log in to raise a ticket." }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please fill in the subject and description." }, { status: 400 });

  const customer = await prisma.customer.findUnique({ where: { id: s.sub } });
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  // Only allow attaching an order that belongs to this customer.
  let orderId: string | null = null;
  if (parsed.data.orderId) {
    const own = await prisma.order.findFirst({ where: { id: parsed.data.orderId, customerId: s.sub }, select: { id: true } });
    orderId = own?.id ?? null;
  }

  const counter = await prisma.counter.upsert({
    where: { name: "ticket" },
    update: { value: { increment: 1 } },
    create: { name: "ticket", value: 1 },
  });
  const ticketNo = "TKT-" + String(counter.value).padStart(5, "0");

  const ticket = await prisma.ticket.create({
    data: {
      ticketNo,
      customerId: customer.id,
      customerName: customer.name || "Customer",
      customerPhone: customer.phone,
      category: parsed.data.category,
      subject: parsed.data.subject,
      orderId,
      status: "OPEN",
      messages: {
        create: {
          authorType: "customer",
          authorLabel: customer.name || customer.phone,
          body: parsed.data.body,
          attachments: parsed.data.attachments,
        },
      },
    },
    include: { messages: true },
  });

  await audit({
    actor: actorFrom(s),
    action: "ticket.created",
    entityType: "ticket",
    entityId: ticket.id,
    summary: `Ticket ${ticketNo} raised (${parsed.data.category})`,
    metadata: { category: parsed.data.category, subject: parsed.data.subject, orderId },
    req,
  });

  await notifyTicket(customer.phone, `Your complaint ${ticketNo} has been registered. We'll get back to you shortly. — Ela & Co.`);

  return NextResponse.json({ ticket }, { status: 201 });
}
