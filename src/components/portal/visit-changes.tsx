// Owner reschedule/cancel, trade arrival/owner-not-home/cancel, and office visit history with "clear no-show".
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAction } from "@/hooks/use-me";
import {
  clearNoShowFn, getReadyCheckVisitByToken, getVisitChangeState, listVisitEvents, ownerChangeReadyCheckByToken, ownerChangeVisitFn, tradeVisitAction,
} from "@/lib/visit-events.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "./panels";

const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const LATE = "This visit is less than 24 hours away. Changing it now counts as a missed visit: you get one free rebooking, after that our office will call you.";

function OwnerButtons({ canChange, busy, onAct }: { canChange: boolean; busy: boolean; onAct: (a: "reschedule" | "cancel") => void }) {
  const [confirm, setConfirm] = useState<null | "reschedule" | "cancel">(null);
  if (confirm) return (
    <div className="mt-3 space-y-2">
      {!canChange && <p className="text-sm text-destructive">{LATE}</p>}
      <p className="text-sm">{confirm === "reschedule" ? "Your booking will be released and you'll be asked to choose new times." : "Your booking will be cancelled and our office will contact you."}</p>
      <div className="flex flex-wrap gap-2">
        <Button className="h-12" variant={confirm === "cancel" ? "destructive" : "default"} disabled={busy} onClick={() => { onAct(confirm); setConfirm(null); }}>{confirm === "reschedule" ? "Yes, choose new times" : "Yes, cancel"}</Button>
        <Button className="h-12" variant="outline" disabled={busy} onClick={() => setConfirm(null)}>Keep my booking</Button>
      </div>
    </div>
  );
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button className="h-12" variant="outline" onClick={() => setConfirm("reschedule")}>Change time</Button>
      <Button className="h-12" variant="ghost" onClick={() => setConfirm("cancel")}>Cancel visit</Button>
    </div>
  );
}

/** Signed-in owner: their booked visit, with change/cancel (24h rule shown). */
export function OwnerVisitChangeCard({ jobId }: { jobId: string }) {
  const get = useServerFn(getVisitChangeState);
  const act = useAction(ownerChangeVisitFn);
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({ queryKey: ["visit-change", jobId], queryFn: () => get({ data: { jobId } }) });
  if (!data || data.started) return null;
  return (
    <Section title={`Your booked ${data.label}`}>
      <p className="text-sm">{when(data.starts_at)}</p>
      <p className="text-xs text-muted-foreground">You can change or cancel up to 24 hours before.</p>
      <OwnerButtons canChange={data.ownerCanChange} busy={busy} onAct={async (a) => { setBusy(true); await act({ jobId, kind: data.kind, action: a }, a === "reschedule" ? "Booking released — please choose new times" : "Visit cancelled"); setBusy(false); }} />
    </Section>
  );
}

/** Owner on the no-login estimate link: their booked Ready Check. */
export function ReadyCheckVisitChange({ token }: { token: string }) {
  const get = useServerFn(getReadyCheckVisitByToken);
  const act = useAction(ownerChangeReadyCheckByToken);
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({ queryKey: ["rc-visit-change", token], queryFn: () => get({ data: { token } }) });
  if (!data || data.started) return null;
  return (
    <div className="rounded-lg border p-4">
      <p className="font-medium">Your Ready Check is booked for {when(data.starts_at)}</p>
      <p className="text-xs text-muted-foreground">You can change or cancel up to 24 hours before.</p>
      <OwnerButtons canChange={data.ownerCanChange} busy={busy} onAct={async (a) => { setBusy(true); await act({ token, action: a }, a === "reschedule" ? "Booking released — please choose new times" : "Ready Check cancelled"); setBusy(false); }} />
    </div>
  );
}

/** Booked trade: large onsite buttons. */
export function TradeVisitCard({ jobId }: { jobId: string }) {
  const get = useServerFn(getVisitChangeState);
  const act = useAction(tradeVisitAction);
  const [mode, setMode] = useState<null | "cancel" | "owner_not_home">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({ queryKey: ["visit-change", jobId], queryFn: () => get({ data: { jobId } }) });
  if (!data) return null;
  const run = async (action: "arrived" | "owner_not_home" | "cancel", msg: string) => { setBusy(true); await act({ jobId, action, ...(reason.trim() ? { reason: reason.trim() } : {}) }, msg); setBusy(false); setMode(null); setReason(""); };
  return (
    <Section title={`Booked ${data.label}: ${when(data.starts_at)}`}>
      {data.arrived ? <p className="text-sm">Arrival recorded.</p> : data.canArrive
        ? <Button className="h-12 w-full" disabled={busy} onClick={() => run("arrived", "Arrival recorded")}>I've arrived</Button>
        : <p className="text-sm text-muted-foreground">Tap "I've arrived" when you get there (from 2 hours before). If there's no arrival or evidence 4 hours after the start, it's recorded as a no-show.</p>}
      {mode ? (
        <div className="mt-3 space-y-2">
          <Input className="h-12" placeholder={mode === "cancel" ? "Reason for cancelling (required)" : "Note"} value={reason} onChange={(e) => setReason(e.target.value)} />
          {mode === "cancel" && <p className="text-xs text-muted-foreground">Cancelling a booked visit counts against your reliability. The owner will be asked for new times.</p>}
          <div className="flex gap-2">
            <Button className="h-12" variant="destructive" disabled={busy || (mode === "cancel" && reason.trim().length < 5)} onClick={() => run(mode, mode === "cancel" ? "Visit cancelled" : "Recorded: owner not home")}>{mode === "cancel" ? "Cancel visit" : "Owner not home"}</Button>
            <Button className="h-12" variant="outline" onClick={() => setMode(null)}>Back</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {data.canMarkNotHome && <Button className="h-12" variant="outline" onClick={() => setMode("owner_not_home")}>Owner not home</Button>}
          {!data.started && <Button className="h-12" variant="ghost" onClick={() => setMode("cancel")}>I can't make it</Button>}
        </div>
      )}
    </Section>
  );
}

const EVENT_LABEL: Record<string, string> = {
  owner_cancelled: "Owner cancelled", owner_rescheduled: "Owner rescheduled", owner_late_change: "Owner changed within 24h (missed)", owner_no_show: "Owner not home",
  trade_cancelled: "Trade cancelled", trade_no_show: "Trade no-show", trade_arrived: "Trade arrived", evidence_rejected: "Evidence rejected", no_show_cleared: "No-show cleared",
};

/** Office: permanent visit history; clear a wrong no-show with a reason. */
export function AdminVisitHistory({ jobId }: { jobId: string }) {
  const get = useServerFn(listVisitEvents);
  const clear = useAction(clearNoShowFn);
  const [reason, setReason] = useState<Record<string, string>>({});
  const { data } = useQuery({ queryKey: ["visit-events", jobId], queryFn: () => get({ data: { jobId } }) });
  if (!data?.length) return null;
  const cleared = new Set(data.filter((r) => r.clears_event_id).map((r) => r.clears_event_id));
  return (
    <Section title="Visit changes and no-shows">
      <ul className="space-y-2 text-sm">
        {data.map((r) => (
          <li key={r.id} className="rounded border p-2">
            <div className="flex flex-wrap justify-between gap-2">
              <span>{EVENT_LABEL[r.event] ?? r.event}{r.businesses ? ` — ${(r.businesses as { name: string }).name}` : ""}{cleared.has(r.id) ? " (cleared)" : ""}</span>
              <span className="text-muted-foreground">{when(r.created_at)}</span>
            </div>
            {r.reason && <p className="text-muted-foreground">{r.reason}</p>}
            {["trade_no_show", "owner_no_show", "owner_late_change"].includes(r.event) && !cleared.has(r.id) && (
              <div className="mt-2 flex gap-2">
                <Input placeholder="Reason to clear (required)" value={reason[r.id] ?? ""} onChange={(e) => setReason({ ...reason, [r.id]: e.target.value })} />
                <Button variant="outline" disabled={(reason[r.id] ?? "").trim().length < 5} onClick={() => clear({ eventId: r.id, reason: reason[r.id]!.trim() }, "No-show cleared")}>Clear</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
