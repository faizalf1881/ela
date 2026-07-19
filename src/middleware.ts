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

  if (pathname.startsWith("/admin")) {
    if (role !== "admin") return deny("/staff/login");
  } else if (pathname.startsWith("/kitchen")) {
    if (role !== "kitchen" && role !== "admin") return deny("/staff/login");
  } else if (pathname.startsWith("/orders")) {
    if (role !== "customer") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = "?next=/orders";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/kitchen/:path*", "/orders/:path*"],
};
