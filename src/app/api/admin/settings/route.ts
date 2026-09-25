import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { normalizeScanSteps } from "@/lib/order-flow";
import { CACHE_TAGS } from "@/lib/menu-cache";
import { DEFAULT_ORDER_SOUND } from "@/lib/order-sound-config";
import { DEFAULT_MESSAGES, NOTIFY_STATUSES, PLACEHOLDERS, type NotifyStatus } from "@/lib/order-notify";
import { whatsappConfigured } from "@/lib/whatsapp";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operational settings for staff screens (never cached, never public): the
 * QR-scan workflow, the new-order alert and WhatsApp order updates. Kitchen
 * staff may read; only admins may change.
 */
async function load() {
  const s =
    (await prisma.storeSetting.findUnique({ where: { id: 1 } })) ??
    (await prisma.storeSetting.create({ data: { id: 1, acceptingOrders: true } }));
  return {
    scanSteps: normalizeScanSteps(s.scanSteps),
    orderAlert: {
      soundUrl: s.orderSoundUrl || DEFAULT_ORDER_SOUND,
      customSound: s.orderSoundUrl ? { url: s.orderSoundUrl, name: s.orderSoundName || "Custom sound" } : null,
      seconds: s.orderAlertSeconds,
    },
    notify: {
      configured: whatsappConfigured(),
      statuses: s.notifyStatuses.filter((x): x is NotifyStatus => (NOTIFY_STATUSES as readonly string[]).includes(x)),
      // Custom wording per status; statuses without one use the built-in text.
      custom: Object.fromEntries(
        Object.entries((s.notifyMessages as Record<string, unknown> | null) ?? {}).filter(([, v]) => typeof v === "string" && v.trim()),
      ) as Partial<Record<NotifyStatus, string>>,
      defaults: DEFAULT_MESSAGES,
      placeholders: PLACEHOLDERS,
      template: s.waStatusTemplate,
      templateLang: s.waStatusTemplateLang,
    },
  };
}

export async function GET() {
  const s = await getSession();
  if (!s || (s.role !== "admin" && s.role !== "kitchen")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await load());
}

const schema = z.object({
  scanSteps: z.array(z.enum(["PLACED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"])).max(4).optional(),
  // null = back to the built-in chime.
  orderSoundUrl: z.string().regex(/^\/api\/media\/[a-z0-9]+$/i).nullable().optional(),
  orderAlertSeconds: z.number().int().min(3).max(30).optional(),
  notifyStatuses: z.array(z.enum(NOTIFY_STATUSES)).max(5).optional(),
  // null / "" for a status = back to the built-in wording.
  notifyMessages: z.record(z.enum(NOTIFY_STATUSES), z.string().max(1000).nullable()).optional(),
  // Meta template names are lower-case letters, digits and underscores.
  waStatusTemplate: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Template names use lower-case letters, digits and _").nullable().or(z.literal("")).optional(),
  waStatusTemplateLang: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/).optional(),
});

export async function PATCH(req: Request) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json({ error: first?.message && first.code === "invalid_string" ? first.message : "Invalid settings" }, { status: 400 });
  }

  await load(); // make sure the row exists
  const d = parsed.data;
  const data: {
    scanSteps?: ReturnType<typeof normalizeScanSteps>;
    orderSoundUrl?: string | null;
    orderSoundName?: string | null;
    orderAlertSeconds?: number;
    notifyStatuses?: NotifyStatus[];
    notifyMessages?: Prisma.InputJsonValue;
    waStatusTemplate?: string | null;
    waStatusTemplateLang?: string;
  } = {};
  const changes: string[] = [];

  if (d.scanSteps) {
    data.scanSteps = normalizeScanSteps(d.scanSteps);
    changes.push(`QR scan workflow set to ${data.scanSteps.join(" → ")}`);
  }
  if (d.orderSoundUrl !== undefined) {
    if (d.orderSoundUrl === null) {
      data.orderSoundUrl = null;
      data.orderSoundName = null;
      changes.push("New-order sound reset to the built-in chime");
    } else {
      // Only a sound this admin uploaded as an alert sound may be used.
      const asset = await prisma.mediaAsset.findUnique({
        where: { id: d.orderSoundUrl.split("/").pop()! },
        select: { kind: true, filename: true },
      });
      if (!asset || asset.kind !== "sound") return NextResponse.json({ error: "Upload the sound file first." }, { status: 400 });
      data.orderSoundUrl = d.orderSoundUrl;
      data.orderSoundName = asset.filename;
      changes.push(`New-order sound set to "${asset.filename}"`);
    }
  }
  if (d.orderAlertSeconds !== undefined) {
    data.orderAlertSeconds = d.orderAlertSeconds;
    changes.push(`New-order alert shows for ${d.orderAlertSeconds}s`);
  }
  if (d.notifyStatuses) {
    data.notifyStatuses = NOTIFY_STATUSES.filter((x) => d.notifyStatuses!.includes(x));
    changes.push(`WhatsApp updates sent for: ${data.notifyStatuses.join(", ") || "no statuses"}`);
  }
  if (d.notifyMessages) {
    const current = await prisma.storeSetting.findUnique({ where: { id: 1 }, select: { notifyMessages: true } });
    const merged: Record<string, string> = { ...((current?.notifyMessages as Record<string, string> | null) ?? {}) };
    for (const [status, text] of Object.entries(d.notifyMessages)) {
      if (text && text.trim()) merged[status] = text.trim();
      else delete merged[status];
    }
    data.notifyMessages = merged;
    changes.push(`WhatsApp update wording changed (${Object.keys(d.notifyMessages).join(", ")})`);
  }
  if (d.waStatusTemplate !== undefined) {
    data.waStatusTemplate = d.waStatusTemplate || null;
    changes.push(data.waStatusTemplate ? `WhatsApp status template set to ${data.waStatusTemplate}` : "WhatsApp status template removed");
  }
  if (d.waStatusTemplateLang) data.waStatusTemplateLang = d.waStatusTemplateLang;

  await prisma.storeSetting.update({ where: { id: 1 }, data });
  // The customer confirmation sound is served through the cached public settings.
  if (d.orderSoundUrl !== undefined) revalidateTag(CACHE_TAGS.settings);

  await audit({
    actor: actorFrom(s),
    action: "settings.updated",
    entityType: "storeSetting",
    summary: changes.join("; ") || "Updated operational settings",
    metadata: { ...data },
    req,
  });
  return NextResponse.json(await load());
}
