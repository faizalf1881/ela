import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";

const schema = z.object({
  authorName: z.string().trim().min(1).max(80),
  location: z.string().max(80).optional(),
  rating: z.number().int().min(1).max(5).default(5),
  body: z.string().trim().min(4).max(600),
});

// POST /api/reviews/submit — public review collection. Saved unpublished for moderation.
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please fill in your name and review." }, { status: 400 });

  const review = await prisma.review.create({
    data: {
      authorName: parsed.data.authorName,
      location: parsed.data.location || null,
      rating: parsed.data.rating,
      body: parsed.data.body,
      published: false, // awaits admin moderation
      source: "collected",
    },
  });

  await audit({
    actor: { type: "customer", label: parsed.data.authorName },
    action: "review.submitted",
    entityType: "review",
    entityId: review.id,
    summary: `New review submitted by ${parsed.data.authorName} (pending moderation)`,
    req,
  });

  return NextResponse.json({ ok: true });
}
