import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAction } from "@/hooks/use-me";
import { getPrestartSummary, rerunPrestart } from "@/lib/allocation.functions";
import { recordEscSubmissionFn, regenerateEscNotificationFn, withdrawEscNotificationFn } from "@/lib/portal.functions";
import { VEU_REGISTRY_URL } from "@/lib/esc.core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "./panels";

const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Office only: VEU Registry install notification (prepare → copy → record / withdraw), the AP task and the day-before pre-start result.
 *  Jo 24 Oct 2026 (decisions 118/121): the notification is submitted BY HAND in the Registry; the portal prepares, reminds and records. */
export function OfficePrestartCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getPrestartSummary);
  const rerun = useAction(rerunPrestart);
  const regen = useAction(regenerateEscNotificationFn);
  const record = useAction(recordEscSubmissionFn);
  const withdraw = useAction(withdrawEscNotificationFn);
  const q = useQuery({ queryKey: ["prestart", jobId], queryFn: () => load({ data: { jobId } }) });
  const [ref, setRef] = useState(""); const [at, setAt] = useState(""); const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState(""); const [withdrawing, setWithdrawing] = useState(false);
  const d = q.data;
  if (!d) return null;
  const n = d.notification;
  const reg = d.registry;
  const dateMoved = d.task?.code === "esc_update_registry" || d.task?.code === "esc_withdraw_resubmit";
  return (
    <Section title="ESC install notification and pre-start check (office only)" action={<Button size="sm" variant="outline" onClick={() => regen({ jobId }, "Notification details refreshed")}>Refresh details</Button>}>
      <div className="space-y-2 text-sm">
        <div>Install: <b>{when(d.start)}</b> · pre-start check from {when(d.runAt)}</div>
        {n && <div className="text-xs text-muted-foreground">Registry window: {n.earliest ? when(n.earliest) : "—"} to {when(n.due_by)} (no earlier than 5 days, no later than 24 hours before the start; written owner consent first).</div>}
        {d.sentLine ? <p className="rounded border border-success/40 bg-success-soft p-2 font-medium">{d.sentLine}{n?.method ? ` · ${n.method.replace("_", " ")}` : ""}</p> : null}
        {d.task ? <p className={`rounded border p-2 font-medium ${d.task.code === "esc_submit_due" ? "border-warning/40 bg-warning-soft" : "border-danger/40 bg-danger-soft text-danger"}`}>{d.task.detail}</p> : !d.sentLine && <p className="text-muted-foreground">No ESC action needed right now{n?.earliest ? ` — the Registry window opens ${when(n.earliest)}` : ""}.</p>}
        {dateMoved && d.previousSent && (
          <div className="rounded border border-danger/40 p-2">
            <p className="text-xs">Earlier notification for {when(d.previousSent.scheduled_start)}: {d.previousSent.sentLine}. {d.task?.code === "esc_update_registry" ? "Update it in the Registry and record the update below, or withdraw it and resubmit." : "Withdraw it in the Registry, then submit and record a new one below."}</p>
            {!withdrawing ? <Button size="sm" variant="outline" className="mt-1" onClick={() => setWithdrawing(true)}>Withdraw / resubmit</Button> : (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Input className="max-w-sm" placeholder="Why it was withdrawn (e.g. install moved outside the 5-day window)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button size="sm" variant="destructive" disabled={reason.trim().length < 3} onClick={async () => { await withdraw({ notificationId: d.previousSent!.id, reason, withdrawnAt: new Date().toISOString() }, "Withdrawal recorded — submit a new notification"); setReason(""); setWithdrawing(false); await q.refetch(); }}>Record withdrawal (kept as history)</Button>
                <Button size="sm" variant="ghost" onClick={() => setWithdrawing(false)}>Cancel</Button>
              </div>
            )}
          </div>
        )}
        {reg && n ? (
          <div className="rounded border p-2">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">Copy to Registry <span className="text-xs font-normal text-muted-foreground">(v{n.version} · {d.fieldsSource})</span></span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(reg.text)}>Copy to Registry</Button>
                <a className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted" href={VEU_REGISTRY_URL} target="_blank" rel="noreferrer">Open VEU Registry</a>
              </div>
            </div>
            <dl className="grid grid-cols-[13rem_1fr] gap-x-2 text-xs">{reg.rows.flatMap((r) => [<dt key={`${r.key}-k`} className="text-muted-foreground">{r.label}</dt>, <dd key={`${r.key}-v`} className={r.value ? "" : "text-danger"}>{r.value ?? (r.optional ? "— not recorded" : "— missing")}</dd>])}</dl>
            {reg.missing.length > 0 && <p className="mt-1 text-xs text-danger">Missing before it can be recorded: {reg.missing.join(", ")}.</p>}
            {n.last_error && !reg.missing.length && <p className="mt-1 text-xs text-danger">{n.last_error}</p>}
            <p className="mt-1 text-xs text-muted-foreground">Registry: Activities → Install notification form. Fill it by hand from the block above, then record the reference and time here.</p>
            {n.canRecord && !d.sentLine && (
              <div className="mt-2 space-y-2">
                <div className="grid gap-2 sm:grid-cols-3"><Input placeholder="Registry reference" value={ref} onChange={(e) => setRef(e.target.value)} /><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I submitted this in the VEU Registry</label></div>
                <Button size="sm" disabled={!confirm || ref.trim().length < 3 || !at} onClick={async () => { await record({ notificationId: n.id, reference: ref, sentAt: new Date(at).toISOString(), method: "manual_portal", confirmed: true }, "Submission recorded"); setRef(""); setAt(""); setConfirm(false); await q.refetch(); }}>Record submission</Button>
              </div>
            )}
          </div>
        ) : <p className="text-xs text-muted-foreground">No notification prepared yet — it is built when the installation is booked and the owner consent is signed. Tap Refresh details after that.</p>}
        <div className="flex flex-wrap items-center gap-2">
          {d.check ? <Badge variant={d.check.passed ? "default" : "destructive"}>{d.check.passed ? "Cleared to start" : "Pre-start check failed"}</Badge> : <Badge variant="outline">Not checked yet</Badge>}
          {d.gate.locked && <Badge variant="destructive">Installation form and evidence locked</Badge>}
          <Button size="sm" variant="outline" onClick={async () => { await rerun({ jobId }, "Check re-run"); await q.refetch(); }}>Re-run check</Button>
        </div>
        {!!d.gate.reasons.length && <ul className="list-disc pl-5 text-xs">{d.gate.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      </div>
    </Section>
  );
}
