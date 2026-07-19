import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

export type Role = "customer" | "kitchen" | "admin";

export type SessionUser = {
  sub: string; // customer id or staff id
  role: Role;
  name?: string;
  phone?: string;
  username?: string;
};

const COOKIE = "ela_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error("JWT_SECRET is not set (min 16 chars). Add it to .env");
  }
  return new TextEncoder().encode(s);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
}

export async function setSessionCookie(user: SessionUser) {
  const token = await signSession(user);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      sub: String(payload.sub),
      role: payload.role as Role,
      name: payload.name as string | undefined,
      phone: payload.phone as string | undefined,
      username: payload.username as string | undefined,
    };
  } catch {
    return null;
  }
}

/** Returns the session if its role is allowed, else null. */
export async function requireRole(...roles: Role[]): Promise<SessionUser | null> {
  const s = await getSession();
  if (!s) return null;
  if (roles.length && !roles.includes(s.role)) return null;
  return s;
}

export const isStaff = (r?: Role) => r === "admin" || r === "kitchen";
