import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/media/[id] — serve an uploaded file.
 * Menu photos are public (they appear on the storefront). Complaint attachments
 * are private: only staff, or the customer who owns the ticket, may fetch them.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (asset.kind === "ticket") {
    const s = await getSession();
    if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (s.role === "customer") {
      const url = `/api/media/${id}`;
      const owns = await prisma.ticketMessage.findFirst({
        where: { attachments: { has: url }, ticket: { customerId: s.sub } },
        select: { id: true },
      });
      if (!owns) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const body = new Uint8Array(asset.data);
  return new NextResponse(body, {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(asset.size),
      "Content-Disposition": `inline; filename="${encodeURIComponent(asset.filename)}"`,
      // Content is immutable per id; menu images can sit on the CDN.
      "Cache-Control": asset.kind === "menu" ? "public, max-age=31536000, immutable" : "private, max-age=3600",
    },
  });
}
