import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";

// GET /api/staff — admin: list kitchen staff.
export async function GET() {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const staff = await prisma.staffUser.findMany({
    where: { role: "KITCHEN" },
    select: { id: true, username: true, name: true, active: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ staff });
}

const createSchema = z.object({
  username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, . _ - only"),
  password: z.string().min(6).max(100),
  name: z.string().max(80).optional(),
});

// POST /api/staff — admin: create a kitchen staff account.
export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid data" }, { status: 400 });
  }
  const { username, password, name } = parsed.data;

  const exists = await prisma.staffUser.findUnique({ where: { username } });
  if (exists) {
    return NextResponse.json({ error: "Username already taken" }, { status: 409 });
  }

  const staff = await prisma.staffUser.create({
    data: { username, passwordHash: await bcrypt.hash(password, 10), name: name || null, role: "KITCHEN" },
    select: { id: true, username: true, name: true, active: true, createdAt: true },
  });
  await audit({ actor: actorFrom(s), action: "staff.created", entityType: "staffUser", entityId: staff.id, summary: `Created kitchen account "${staff.username}"`, metadata: { username: staff.username, name: staff.name }, req });
  return NextResponse.json({ staff }, { status: 201 });
}
