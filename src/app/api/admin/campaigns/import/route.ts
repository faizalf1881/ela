import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { parseSheet, SheetError } from "@/lib/sheet-import";

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * POST (multipart, field "file") — reads an Excel or CSV list of customers and
 * returns its columns and rows, with the phone and name columns guessed, so
 * the admin can check them before adding anyone (spec #4).
 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an Excel or CSV file." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "The file is too big (4 MB at most — about 50,000 rows)." }, { status: 400 });
  try {
    return NextResponse.json(await parseSheet(file));
  } catch (e) {
    if (e instanceof SheetError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
