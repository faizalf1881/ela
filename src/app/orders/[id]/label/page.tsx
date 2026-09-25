import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { inr } from "@/lib/utils";
import { PrintButton } from "@/components/site/PrintButton";
import { qrSvg } from "@/lib/qr";

export const dynamic = "force-dynamic";

/**
 * Kitchen delivery label with a QR code encoding the order id (spec #15).
 *
 * The label deliberately carries no order status: it is printed once and stuck
 * on the bag, so any status on it would be stale by the time it is read. Staff
 * scan the QR to see and advance the live status instead.
 */
export default async function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect(`/staff/login`);
  if (s.role === "customer") redirect("/orders");

  const order = await prisma.order.findUnique({ where: { id }, include: { items: true, deliverySlot: true } });
  if (!order) notFound();

  const shortId = order.id.slice(-6).toUpperCase();
  const qr = await qrSvg(order.id, 150);

  // What the rider must do about money at the door.
  const isCod = order.paymentMethod === "cod" && order.paymentStatus !== "PAID";
  const cashDue = isCod ? (order.codBalanceDue > 0 ? order.codBalanceDue : order.total) : 0;
  const prepaidPlan = order.paymentMethod === "subscription";

  const deliveryDay = order.deliveryDate
    ? new Date(order.deliveryDate).toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
    : null;

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
          <div className="flex items-center justify-between gap-3 border-b-2 border-black pb-3">
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/ela-logo.png" alt="Ela & Co." width={44} height={44} className="h-11 w-11 object-contain" />
              <div>
                <div className="font-serif text-2xl leading-none">Ela &amp; Co.</div>
                <div className="whitespace-nowrap text-[10px] uppercase tracking-[0.12em] text-black/60">Ela Cuisine · Trivandrum</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-black/50">Order</div>
              <div className="text-3xl font-bold leading-none" data-testid="label-order-id">#{shortId}</div>
              {order.invoiceNo && <div className="text-[11px] font-medium text-black/70">{order.invoiceNo}</div>}
            </div>
          </div>

          <div className="flex gap-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-black/50">Deliver to</div>
              <div className="text-lg font-semibold leading-tight">{order.customerName}</div>
              <div className="text-base font-medium">{order.customerPhone}</div>
              <div className="mt-1 text-sm leading-snug">{order.address}</div>
            </div>
            {/* QR encodes the order id: scanning it advances the order to its next step. */}
            <div className="shrink-0" dangerouslySetInnerHTML={{ __html: qr }} />
          </div>

          {(deliveryDay || order.deliverySlot) && (
            <div className="border-t border-black/20 py-2">
              <div className="text-[10px] uppercase tracking-wider text-black/50">Delivery</div>
              <div className="text-base font-semibold">
                {deliveryDay}
                {deliveryDay && order.deliverySlot ? " · " : ""}
                {order.deliverySlot?.label}
              </div>
            </div>
          )}

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

          {order.notes && (
            <div className="mt-2 border-t border-black/20 pt-2">
              <div className="text-[10px] uppercase tracking-wider text-black/50">Note</div>
              <div className="text-sm leading-snug">{order.notes}</div>
            </div>
          )}

          <div className="mt-3 flex items-end justify-between gap-3 border-t-2 border-black pt-2">
            <div className="text-[10px] text-black/60">
              Placed {new Date(order.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
            </div>
            <div className="text-right" data-testid="label-payment">
              <div className="text-[10px] uppercase tracking-wider text-black/50">{isCod ? "Collect cash" : "Payment"}</div>
              <div className={`text-xl font-bold ${isCod ? "underline" : ""}`}>
                {isCod ? inr(cashDue) : prepaidPlan ? "PREPAID · PLAN" : order.paymentStatus === "PAID" ? "PAID" : inr(order.total)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
