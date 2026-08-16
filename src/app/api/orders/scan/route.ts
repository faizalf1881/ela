import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

const schema = z.object({ code: z.string().trim().min(3).max(200) });

/**
 * POST /api/orders/scan — staff scan a delivery-label QR (or type an order id /
 * short code) and get the matching order back. Accepts the full order id, a
 * URL containing it, the 6-char short code, or an invoice number.
 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role === "customer") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid scan" }, { status: 400 });

  // A scanner may deliver a URL — take the last path segment.
  const raw = parsed.data.code.trim();
  const code = raw.includes("/") ? raw.split("/").filter(Boolean).pop()! : raw;

  let order = await prisma.order.findUnique({ where: { id: code }, include: { items: true } });

  if (!order) {
    order = await prisma.order.findFirst({
      where: { OR: [{ invoiceNo: code.toUpperCase() }, { id: { endsWith: code.toLowerCase() } }] },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });
  }

  if (!order) return NextResponse.json({ error: "No order matches that code" }, { status: 404 });
  return NextResponse.json({ order });
}
