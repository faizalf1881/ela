"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Eye, EyeOff, X, Save, Loader2, Clock, CalendarOff, RotateCcw } from "lucide-react";

type Block = { id: string; date: string; locationId: string | null; reason: string | null };
type Slot = {
  id: string;
  label: string;
  startMinutes: number;
  endMinutes: number;
  active: boolean;
  sortOrder: number;
  blocks: Block[];
};
type Settings = { orderCutoffMinutes: number; deliveryDays: number[]; maxPreorderDays: number };

const DAYS = [
  { n: 0, label: "Sun" },
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
];

const toHHMM = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const fromHHMM = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const pretty = (mins: number) => {
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
};

type Draft = { id?: string; label: string; start: string; end: string; active: boolean; sortOrder: string };

export function DeliverySchedule() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [blockFor, setBlockFor] = useState<Slot | null>(null);
  const [blockDate, setBlockDate] = useState("");

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        fetch("/api/slots?all=1", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/settings", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setSlots(a.slots || []);
      setSettings({
        orderCutoffMinutes: b.orderCutoffMinutes ?? 480,
        deliveryDays: b.deliveryDays ?? [1, 2, 3, 4, 5, 6],
        maxPreorderDays: b.maxPreorderDays ?? 7,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patchSettings(body: Partial<Settings>, ok: string) {
    setSettings((s) => (s ? { ...s, ...body } : s));
    const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) toast.success(ok);
    else {
      toast.error("Could not save");
      load();
    }
  }

  async function saveSlot() {
    if (!draft) return;
    if (!draft.label.trim()) return toast.error("Give the slot a label");
    const startMinutes = fromHHMM(draft.start);
    const endMinutes = fromHHMM(draft.end);
    if (endMinutes <= startMinutes) return toast.error("End time must be after the start time");
    setSaving(true);
    try {
      const payload = { label: draft.label.trim(), startMinutes, endMinutes, active: draft.active, sortOrder: Number(draft.sortOrder) || 0 };
      const res = draft.id
        ? await fetch(`/api/slots/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/slots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      toast.success(draft.id ? "Slot updated" : "Slot added");
      setDraft(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleSlot(s: Slot) {
    setSlots((prev) => prev.map((x) => (x.id === s.id ? { ...x, active: !x.active } : x)));
    await fetch(`/api/slots/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !s.active }) }).catch(() => load());
  }

  async function delSlot(s: Slot) {
    if (!confirm(`Delete the "${s.label}" slot?`)) return;
    const res = await fetch(`/api/slots/${s.id}`, { method: "DELETE" });
    const data = await res.json();
    if (res.ok) toast.success(data.message || "Slot deleted");
    else toast.error(data.error || "Could not delete");
    load();
  }

  async function block(slot: Slot, date: string) {
    if (!date) return toast.error("Pick a date to close");
    const res = await fetch(`/api/slots/${slot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ block: { date } }),
    });
    if (res.ok) {
      toast.success(`"${slot.label}" closed on ${date}`);
      setBlockFor(null);
      setBlockDate("");
      load();
    } else toast.error("Could not close that slot");
  }

  async function unblock(slot: Slot, date: string) {
    const res = await fetch(`/api/slots/${slot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unblock: { date } }),
    });
    if (res.ok) {
      toast.success("Slot reopened");
      load();
    } else toast.error("Could not reopen");
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Delivery schedule</h1>
          <p className="text-sm text-muted-foreground">Order cut-off, service days and the time windows customers can choose at checkout.</p>
        </div>
        <button
          onClick={() => setDraft({ label: "", start: "12:30", end: "13:00", active: true, sortOrder: String(slots.length + 1) })}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Add time slot
        </button>
      </div>

      {/* Cut-off + service days */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Daily order cut-off</div>
          <input
            type="time"
            value={settings ? toHHMM(settings.orderCutoffMinutes) : "08:00"}
            onChange={(e) => patchSettings({ orderCutoffMinutes: fromHHMM(e.target.value) }, `Cut-off set to ${e.target.value}`)}
            className="mt-2 rounded-xl border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Orders before this time can still be delivered the same day. After it, the next available day is offered. (India time.)
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Delivery days</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DAYS.map((d) => {
              const on = settings?.deliveryDays.includes(d.n) ?? false;
              return (
                <button
                  key={d.n}
                  onClick={() => {
                    if (!settings) return;
                    const next = on ? settings.deliveryDays.filter((x) => x !== d.n) : [...settings.deliveryDays, d.n].sort();
                    patchSettings({ deliveryDays: next }, `${d.label} ${on ? "closed" : "open"}`);
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs transition-colors ${on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Days you deliver. Unselected days never appear at checkout.</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Book ahead (days)</div>
          <input
            type="number"
            min={1}
            max={60}
            value={settings?.maxPreorderDays ?? 7}
            onChange={(e) => setSettings((s) => (s ? { ...s, maxPreorderDays: Number(e.target.value) } : s))}
            onBlur={(e) => patchSettings({ maxPreorderDays: Number(e.target.value) || 7 }, "Booking window updated")}
            className="mt-2 w-24 rounded-xl border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="mt-2 text-xs text-muted-foreground">How far into the future customers may schedule an order.</p>
        </div>
      </div>

      {/* Slots */}
      <h2 className="mt-8 font-serif text-2xl text-foreground">Time slots</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : slots.length === 0 ? (
          <div className="text-muted-foreground">No time slots yet. Until you add one, checkout works without scheduling.</div>
        ) : (
          slots.map((s) => (
            <div key={s.id} className={`rounded-2xl border bg-card p-4 ${s.active ? "border-border" : "border-dashed border-border opacity-70"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-forest shrink-0" />
                    <span className="font-serif text-lg text-foreground">{s.label}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {pretty(s.startMinutes)} – {pretty(s.endMinutes)}
                  </div>
                </div>
              </div>

              {s.blocks.length > 0 && (
                <div className="mt-3 space-y-1">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Closed on</div>
                  {s.blocks.map((b) => (
                    <div key={b.id} className="flex items-center justify-between rounded-lg bg-muted px-2 py-1 text-[11px]">
                      <span>{String(b.date).slice(0, 10)}</span>
                      <button onClick={() => unblock(s, String(b.date).slice(0, 10))} className="inline-flex items-center gap-1 text-forest hover:underline">
                        <RotateCcw className="h-3 w-3" /> reopen
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button onClick={() => toggleSlot(s)} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted">
                  {s.active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {s.active ? "Active" : "Hidden"}
                </button>
                <button
                  onClick={() => setDraft({ id: s.id, label: s.label, start: toHHMM(s.startMinutes), end: toHHMM(s.endMinutes), active: s.active, sortOrder: String(s.sortOrder) })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button onClick={() => { setBlockFor(s); setBlockDate(""); }} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted" title="Close this slot on a specific date">
                  <CalendarOff className="h-3.5 w-3.5" /> Close a day
                </button>
                <button onClick={() => delSlot(s)} className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Block-a-date dialog */}
      {blockFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setBlockFor(null)}>
          <div className="w-full max-w-sm rounded-3xl bg-card ring-1 ring-border shadow-elegant p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-xl text-foreground">Close “{blockFor.label}”</h2>
              <button onClick={() => setBlockFor(null)} className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Customers won&apos;t be offered this time on the chosen date. Other slots stay open.</p>
            <input type="date" value={blockDate} onChange={(e) => setBlockDate(e.target.value)} className="mt-4 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm" />
            <div className="mt-5 flex gap-3">
              <button onClick={() => block(blockFor, blockDate)} className="flex-1 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">Close this day</button>
              <button onClick={() => setBlockFor(null)} className="rounded-full border border-border px-5 py-3 text-sm hover:bg-muted">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Add / edit slot */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => !saving && setDraft(null)}>
          <div className="w-full max-w-md rounded-3xl bg-card ring-1 ring-border shadow-elegant p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-2xl text-foreground">{draft.id ? "Edit time slot" : "New time slot"}</h2>
              <button onClick={() => setDraft(null)} className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-xs text-muted-foreground">Label shown to customers</span>
                <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="12:30 PM - 1:00 PM" className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm" />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-xs text-muted-foreground">Start</span>
                  <input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">End</span>
                  <input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">Order</span>
                  <input type="number" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm" />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="h-4 w-4" />
                Active (offered at checkout)
              </label>
            </div>
            <div className="mt-6 flex gap-3">
              <button onClick={saveSlot} disabled={saving} className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
              </button>
              <button onClick={() => setDraft(null)} className="rounded-full border border-border px-6 py-3 text-sm hover:bg-muted">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
