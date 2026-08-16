"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Paperclip, Loader2, X, FileText } from "lucide-react";

export type UploadedFile = { url: string; filename: string; mimeType: string };

/** Attach images or PDFs (max 3, 2 MB each) to a complaint or reply. */
export function FileUpload({
  files,
  onChange,
  disabled,
  label = "Attach photo or document",
}: {
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function upload(list: FileList) {
    const room = 3 - files.length;
    if (room <= 0) return toast.error("You can attach up to 3 files");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("kind", "ticket");
      Array.from(list).slice(0, room).forEach((f) => fd.append("file", f));
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      onChange([...files, ...data.files]);
      toast.success(`${data.files.length} file${data.files.length > 1 ? "s" : ""} attached`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs ${disabled || busy ? "opacity-60" : "cursor-pointer hover:bg-muted"}`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
          {busy ? "Uploading…" : label}
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
            className="hidden"
            disabled={disabled || busy || files.length >= 3}
            onChange={(e) => {
              if (e.target.files?.length) upload(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        {files.length > 0 && <span className="text-[11px] text-muted-foreground">{files.length}/3</span>}
      </div>

      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((f) => (
            <span key={f.url} className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-[11px]">
              <FileText className="h-3 w-3 shrink-0" />
              <span className="max-w-[10rem] truncate">{f.filename}</span>
              <button type="button" onClick={() => onChange(files.filter((x) => x.url !== f.url))} className="text-muted-foreground hover:text-destructive" aria-label="Remove">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Renders attachment links inside a message thread. */
export function Attachments({ urls }: { urls: string[] }) {
  if (!urls?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {urls.map((u, i) => (
        <a
          key={u}
          href={u}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
        >
          <Paperclip className="h-3 w-3" /> Attachment {i + 1}
        </a>
      ))}
    </div>
  );
}
