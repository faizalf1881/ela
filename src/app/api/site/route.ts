import { NextResponse } from "next/server";
import { getSiteContent } from "@/lib/menu-cache";
import { publicSiteInfo } from "@/lib/site-content";

// GET /api/site — public contact/delivery details for client pages (footer). Cached.
export async function GET() {
  return NextResponse.json({ info: publicSiteInfo(await getSiteContent()) });
}
