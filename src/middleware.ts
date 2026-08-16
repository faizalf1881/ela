import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE = "ela_session";

type Role = "customer" | "kitchen" | "admin";

async function getRole(req: NextRequest): Promise<Role | null> {
  const token = req.cookies.get(COOKIE)?.value;
  const secret = process.env.JWT_SECRET;
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return (payload.role as Role) ?? null;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const role = await getRole(req);

  const deny = (to: string) => {
    const url = req.nextUrl.clone();
    url.pathname = to;
    url.search = "";
    return NextResponse.redirect(url);
  };

  const isStaff = role === "admin" || role === "kitchen";
  // Staff open invoices and delivery labels for any order; each page re-checks ownership.
  const staffViewableOrderDoc = /^\/orders\/[^/]+\/(invoice|label)$/.test(pathname);

  if (pathname.startsWith("/admin")) {
    if (role !== "admin") return deny("/staff/login");
  } else if (pathname.startsWith("/kitchen")) {
    if (!isStaff) return deny("/staff/login");
  } else if (pathname.startsWith("/orders") || pathname.startsWith("/support")) {
    if (staffViewableOrderDoc && isStaff) return NextResponse.next();
    if (role !== "customer") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${pathname}`;
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/kitchen/:path*", "/orders/:path*", "/support/:path*"],
};
