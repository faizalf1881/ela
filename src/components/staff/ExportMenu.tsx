"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Table, ChevronDown } from "lucide-react";

/** Export the current dataset as Excel, CSV, or a print-ready PDF view. */
export function ExportMenu({ type, label = "Export" }: { type: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const go = (href: string, newTab = false) => {
    setOpen(false);
    if (newTab) window.open(href, "_blank");
    else window.location.href = href;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:bg-muted"
      >
        <Download className="h-4 w-4" /> {label} <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-52 overflow-hidden rounded-2xl border border-border bg-card shadow-elegant">
          <button onClick={() => go(`/api/admin/export?type=${type}&format=xlsx`)} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted">
            <FileSpreadsheet className="h-4 w-4 text-forest" /> Excel (.xlsx)
          </button>
          <button onClick={() => go(`/api/admin/export?type=${type}&format=csv`)} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted">
            <Table className="h-4 w-4 text-forest" /> CSV
          </button>
          <button onClick={() => go(`/admin/reports/${type}`, true)} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted">
            <FileText className="h-4 w-4 text-forest" /> PDF / Print
          </button>
        </div>
      )}
    </div>
  );
}
