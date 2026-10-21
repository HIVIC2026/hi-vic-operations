import { useAccess } from "@/hooks/use-me";
// Phone-first trade workspace pieces: job offers and the bottom tab bar.
import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { Briefcase, Building2, PlusCircle, Wallet } from "lucide-react";
import { useAction } from "@/hooks/use-me";
import { respondToOffer } from "@/lib/pilot.functions";
import { electricianRateText } from "@/lib/allocation.core";
import { formatPiesaWindow } from "@/lib/piesa-windows.core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type OfferRow = { id: string; kind?: string; summary: unknown; expires_at: string | null; windows?: { id: string; starts_at: string; ends_at: string | null }[] };
type Summary = { job_number: string; suburb: string | null; postcode: string | null; area_m2: number | null; approx_area_m2?: number | null; access_summary?: string | null; electrician_rate_inc_gst?: number | null; rate_to_confirm?: boolean };

export function timeLeft(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Closing now";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))} min left`;
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} left`;
  return `${Math.floor(h / 24)} days left`;
}

/** One offer card: what it is, where, rough size, owner's times as big buttons. Owner details only after accepting. */
export function OfferCard({ o, onDone }: { o: OfferRow; onDone: () => void }) {
  const respond = useAction(respondToOffer);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const s = o.summary as Summary;
  const area = s.approx_area_m2 ?? s.area_m2;
  const what = o.kind === "ready_check" ? "Free Ready Check — win the install"
    : o.kind === "piesa" ? `Pre Insulation Electrical Safety Assessment (PIESA) — ${electricianRateText(s).replace(/^Your agreed rate:\s*/i, "your rate ")}`
    : o.kind === "rectification" ? "Electrical fixes work" : "Installation job";
  const accept = async (proposalId?: string) => { await respond({ offerId: o.id, accept: true, reason: null, ...(proposalId ? { proposalId } : {}) }, proposalId ? "Booked — it's in Coming up" : "Accepted — call the owner to agree a time"); onDone(); };
  return (
    <div className="rounded-[22px] border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="font-display text-lg font-extrabold">{s.suburb ?? "Victoria"} {s.postcode}</div>
        {o.expires_at && <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold">{timeLeft(o.expires_at)}</span>}
      </div>
      <div className="text-sm font-semibold text-primary">{what}</div>
      <div className="text-sm text-muted-foreground">{area ? `About ${area} m² of ceiling` : "Ceiling size not known yet"}</div>
      {declining ? (
        <div className="mt-3 space-y-2">
          <Input className="h-12" placeholder="Why not? (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="field" variant="outline" className="w-full" onClick={async () => { await respond({ offerId: o.id, accept: false, reason: reason || null }, "Passed on"); onDone(); }}>Confirm — not for me</Button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {!!o.windows?.length && <div className="text-xs font-semibold text-muted-foreground">Owner's times — tap one to book it</div>}
          {o.windows?.map((w) => <Button key={w.id} size="field" className="h-auto min-h-12 w-full whitespace-normal" onClick={() => accept(w.id)}>{formatPiesaWindow(w.starts_at, w.ends_at)}</Button>)}
          <Button size="field" variant="outline" className="h-auto min-h-12 w-full whitespace-normal" onClick={() => accept()}>{o.windows?.length ? "None suit, I'll call them" : "Accept — I'll call them"}</Button>
          <Button size="field" variant="ghost" className="w-full" onClick={() => setDeclining(true)}>Not for me</Button>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">The owner's name, address and phone show once you accept.</p>
    </div>
  );
}

export function TradeTabs({ installer }: { installer: boolean }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data: access } = useAccess();
  const boss = !!access?.businessAdmin || !!access?.admin;
  const tab = (to: string, label: string, Icon: typeof Briefcase, on: boolean) => (
    <Link to={to as never} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-semibold ${on ? "text-primary" : "text-muted-foreground"}`}><Icon className="h-5 w-5" />{label}</Link>
  );
  return (
    <nav aria-label="Trade menu" className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(34,55,107,0.08)] md:hidden">
      {tab("/field", "My work", Briefcase, path === "/field" || path.startsWith("/field/"))}
      {installer && boss && access?.installerBusinessAdmin !== false && tab("/partner/import", "Add a job", PlusCircle, path.startsWith("/partner/import"))}
      {boss && tab("/field/money", "Money", Wallet, path.startsWith("/field/money"))}
      {boss && tab("/field/business", "My business", Building2, path.startsWith("/partner/profile") || path.startsWith("/partner/workers"))}
    </nav>
  );
}
