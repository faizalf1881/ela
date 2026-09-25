"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Search,
  Bot,
  UserRound,
  Send,
  Loader2,
  ArrowLeft,
  Hand,
  Sparkles,
  AlertTriangle,
  Clock,
  Check,
  CheckCheck,
  Package,
  PanelRightOpen,
  PanelRightClose,
  Crown,
  LifeBuoy,
  X,
  CircleAlert,
} from "lucide-react";
import { inr } from "@/lib/utils";
import { STATUS_BADGE, STATUS_LABEL, type OrderStatus } from "@/lib/order-status";

type Mode = "AI" | "HUMAN";
type State = "AI_HANDLING" | "HUMAN_HANDLING" | "WAITING_CUSTOMER" | "REQUIRES_ATTENTION";

type Conversation = {
  id: string;
  phone: string;
  customerId: string | null;
  customer: { id: string; name: string | null } | null;
  profileName: string | null;
  mode: Mode;
  state: State;
  attentionReason: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastPreview: string | null;
  handledByLabel: string | null;
};
type Message = {
  id: string;
  direction: "in" | "out";
  sender: "CUSTOMER" | "AI" | "STAFF" | "SYSTEM";
  staffLabel: string | null;
  type: string;
  body: string;
  status: string | null;
  error: string | null;
  createdAt: string;
};
type HandlingEvent = { id: string; fromMode: Mode | null; toMode: Mode; fromState: State | null; toState: State; actorType: string; actorLabel: string | null; reason: string | null; createdAt: string };
type OrderUpdate = { id: string; orderId: string; toStatus: OrderStatus; body: string; createdAt: string; deliveryStatus: string | null };
type Context = {
  customer: { id: string; name: string | null; phone: string; address: string | null; notes: string | null; since: string } | null;
  orders: { id: string; ref: string; invoiceNo: string | null; placedAt: string; status: OrderStatus; statusLabel: string; items: string; total: number; payment: string; delivery: string | null; area: string | null }[];
  subscription: { plan: string; kind: string; status: string; price: number; interval: string; renewsAt: string | null; meals: string | null; days: string | null; area: string | null; slot: string | null } | null;
  tickets: { id: string; subject: string; category: string; status: string; updatedAt: string }[];
};
type Detail = { conversation: Conversation; messages: Message[]; events: HandlingEvent[]; updates: OrderUpdate[]; context: Context; replyWindow: { open: boolean; endsAt: string | null } };

export const STATE_META: Record<State, { label: string; dot: string; pill: string }> = {
  REQUIRES_ATTENTION: { label: "Requires attention", dot: "bg-destructive", pill: "bg-destructive/10 text-destructive" },
  HUMAN_HANDLING: { label: "Human handling", dot: "bg-[oklch(0.7_0.15_75)]", pill: "bg-gold/20 text-[oklch(0.45_0.12_75)]" },
  WAITING_CUSTOMER: { label: "Waiting for customer", dot: "bg-blue-500", pill: "bg-blue-500/10 text-blue-700" },
  AI_HANDLING: { label: "AI handling", dot: "bg-violet-500", pill: "bg-violet-500/10 text-violet-700" },
};

const FILTERS: { key: string; label: string; count?: (c: Record<string, number>) => number | undefined }[] = [
  { key: "", label: "All" },
  { key: "attention", label: "Attention", count: (c) => c.REQUIRES_ATTENTION },
  { key: "human", label: "Human", count: (c) => c.HUMAN_HANDLING },
  { key: "waiting", label: "Waiting", count: (c) => c.WAITING_CUSTOMER },
  { key: "ai", label: "AI", count: (c) => c.AI_HANDLING },
  { key: "unread", label: "Unread", count: (c) => c.unread },
];

const displayName = (c: Pick<Conversation, "customer" | "profileName" | "phone">) => c.customer?.name || c.profileName || `+${c.phone}`;
const initials = (name: string) =>
  name.startsWith("+")
    ? "#"
    : name
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join("");
const ist = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...o });
function shortTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return ist(iso, { hour: "numeric", minute: "2-digit" });
  return ist(iso, { day: "numeric", month: "short" });
}
function eventText(e: HandlingEvent): string {
  const who = e.actorLabel || (e.actorType === "ai" ? "AI" : "System");
  if (e.actorType === "staff" && e.toMode === "HUMAN" && e.fromMode === "AI") return `${who} took over`;
  if (e.toMode === "AI" && e.fromMode === "HUMAN") return `${who} switched back to AI`;
  if (e.actorType === "ai" && e.toMode === "HUMAN") return `AI handed over${e.reason ? `: ${e.reason}` : ""}`;
  if (e.toState === "REQUIRES_ATTENTION") return `Needs attention${e.reason ? `: ${e.reason}` : ""}`;
  if (e.toState === "WAITING_CUSTOMER") return `${who} replied — waiting for customer`;
  if (e.toState === "HUMAN_HANDLING") return e.actorType === "system" ? "Customer replied — staff's turn" : `${who}: human handling`;
  return `${STATE_META[e.toState].label}${e.reason ? ` — ${e.reason}` : ""}`;
}

/** WhatsApp customer chat for staff (spec #39–#42, #44). */
export function WhatsAppInbox() {
  const params = useSearchParams();
  const [list, setList] = useState<Conversation[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(params.get("conversation"));
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showContext, setShowContext] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingPhone, setPendingPhone] = useState<string | null>(params.get("phone")?.replace(/\D/g, "") || null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastCountRef = useRef(0);

  const loadList = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (filter) qs.set("filter", filter);
      if (q.trim()) qs.set("q", q.trim());
      const res = await fetch(`/api/admin/whatsapp/conversations?${qs}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load chats");
      setList(d.conversations);
      setCounts(d.counts || {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load chats");
    } finally {
      setLoadingList(false);
    }
  }, [filter, q]);

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/admin/whatsapp/conversations/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    const d: Detail = await res.json();
    setDetail((prev) => (prev?.conversation.id === id || !prev ? d : prev));
    if (d.conversation.unreadCount > 0) {
      void fetch(`/api/admin/whatsapp/conversations/${id}/read`, { method: "POST" });
    }
  }, []);

  // Live refresh: the list every 5s, the open chat every 3s.
  useEffect(() => {
    const t = setTimeout(loadList, q ? 300 : 0);
    const i = setInterval(loadList, 5000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [loadList, q]);
  useEffect(() => {
    if (!selectedId) return;
    setDetail((d) => (d?.conversation.id === selectedId ? d : null));
    void loadDetail(selectedId);
    const i = setInterval(() => loadDetail(selectedId), 3000);
    return () => clearInterval(i);
  }, [selectedId, loadDetail]);

  // Opened from a CRM profile: jump to that number's conversation.
  useEffect(() => {
    if (!pendingPhone || loadingList) return;
    const hit = list.find((c) => c.phone === pendingPhone || c.phone.endsWith(pendingPhone.slice(-10)));
    if (hit) setSelectedId(hit.id);
    else toast.message("No WhatsApp messages from this customer yet", { description: "Their chat appears here as soon as they message you." });
    setPendingPhone(null);
  }, [pendingPhone, list, loadingList]);

  const timeline = useMemo(() => {
    if (!detail) return [];
    type Item = { at: string; kind: "msg"; m: Message } | { at: string; kind: "event"; e: HandlingEvent } | { at: string; kind: "update"; u: OrderUpdate };
    const items: Item[] = [
      ...detail.messages.map((m) => ({ at: m.createdAt, kind: "msg" as const, m })),
      ...detail.events.map((e) => ({ at: e.createdAt, kind: "event" as const, e })),
      ...detail.updates.map((u) => ({ at: u.createdAt, kind: "update" as const, u })),
    ];
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [detail]);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    if (timeline.length !== lastCountRef.current) {
      lastCountRef.current = timeline.length;
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [timeline.length]);

  async function act(action: "takeover" | "handback" | "state", body?: unknown) {
    if (!detail) return;
    setBusy(action);
    try {
      const res = await fetch(`/api/admin/whatsapp/conversations/${detail.conversation.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not update the chat");
      toast.success(action === "takeover" ? "You're handling this chat — the AI is paused" : action === "handback" ? "Switched back to AI" : "Updated");
      await Promise.all([loadDetail(detail.conversation.id), loadList()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the chat");
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    const body = draft.trim();
    if (!detail || !body) return;
    setBusy("send");
    try {
      const res = await fetch(`/api/admin/whatsapp/conversations/${detail.conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not send");
      setDraft("");
      await Promise.all([loadDetail(detail.conversation.id), loadList()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send");
    } finally {
      setBusy(null);
    }
  }

  const conv = detail?.conversation ?? null;
  const replyWindow = detail?.replyWindow ?? { open: false, endsAt: null };
  const context = detail?.context ?? null;
  const name = conv ? displayName(conv) : "";

  return (
    <div className="-mx-4 sm:mx-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 px-4 sm:px-0">
        <div>
          <h1 className="font-serif text-2xl text-foreground sm:text-3xl">WhatsApp chats</h1>
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">Customer conversations — answered by the AI until someone takes over.</p>
        </div>
        <Link href="/admin/settings#ai" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted">
          <Sparkles className="h-3.5 w-3.5" /> AI settings
        </Link>
      </div>

      <div className="grid h-[calc(100dvh-13rem)] min-h-[520px] overflow-hidden border-y border-border bg-card sm:rounded-2xl sm:border md:grid-cols-[18rem_1fr] xl:grid-cols-[20rem_1fr_auto]">
        {/* ---- conversation list ---- */}
        <aside className={`${selectedId ? "hidden md:flex" : "flex"} min-h-0 flex-col border-r border-border`}>
          <div className="space-y-2 border-b border-border p-3">
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name, number or message…"
                className="w-full rounded-full border border-input bg-background py-2 pl-9 pr-3 text-base focus:outline-none focus:ring-2 focus:ring-gold/60 sm:text-sm"
              />
            </label>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
              {FILTERS.map((f) => {
                const n = f.count?.(counts);
                return (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`shrink-0 rounded-full px-3 py-1 text-xs ${filter === f.key ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/80 hover:bg-secondary"}`}
                  >
                    {f.label}
                    {n ? <span className={`ml-1 ${f.key === "attention" && filter !== f.key ? "font-semibold text-destructive" : ""}`}>{n}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingList && list.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => <div key={i} className="m-3 h-14 animate-pulse rounded-xl bg-muted" />)
            ) : list.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">No conversations here yet.</p>
            ) : (
              list.map((c) => {
                const n = displayName(c);
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`flex w-full items-start gap-3 border-b border-border/60 px-3 py-3 text-left hover:bg-muted/60 ${selectedId === c.id ? "bg-muted" : ""}`}
                  >
                    <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-forest/10 text-sm font-semibold text-forest">
                      {initials(n)}
                      <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-card ${STATE_META[c.state].dot}`} title={STATE_META[c.state].label} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={`truncate text-sm ${c.unreadCount ? "font-semibold text-foreground" : "text-foreground"}`}>{n}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{shortTime(c.lastMessageAt)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">{c.lastPreview || "—"}</span>
                        {c.unreadCount > 0 && (
                          <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#25D366] px-1.5 text-[11px] font-bold text-white">{c.unreadCount}</span>
                        )}
                      </span>
                      <span className="mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {c.mode === "AI" ? <Bot className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}
                        {c.mode === "AI" ? "AI" : c.handledByLabel || "Staff"} · {STATE_META[c.state].label}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ---- thread ---- */}
        <section className={`${selectedId ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-col`}>
          {!selectedId ? (
            <div className="m-auto max-w-sm p-8 text-center text-sm text-muted-foreground">Choose a conversation to read it and reply.</div>
          ) : !conv ? (
            <div className="m-auto p-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <header className="border-b border-border px-3 py-2.5 sm:px-4">
                <div className="flex items-center gap-2">
                  <button onClick={() => setSelectedId(null)} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted md:hidden" aria-label="Back to chats">
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-foreground">{name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_META[conv.state].pill}`}>{STATE_META[conv.state].label}</span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      +{conv.phone}
                      {conv.customer ? " · CRM customer" : " · not a registered customer"}
                      {conv.mode === "HUMAN" && conv.handledByLabel ? ` · handled by ${conv.handledByLabel}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => setShowContext((v) => !v)}
                    className="hidden h-9 w-9 items-center justify-center rounded-full hover:bg-muted xl:inline-flex"
                    title={showContext ? "Hide customer details" : "Show customer details"}
                  >
                    {showContext ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                  </button>
                  {/* Smaller screens: the details open as a sheet. */}
                  <button
                    onClick={() => setSheetOpen(true)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted xl:hidden"
                  >
                    <PanelRightOpen className="h-3.5 w-3.5" /> Details
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {conv.mode === "AI" ? (
                    <button
                      onClick={() => act("takeover")}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                    >
                      {busy === "takeover" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Hand className="h-3.5 w-3.5" />} Take over
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => act("handback")}
                        disabled={busy !== null}
                        className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                      >
                        {busy === "handback" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />} Switch back to AI
                      </button>
                      {conv.state !== "WAITING_CUSTOMER" && (
                        <button onClick={() => act("state", { state: "WAITING_CUSTOMER" })} disabled={busy !== null} className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60">
                          Waiting for customer
                        </button>
                      )}
                      {conv.state !== "REQUIRES_ATTENTION" && (
                        <button onClick={() => act("state", { state: "REQUIRES_ATTENTION" })} disabled={busy !== null} className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60">
                          Flag for attention
                        </button>
                      )}
                    </>
                  )}
                  <span className={`inline-flex items-center gap-1 text-[11px] ${replyWindow.open ? "text-muted-foreground" : "text-destructive"}`}>
                    <Clock className="h-3 w-3" />
                    {replyWindow.open && replyWindow.endsAt
                      ? `Reply window open until ${ist(replyWindow.endsAt, { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" })}`
                      : "24-hour reply window closed"}
                  </span>
                </div>

                {conv.state === "REQUIRES_ATTENTION" && conv.attentionReason && (
                  <div className="mt-2 flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {conv.attentionReason}
                  </div>
                )}
              </header>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#efeae2]/60 px-3 py-4 sm:px-5">
                {timeline.map((item) =>
                  item.kind === "event" ? (
                    <div key={`e${item.e.id}`} className="flex justify-center">
                      <span className="rounded-full bg-card/90 px-3 py-1 text-center text-[11px] text-muted-foreground shadow-soft">
                        {eventText(item.e)} · {ist(item.at, { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                  ) : item.kind === "update" ? (
                    <div key={`u${item.u.id}`} className="flex justify-center">
                      <span className="inline-flex max-w-[90%] items-center gap-1.5 rounded-xl bg-gold/15 px-3 py-1.5 text-[11px] text-foreground" title={item.u.body}>
                        <Package className="h-3.5 w-3.5 shrink-0" /> Automatic update sent: #{item.u.orderId.slice(-6).toUpperCase()} {STATUS_LABEL[item.u.toStatus]} ·{" "}
                        {ist(item.at, { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                  ) : (
                    <Bubble key={item.m.id} m={item.m} />
                  ),
                )}
                <div ref={endRef} />
              </div>

              <footer className="border-t border-border p-3">
                {conv.mode === "AI" ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-violet-500/10 px-3 py-2.5 text-xs text-violet-800">
                    <span className="inline-flex items-center gap-1.5">
                      <Bot className="h-4 w-4" /> The AI is answering this customer.
                    </span>
                    <button onClick={() => act("takeover")} disabled={busy !== null} className="rounded-full bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-60">
                      Take over to reply
                    </button>
                  </div>
                ) : !replyWindow.open ? (
                  <div className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2.5 text-xs text-muted-foreground">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    The customer&apos;s last message was over 24 hours ago, so WhatsApp won&apos;t deliver a normal reply. Ask them to message you, or call +{conv.phone}.
                  </div>
                ) : (
                  <div className="flex items-end gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                      rows={1}
                      placeholder="Type a reply… (Enter to send, Shift+Enter for a new line)"
                      className="max-h-40 min-h-11 flex-1 resize-y rounded-2xl border border-input bg-background px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-gold/60 sm:text-sm"
                    />
                    <button
                      onClick={send}
                      disabled={busy === "send" || !draft.trim()}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white hover:bg-[#1fb957] disabled:opacity-50"
                      aria-label="Send"
                    >
                      {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                  </div>
                )}
              </footer>
            </>
          )}
        </section>

        {/* ---- customer context (spec #44) ---- */}
        {conv && context && showContext && (
          <aside className="hidden w-80 min-h-0 overflow-y-auto border-l border-border p-4 xl:block">
            <ContextPanel ctx={context} conv={conv} />
          </aside>
        )}
      </div>

      {conv && context && sheetOpen && <ContextSheet ctx={context} conv={conv} onClose={() => setSheetOpen(false)} />}
    </div>
  );
}

function Bubble({ m }: { m: Message }) {
  const mine = m.direction === "out";
  const ai = m.sender === "AI";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-soft sm:max-w-[70%] ${
          !mine ? "rounded-tl-sm bg-card text-foreground" : ai ? "rounded-tr-sm bg-violet-100 text-[#1f1a33]" : "rounded-tr-sm bg-[#d9fdd3] text-[#111b21]"
        }`}
      >
        {mine && (
          <div className={`mb-0.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${ai ? "text-violet-700" : "text-[#128C7E]"}`}>
            {ai ? <Bot className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}
            {ai ? "AI" : m.staffLabel || "Staff"}
          </div>
        )}
        {!mine && <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Customer</div>}
        <div className="whitespace-pre-wrap break-words">{m.body}</div>
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
          {ist(m.createdAt, { hour: "numeric", minute: "2-digit" })}
          {mine &&
            (m.status === "failed" ? (
              <span className="inline-flex items-center gap-0.5 text-destructive" title={m.error || undefined}>
                <X className="h-3 w-3" /> not sent
              </span>
            ) : m.status === "read" ? (
              <CheckCheck className="h-3.5 w-3.5 text-blue-500" />
            ) : m.status === "delivered" ? (
              <CheckCheck className="h-3.5 w-3.5" />
            ) : m.status === "sent" ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Clock className="h-3 w-3" />
            ))}
        </div>
        {mine && m.status === "failed" && m.error && <div className="mt-1 text-[11px] text-destructive">{m.error}</div>}
      </div>
    </div>
  );
}

function ContextPanel({ ctx, conv }: { ctx: Context; conv: Conversation }) {
  return (
    <div className="space-y-5 text-sm">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Customer</div>
        {ctx.customer ? (
          <div className="mt-1.5 space-y-1">
            <div className="font-medium text-foreground">{ctx.customer.name || conv.profileName || "—"}</div>
            <div className="text-xs text-muted-foreground">+{ctx.customer.phone}</div>
            <div className="text-xs text-muted-foreground">Customer since {ist(ctx.customer.since, { day: "numeric", month: "short", year: "numeric" })}</div>
            {ctx.customer.address && <div className="text-xs text-muted-foreground">{ctx.customer.address}</div>}
            {ctx.customer.notes && <div className="mt-2 rounded-lg bg-gold/10 px-2.5 py-2 text-xs text-foreground">Staff note: {ctx.customer.notes}</div>}
            <Link href="/admin/crm" className="inline-block pt-1 text-xs font-medium text-forest hover:underline">
              Open in Customers →
            </Link>
          </div>
        ) : (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Not a registered customer{conv.profileName ? ` (WhatsApp name: ${conv.profileName})` : ""}. No orders are linked to this number.
          </p>
        )}
      </div>

      {ctx.subscription && (
        <div>
          <div className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Crown className="h-3 w-3" /> Membership
          </div>
          <div className="mt-1.5 rounded-xl border border-border p-2.5 text-xs">
            <div className="font-medium text-foreground">
              {ctx.subscription.plan} · {ctx.subscription.status.toLowerCase()}
            </div>
            <div className="text-muted-foreground">
              {inr(ctx.subscription.price)} / {ctx.subscription.interval.toLowerCase().replace("ly", "")}
              {ctx.subscription.renewsAt ? ` · renews ${ist(ctx.subscription.renewsAt, { day: "numeric", month: "short" })}` : ""}
            </div>
            {ctx.subscription.meals && (
              <div className="mt-1 text-muted-foreground">
                {ctx.subscription.meals} · {ctx.subscription.days}
                {ctx.subscription.slot ? ` · ${ctx.subscription.slot}` : ""}
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Recent orders</div>
        {ctx.orders.length === 0 ? (
          <p className="mt-1.5 text-xs text-muted-foreground">No orders.</p>
        ) : (
          <div className="mt-1.5 space-y-2">
            {ctx.orders.map((o) => (
              <div key={o.id} className="rounded-xl border border-border p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{o.ref}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[o.status]}`}>{o.statusLabel}</span>
                </div>
                <div className="mt-1 text-muted-foreground">{o.items}</div>
                <div className="mt-1 text-muted-foreground">
                  {inr(o.total)} · {o.payment}
                </div>
                {o.delivery && <div className="text-muted-foreground">Delivery {o.delivery}</div>}
                {o.area && <div className="text-muted-foreground">{o.area}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {ctx.tickets.length > 0 && (
        <div>
          <div className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            <LifeBuoy className="h-3 w-3" /> Support tickets
          </div>
          <div className="mt-1.5 space-y-1.5">
            {ctx.tickets.map((t) => (
              <Link key={t.id} href="/admin/complaints" className="block rounded-xl border border-border p-2.5 text-xs hover:bg-muted">
                <div className="font-medium text-foreground">{t.subject}</div>
                <div className="text-muted-foreground">
                  {t.category} · {t.status.toLowerCase()}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ContextSheet({ ctx, conv, onClose }: { ctx: Context; conv: Conversation; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 xl:hidden" onClick={onClose}>
      <div role="dialog" aria-label="Customer details" className="h-full w-full max-w-sm overflow-y-auto bg-card p-4 shadow-elegant" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-medium text-foreground">{displayName(conv)}</span>
          <button onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ContextPanel ctx={ctx} conv={conv} />
      </div>
    </div>
  );
}
