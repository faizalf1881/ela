"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { UserPlus, Trash2, Loader2, User } from "lucide-react";

type Staff = { id: string; username: string; name: string | null; active: boolean; createdAt: string };

export function StaffManager() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", username: "", password: "" });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/staff", { cache: "no-store" });
      if (res.ok) setStaff((await res.json()).staff);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create");
      toast.success(`Kitchen account "${data.staff.username}" created`);
      setForm({ name: "", username: "", password: "" });
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setCreating(false);
    }
  }

  async function remove(s: Staff) {
    if (!confirm(`Remove kitchen account "${s.username}"?`)) return;
    setStaff((prev) => prev.filter((x) => x.id !== s.id));
    const res = await fetch(`/api/staff/${s.id}`, { method: "DELETE" });
    if (res.ok) toast.success("Removed");
    else {
      toast.error("Could not remove");
      load();
    }
  }

  return (
    <div>
      <h1 className="font-serif text-3xl text-foreground">Kitchen Staff</h1>
      <p className="mt-1 text-sm text-muted-foreground">Create login accounts for kitchen staff. They can update order statuses.</p>

      <div className="mt-6 grid gap-8 lg:grid-cols-5">
        <form onSubmit={create} className="lg:col-span-2 rounded-3xl border border-border bg-card p-6 shadow-soft h-fit">
          <h2 className="font-serif text-xl text-foreground">Add kitchen staff</h2>
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="text-xs text-muted-foreground">Name (optional)</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Username</span>
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoCapitalize="none" required className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Password (min 6 chars)</span>
              <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
            </label>
          </div>
          <button type="submit" disabled={creating} className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Create account
          </button>
          <p className="mt-3 text-xs text-muted-foreground">Share these credentials with the staff member. They log in at <span className="text-forest">/staff/login</span>.</p>
        </form>

        <div className="lg:col-span-3 space-y-3">
          {loading ? (
            <div className="text-muted-foreground">Loading…</div>
          ) : staff.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-muted-foreground">No kitchen staff yet.</div>
          ) : (
            staff.map((s) => (
              <div key={s.id} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-forest/10 text-forest">
                  <User className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="font-medium text-foreground">{s.name || s.username}</div>
                  <div className="text-xs text-muted-foreground">@{s.username} · added {new Date(s.createdAt).toLocaleDateString("en-IN")}</div>
                </div>
                <button onClick={() => remove(s)} className="h-9 w-9 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Remove">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
