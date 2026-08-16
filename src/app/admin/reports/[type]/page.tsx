import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/lib/auth";
import { buildReport, REPORT_TYPES, type ReportType } from "@/lib/report-data";
import { PrintButton } from "@/components/site/PrintButton";

export const dynamic = "force-dynamic";

/** Print-ready report — use the browser's "Save as PDF" to get a PDF export. */
export default async function ReportPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const s = await getSession();
  if (s?.role !== "admin") redirect("/staff/login");
  if (!REPORT_TYPES.includes(type as ReportType)) notFound();

  const report = await buildReport(type as ReportType);
  const headers = Object.keys(report.rows[0] ?? {});
  const isNumeric = (h: string) => /amount|total|revenue|price|spent|subtotal|delivery|discount|value|paid|orders|qty|stock|used|messages|payments|items sold/i.test(h);

  return (
    <main className="min-h-screen bg-muted/40 py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mb-6 flex items-center justify-between print:hidden">
          <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to admin
          </Link>
          <PrintButton />
        </div>

        <div className="rounded-2xl bg-white text-[#2D2D2D] p-8 shadow-soft ring-1 ring-black/5 print:shadow-none print:ring-0 print:p-0">
          <div className="flex items-start justify-between border-b-2 border-black/80 pb-4">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/ela-logo.jpeg" alt="Ela & Co." className="h-12 w-12 rounded-full object-cover" />
              <div>
                <div className="font-serif text-2xl">Ela &amp; Co.</div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#4B5A24]">Ela Cuisine · Thiruvananthapuram</div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-serif text-xl">{report.title}</div>
              <div className="text-xs text-black/60">Generated {new Date().toLocaleString("en-IN")}</div>
              <div className="text-xs text-black/60">{report.rows.length} rows</div>
            </div>
          </div>

          {report.rows.length === 0 ? (
            <p className="py-12 text-center text-black/50">No data for this report yet.</p>
          ) : (
            <table className="mt-5 w-full text-[11px]">
              <thead>
                <tr className="border-b border-black/30 text-left uppercase tracking-wider text-black/60">
                  {headers.map((h) => (
                    <th key={h} className={`py-2 pr-3 ${isNumeric(h) ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r, i) => (
                  <tr key={i} className="border-b border-black/10 break-inside-avoid">
                    {headers.map((h) => (
                      <td key={h} className={`py-1.5 pr-3 align-top ${isNumeric(h) ? "text-right tabular-nums" : ""}`}>
                        {String(r[h] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="mt-8 border-t border-black/10 pt-3 text-center text-[10px] text-black/50">
            Ela &amp; Co. · {report.title} · confidential
          </div>
        </div>
      </div>
    </main>
  );
}
