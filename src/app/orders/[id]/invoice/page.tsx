import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { inr } from "@/lib/utils";
import { STATUS_LABEL, type OrderStatus } from "@/lib/order-status";
import { PrintButton } from "@/components/site/PrintButton";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) redirect(`/login?next=/orders/${id}/invoice`);

  const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!order) notFound();
  if (s.role === "customer" && order.customerId !== s.sub) redirect("/orders");

  const paid = order.paymentStatus === "PAID";

  return (
    <main className="min-h-screen bg-muted/40 py-10 print:bg-white print:py-0">
      <div className="mx-auto max-w-3xl px-4">
        <div className="mb-6 flex items-center justify-between print:hidden">
          <Link href="/orders" className="inline-flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to orders
          </Link>
          <PrintButton />
        </div>

        <div className="rounded-2xl bg-white text-[#2D2D2D] shadow-soft ring-1 ring-black/5 p-8 print:shadow-none print:ring-0">
          {/* Header */}
          <div className="flex items-start justify-between gap-6 border-b border-black/10 pb-6">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/ela-logo.jpeg" alt="Ela & Co." className="h-14 w-14 rounded-full object-cover" />
              <div>
                <div className="font-serif text-2xl">Ela &amp; Co.</div>
                <div className="text-xs uppercase tracking-[0.2em] text-[#4B5A24]">Ela Cuisine</div>
                <div className="mt-1 text-xs text-black/60">Pattom P.O., Thiruvananthapuram, Kerala — 695004</div>
                <div className="text-xs text-black/60">+91 79075 77979</div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-serif text-xl">Invoice</div>
              <div className="mt-1 text-sm font-medium">{order.invoiceNo || "—"}</div>
              <div className="text-xs text-black/60">{new Date(order.createdAt).toLocaleString("en-IN")}</div>
              <div className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-medium ${paid ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                {paid ? "PAID" : order.paymentMethod === "cod" ? "COD — Pay on delivery" : "UNPAID"}
              </div>
            </div>
          </div>

          {/* Bill to */}
          <div className="grid sm:grid-cols-2 gap-6 py-6 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wider text-black/50">Billed to</div>
              <div className="mt-1 font-medium">{order.customerName}</div>
              <div className="text-black/70">{order.customerPhone}</div>
              <div className="text-black/70">{order.address}</div>
            </div>
            <div className="sm:text-right">
              <div className="text-xs uppercase tracking-wider text-black/50">Order</div>
              <div className="mt-1">#{order.id.slice(-6).toUpperCase()}</div>
              <div className="text-black/70">Status: {STATUS_LABEL[order.status as OrderStatus]}</div>
              <div className="text-black/70">Payment: {order.paymentMethod === "cod" ? "Cash on Delivery" : "Online (Razorpay)"}</div>
            </div>
          </div>

          {/* Items */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-black/10 text-left text-xs uppercase tracking-wider text-black/50">
                <th className="py-2">Item</th>
                <th className="py-2 text-center">Qty</th>
                <th className="py-2 text-right">Rate</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it) => (
                <tr key={it.id} className="border-b border-black/5">
                  <td className="py-3">{it.name}</td>
                  <td className="py-3 text-center">{it.qty}</td>
                  <td className="py-3 text-right">
                    {inr(it.price)}
                    {it.mrp > it.price && <span className="ml-1 text-xs text-black/40 line-through">{inr(it.mrp)}</span>}
                  </td>
                  <td className="py-3 text-right">{inr(it.price * it.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="mt-4 ml-auto max-w-xs space-y-1.5 text-sm">
            <Row label="Subtotal" value={inr(order.subtotal)} />
            {order.discountTotal > 0 && <Row label="You saved" value={`- ${inr(order.discountTotal)}`} green />}
            {order.couponDiscount > 0 && <Row label={`Coupon${order.couponCode ? ` (${order.couponCode})` : ""}`} value={`- ${inr(order.couponDiscount)}`} green />}
            <Row label="Delivery" value={order.deliveryFee > 0 ? inr(order.deliveryFee) : "Free"} />
            <div className="my-2 border-t border-black/10" />
            <div className="flex items-center justify-between font-serif text-lg">
              <span>Total</span>
              <span>{inr(order.total)}</span>
            </div>
          </div>

          <div className="mt-8 border-t border-black/10 pt-4 text-center text-xs text-black/50">
            Thank you for ordering from Ela &amp; Co. · Questions? WhatsApp us at +91 79075 77979
          </div>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-black/60">{label}</span>
      <span className={green ? "text-green-600" : ""}>{value}</span>
    </div>
  );
}
