import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/utils";
import { hashOtp, OTP_MAX_ATTEMPTS } from "@/lib/otp";
import { setSessionCookie } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(req: Request) {
  let body: { phone?: string; code?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const phone = normalizePhone(body.phone || "");
  const code = (body.code || "").trim();
  if (!phone || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the 6-digit code" }, { status: 400 });
  }

  const otp = await prisma.otpCode.findFirst({
    where: { phone, consumed: false },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) {
    return NextResponse.json({ error: "No active code. Request a new one." }, { status: 400 });
  }
  if (otp.expiresAt < new Date()) {
    return NextResponse.json({ error: "Code expired. Request a new one." }, { status: 400 });
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 429 });
  }

  if (otp.codeHash !== hashOtp(code)) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return NextResponse.json({ error: "Incorrect code" }, { status: 400 });
  }

  // Success — consume the code and all others for this phone.
  await prisma.otpCode.updateMany({ where: { phone, consumed: false }, data: { consumed: true } });

  const customer = await prisma.customer.upsert({
    where: { phone },
    update: { lastLoginAt: new Date(), ...(body.name ? { name: body.name } : {}) },
    create: { phone, name: body.name || null, lastLoginAt: new Date() },
  });

  await setSessionCookie({
    sub: customer.id,
    role: "customer",
    phone: customer.phone,
    name: customer.name || undefined,
  });

  await audit({ actor: { type: "customer", id: customer.id, label: customer.phone }, action: "auth.customer_login", entityType: "auth", entityId: customer.id, summary: `Customer ${customer.phone} logged in`, req });

  return NextResponse.json({
    ok: true,
    user: { sub: customer.id, role: "customer", phone: customer.phone, name: customer.name },
  });
}
