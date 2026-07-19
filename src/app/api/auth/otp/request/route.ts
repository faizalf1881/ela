import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/utils";
import { generateOtp, hashOtp, OTP_TTL_MS } from "@/lib/otp";
import { sendOtp } from "@/lib/whatsapp";
import { audit } from "@/lib/audit";

export async function POST(req: Request) {
  let body: { phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const phone = normalizePhone(body.phone || "");
  if (!phone) {
    return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });
  }

  // Basic throttle: don't allow more than 1 OTP per 30s per phone.
  const recent = await prisma.otpCode.findFirst({
    where: { phone, createdAt: { gt: new Date(Date.now() - 30_000) } },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    return NextResponse.json({ error: "Please wait a moment before requesting another code." }, { status: 429 });
  }

  const code = generateOtp();
  await prisma.otpCode.create({
    data: {
      phone,
      codeHash: hashOtp(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  const result = await sendOtp(phone, code);
  if (!result.ok) {
    return NextResponse.json({ error: "Could not send the code. Try again." }, { status: 502 });
  }

  await audit({ actor: { type: "system", label: phone }, action: "auth.otp_requested", entityType: "auth", summary: `OTP sent to ${phone} (${result.via})`, req });
  return NextResponse.json({ ok: true, via: result.via });
}
