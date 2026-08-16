import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/lib/auth";
import { buildReport, REPORT_TYPES, type ReportType } from "@/lib/report-data";
import { audit, actorFrom } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * GET /api/admin/export?type=orders&format=xlsx|csv
 * Server-side report export. PDF is produced from /admin/reports/[type]
 * (browser "Save as PDF"), which keeps ₹ and Malayalam names rendering correctly.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const type = String(searchParams.get("type") || "") as ReportType;
  const format = (searchParams.get("format") || "xlsx").toLowerCase();

  if (!REPORT_TYPES.includes(type)) {
    return NextResponse.json({ error: `Unknown report. Use one of: ${REPORT_TYPES.join(", ")}` }, { status: 400 });
  }

  const report = await buildReport(type);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `ela-${type}-${stamp}`;

  await audit({
    actor: actorFrom(s),
    action: "report.exported",
    entityType: "report",
    entityId: type,
    summary: `Exported ${report.title} as ${format.toUpperCase()} (${report.rows.length} rows)`,
    req,
  });

  if (format === "csv") {
    const headers = Object.keys(report.rows[0] ?? {});
    const esc = (v: unknown) => {
      const t = v == null ? "" : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = [headers.join(","), ...report.rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\r\n");
    return new NextResponse("﻿" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.csv"`,
      },
    });
  }

  // ---- Excel (.xlsx) ----
  const wb = new ExcelJS.Workbook();
  wb.creator = "Ela & Co.";
  wb.created = new Date();
  const ws = wb.addWorksheet(report.title.slice(0, 30));

  const headers = Object.keys(report.rows[0] ?? { Info: "" });
  ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.min(38, Math.max(12, h.length + 4)) }));

  report.rows.forEach((r) => ws.addRow(r));

  // Header styling + freeze so long reports stay readable.
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4B5A24" } };
  head.alignment = { vertical: "middle" };
  head.height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (report.rows.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  // Right-align + format the money/number columns.
  headers.forEach((h, i) => {
    if (/amount|total|revenue|price|spent|subtotal|delivery|discount|value|paid/i.test(h)) {
      ws.getColumn(i + 1).numFmt = "#,##0";
      ws.getColumn(i + 1).alignment = { horizontal: "right" };
    }
  });

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}.xlsx"`,
    },
  });
}
