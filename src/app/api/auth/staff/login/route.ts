import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { setSessionCookie, type Role } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const username = (body.username || "").trim();
  const password = body.password || "";
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }

  const staff = await prisma.staffUser.findUnique({ where: { username } });
  if (!staff || !staff.active) {
    await audit({ actor: { type: "system", label: username }, action: "auth.staff_login_failed", entityType: "auth", summary: `Failed login for "${username}" (unknown/inactive)`, req });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const ok = await bcrypt.compare(password, staff.passwordHash);
  if (!ok) {
    await audit({ actor: { type: "system", label: username }, action: "auth.staff_login_failed", entityType: "auth", entityId: staff.id, summary: `Failed login for "${username}" (bad password)`, req });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const role: Role = staff.role === "ADMIN" ? "admin" : "kitchen";
  await setSessionCookie({
    sub: staff.id,
    role,
    username: staff.username,
    name: staff.name || undefined,
  });
  await audit({ actor: { type: role, id: staff.id, label: staff.username }, action: "auth.staff_login", entityType: "auth", entityId: staff.id, summary: `${role} "${staff.username}" signed in`, req });

  return NextResponse.json({
    ok: true,
    user: { sub: staff.id, role, username: staff.username, name: staff.name },
  });
}
