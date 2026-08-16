import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { inr } from "@/lib/utils";
import { STATUS_LABEL, type OrderStatus } from "@/lib/order-status";
import { PrintButton } from "@/components/site/PrintButton";
import { qrSvg } from "@/lib/qr";

export const dynamic = "force-dynamic";

/** Kitchen delivery label with a QR code encoding the order id (spec #15). */
export default async function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect(`/staff/login`);
  if (s.role === "customer") redirect("/orders");

  const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!order) notFound();

  const shortId = order.id.slice(-6).toUpperCase();
  const qr = await qrSvg(order.id, 150);
  const paid = order.paymentStatus === "PAID";

  return (
    <main className="min-h-screen bg-muted/40 py-10 print:bg-white print:py-0">
      <div className="mx-auto max-w-md px-4">
        <div className="mb-6 flex items-center justify-between print:hidden">
          <Link href="/kitchen" className="inline-flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to board
          </Link>
          <PrintButton />
        </div>

        {/* Label — sized for a standard 4x6 / A6 sticker */}
        <div className="rounded-xl bg-white text-black ring-1 ring-black/10 p-5 print:ring-0 print:rounded-none">
          <div className="flex items-start justify-between gap-3 border-b-2 border-black pb-3">
            <div>
              <div className="font-serif text-2xl leading-none">Ela &amp; Co.</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-black/60">Ela Cuisine · Trivandrum</div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold leading-none">#{shortId}</div>
              <div className="text-[10px] text-black/60">{new Date(order.createdAt).toLocaleString("en-IN")}</div>
            </div>
          </div>

          <div className="flex gap-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-black/50">Deliver to</div>
              <div className="text-lg font-semibold leading-tight">{order.customerName}</div>
              <div className="text-base font-medium">{order.customerPhone}</div>
              <div className="mt-1 text-sm leading-snug">{order.address}</div>
            </div>
            {/* QR encodes the order id for scanning */}
            <div className="shrink-0" dangerouslySetInnerHTML={{ __html: qr }} />
          </div>

          <div className="border-t border-black/20 pt-2">
            <div className="text-[10px] uppercase tracking-wider text-black/50">Items</div>
            <table className="w-full text-sm">
              <tbody>
                {order.items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-0.5 font-semibold w-8">{it.qty}×</td>
                    <td className="py-0.5">{it.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between border-t-2 border-black pt-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-black/50">Status</div>
              <div className="text-sm font-semibold">{STATUS_LABEL[order.status as OrderStatus]}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-black/50">
                {order.paymentMethod === "cod" ? "Collect cash" : "Payment"}
              </div>
              <div className={`text-xl font-bold ${paid ? "" : "underline"}`}>
                {order.paymentMethod === "cod" && !paid ? inr(order.total) : paid ? "PAID" : inr(order.total)}
              </div>
            </div>
          </div>

          {order.invoiceNo && <div className="mt-2 text-center text-[10px] text-black/50">{order.invoiceNo}</div>}
        </div>
      </div>
    </main>
  );
}
