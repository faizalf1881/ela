import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/media/[id] — serve an uploaded file.
 * Menu photos and the alert sound are public (storefront / order confirmation).
 * Complaint attachments are private: only staff, or the customer who owns the
 * ticket, may fetch them.
 *
 * Byte ranges are honoured: Safari (notably on iPhone) will not play audio from
 * a server that ignores `Range`.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const headers: Record<string, string> = {
    "Content-Type": asset.mimeType,
    "Content-Disposition": `inline; filename="${encodeURIComponent(asset.filename)}"`,
    "Accept-Ranges": "bytes",
    // Content is immutable per id; public assets can sit on the CDN.
    "Cache-Control": asset.kind === "ticket" ? "private, max-age=3600" : "public, max-age=31536000, immutable",
  };

  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const size = body.byteLength;
    // "bytes=-500" means the last 500 bytes.
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }
    start = Math.max(0, start);
    return new NextResponse(body.subarray(start, end + 1), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }

  return new NextResponse(body, { headers: { ...headers, "Content-Length": String(body.byteLength) } });
}
