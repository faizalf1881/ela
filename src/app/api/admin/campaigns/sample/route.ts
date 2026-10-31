import ExcelJS from "exceljs";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

/** GET — a ready-to-fill Excel sheet for a customer list. */
export async function GET() {
  const s = await getSession();
  if (s?.role !== "admin") return new Response("Forbidden", { status: 403 });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Customers");
  ws.columns = [
    { header: "Name", key: "name", width: 24 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Area", key: "area", width: 18 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.addRow({ name: "Anjali Menon", phone: "9876543210", area: "Pattom" });
  ws.addRow({ name: "Rahul Krishnan", phone: "+91 98470 12345", area: "Kowdiar" });
  // Text format keeps long numbers exactly as typed.
  ws.getColumn("phone").numFmt = "@";
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="ela-whatsapp-customers.xlsx"',
    },
  });
}
