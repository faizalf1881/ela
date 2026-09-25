import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";

export const runtime = "nodejs";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB per file
const MAX_SOUND_BYTES = 3 * 1024 * 1024; // alert sounds: 3 MB (Vercel caps bodies at 4.5 MB)
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const DOC_TYPES = ["application/pdf"];
// Browsers label the same formats differently (e.g. audio/mp3 vs audio/mpeg).
const AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
];

/**
 * POST /api/uploads — multipart file upload.
 *   kind=menu   → admin only, images only (dish photos)
 *   kind=ticket → logged-in customer/staff, images or PDF (complaint evidence)
 *   kind=sound  → admin only, one audio file (the new-order alert sound; stored
 *                 exactly as uploaded)
 * Files are stored in Postgres and served back from /api/media/<id>, so no
 * external object store is required.
 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Please log in to upload." }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const kind = String(form.get("kind") || "ticket");
  if (kind !== "menu" && kind !== "ticket" && kind !== "sound") {
    return NextResponse.json({ error: "Unknown upload type" }, { status: 400 });
  }
  if ((kind === "menu" || kind === "sound") && s.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (files.length > (kind === "sound" ? 1 : 3)) {
    return NextResponse.json({ error: kind === "sound" ? "Upload one sound file" : "Up to 3 files at a time" }, { status: 400 });
  }

  const allowed = kind === "menu" ? IMAGE_TYPES : kind === "sound" ? AUDIO_TYPES : [...IMAGE_TYPES, ...DOC_TYPES];
  const maxBytes = kind === "sound" ? MAX_SOUND_BYTES : MAX_BYTES;
  const uploaded: { id: string; url: string; filename: string; mimeType: string; size: number }[] = [];

  for (const file of files) {
    if (!allowed.includes(file.type)) {
      return NextResponse.json(
        {
          error:
            kind === "menu"
              ? "Please upload a JPG, PNG, WEBP or GIF image."
              : kind === "sound"
                ? "Please upload an MP3, WAV, M4A or OGG audio file."
                : "Only images or PDF files are allowed.",
        },
        { status: 415 },
      );
    }
    if (file.size > maxBytes) {
      return NextResponse.json({ error: `"${file.name}" is larger than ${maxBytes / 1024 / 1024} MB.` }, { status: 413 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const asset = await prisma.mediaAsset.create({
      data: {
        filename: file.name.slice(0, 180) || "upload",
        mimeType: file.type,
        size: bytes.byteLength,
        kind,
        data: bytes,
      },
      select: { id: true, filename: true, mimeType: true, size: true },
    });
    uploaded.push({ ...asset, url: `/api/media/${asset.id}` });
  }

  await audit({
    actor: actorFrom(s),
    action: "media.uploaded",
    entityType: "media",
    entityId: uploaded[0]?.id,
    summary: `Uploaded ${uploaded.length} ${kind} file${uploaded.length > 1 ? "s" : ""}`,
    metadata: { kind, files: uploaded.map((u) => ({ name: u.filename, size: u.size })) },
    req,
  });

  return NextResponse.json({ files: uploaded }, { status: 201 });
}
