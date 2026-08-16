import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { notifyTicket } from "@/lib/notify";

const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"] as const;

const patchSchema = z.object({
  message: z.string().trim().min(1).max(4000).optional(),
  internal: z.boolean().optional().default(false),
  status: z.enum(TICKET_STATUSES).optional(),
});

const STATUS_TEXT: Record<string, string> = {
  OPEN: "reopened",
  IN_PROGRESS: "being looked into",
  WAITING_CUSTOMER: "waiting for your reply",
  RESOLVED: "resolved",
  CLOSED: "closed",
};

// PATCH /api/tickets/[id] — add a reply and/or change status.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  const { message, internal, status } = parsed.data;

  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

  const isStaff = s.role === "admin" || s.role === "kitchen";
  if (!isStaff && ticket.customerId !== s.sub) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Customers may reply but never set status or write internal notes.
  if (!isStaff && (status || internal)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (message) {
    await prisma.ticketMessage.create({
      data: {
        ticketId: id,
        authorType: isStaff ? "staff" : "customer",
        authorLabel: isStaff ? s.username || "Support" : ticket.customerName,
        body: message,
        internal: isStaff ? Boolean(internal) : false,
      },
    });
  }

  const data: { status?: (typeof TICKET_STATUSES)[number]; updatedAt: Date } = { updatedAt: new Date() };
  if (status) data.status = status;
  // A customer reply on a waiting ticket moves it back into the queue.
  else if (!isStaff && ticket.status === "WAITING_CUSTOMER") data.status = "OPEN";

  const updated = await prisma.ticket.update({
    where: { id },
    data,
    include: { messages: { where: isStaff ? {} : { internal: false }, orderBy: { createdAt: "asc" } } },
  });

  await audit({
    actor: actorFrom(s),
    action: status ? "ticket.status_changed" : "ticket.replied",
    entityType: "ticket",
    entityId: id,
    summary: status
      ? `Ticket ${ticket.ticketNo} → ${status}`
      : `Reply on ticket ${ticket.ticketNo}${internal ? " (internal note)" : ""}`,
    metadata: { status, internal: Boolean(internal) },
    req,
  });

  // Notify the customer on staff replies (non-internal) and status changes.
  if (isStaff) {
    if (status && STATUS_TEXT[status]) {
      await notifyTicket(ticket.customerPhone, `Your complaint ${ticket.ticketNo} is now ${STATUS_TEXT[status]}. — Ela & Co.`);
    } else if (message && !internal) {
      await notifyTicket(ticket.customerPhone, `Support replied to your complaint ${ticket.ticketNo}. Open "My Complaints" on our website to read it. — Ela & Co.`);
    }
  }

  return NextResponse.json({ ticket: updated });
}
