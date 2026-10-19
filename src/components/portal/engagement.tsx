import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useReasonDialog } from "@/components/portal/reason-dialog";
import { getAdminEngagement, sendEstimateEmailAdmin, suppressFollowupsAdmin } from "@/lib/engagement.functions";
import { OPEN_PRIVACY_NOTE, type Summary } from "@/lib/engagement.core";

type Followup = { id: string; slot: string; kind: string; status: string; due_at: string; suppression_reason: string | null; blocked_reason: string | null; sent_at: string | null };
const d = (s: string | null) => (s ? new Date(s).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" }) : "");
const REASON: Record<string, string> = { comms_disabled: "customer communications OFF", no_contact_consent: "no owner contact consent", no_active_estimate_link: "no active estimate link", eligibility_not_permitted: "Gate 1 does not permit", delivery_not_configured: "Base44 delivery bridge not configured", already_sent: "already sent", no_owner_email: "no owner email" };

/** Admin-only customer engagement summary for the Step 3 card. */
export function EngagementPanel({ jobId }: { jobId: string }) {
  const fn = useServerFn(getAdminEngagement);
  const suppress = useServerFn(suppressFollowupsAdmin);
  const send = useServerFn(sendEstimateEmailAdmin);
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const reason = useReasonDialog();
  const { data } = useQuery({ queryKey: ["admin_engagement", jobId], queryFn: () => fn({ data: { jobId } }) as Promise<{ summary: Summary; followups: Followup[]; referral: { status: string; click_count: number; referred_submission_count: number } | null }> });
  if (!data) return null;
  const s = data.summary;
  const next = data.followups.find((f) => f.status === "pending" || f.status === "queued");
  const rows: Array<[string, string]> = [
    ["Email", !s.lastEmailSent ? "Not sent" : s.firstOpen ? `Opened ${d(s.lastOpen)}` : `Sent ${d(s.lastEmailSent)}`],
    ["Estimate", s.firstView ? `Viewed ${d(s.lastView)}${s.firstClick ? " (via email)" : ""}` : "Not viewed"],
    ["Calculator", s.firstCalc ? `Used ${d(s.lastCalc)}` : "Not used"],
    ["Booking", s.bookingCompleted ? `Booked ${d(s.bookingCompleted)}` : s.bookingStarted ? "Started" : "Not started"],
    ["Next follow-up", next ? `${next.slot} · ${d(next.due_at)} · ${next.status}${next.blocked_reason ? ` (${REASON[next.blocked_reason] ?? next.blocked_reason})` : ""}` : data.followups.length ? "None pending" : "None scheduled"],
    ["Referral link", data.referral ? (data.referral.status === "active" ? "Active" : "Revoked") : "Not created"],
    ["Referral clicks", String(data.referral?.click_count ?? 0)],
    ["Referred enquiries", String(data.referral?.referred_submission_count ?? 0)],
  ];
  const doSuppress = async () => {
    const r2 = await reason.ask({ title: "Suppress follow-ups", description: "A reason is required and audited.", placeholder: "Reason for suppressing follow-ups?", minLength: 1 });
    if (!r2) return;
    const r = await suppress({ data: { jobId, reason: r2 } });
    setMsg(`${r.suppressed} follow-up(s) suppressed.`);
    qc.invalidateQueries({ queryKey: ["admin_engagement", jobId] });
  };
  const doSend = async () => {
    const r = (await send({ data: { jobId } })) as { sent: boolean; reason?: string };
    setMsg(r.sent ? "Estimate email sent." : `Not sent — ${REASON[r.reason ?? ""] ?? r.reason}.`);
    qc.invalidateQueries({ queryKey: ["admin_engagement", jobId] });
  };
  return (
    <div className="mb-3 rounded-lg border p-3 text-sm" data-testid="engagement-panel">
      <div className="mb-2 flex flex-wrap items-center gap-2"><b>Customer engagement</b><span className="text-xs text-muted-foreground">tier: {s.tier.replace(/_/g, " ")}</span></div>
      <dl className="grid gap-1 sm:grid-cols-2">{rows.map(([k, v]) => <div key={k}><dt className="inline font-medium">{k}: </dt><dd className="inline">{v}</dd></div>)}</dl>
      <p className="mt-2 text-xs text-muted-foreground">{OPEN_PRIVACY_NOTE}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="h-10 rounded border px-3" onClick={doSend}>Send estimate email</button>
        {next && <button type="button" className="h-10 rounded border px-3" onClick={doSuppress}>Suppress follow-ups</button>}
      </div>
      {msg && <p className="mt-2 text-xs font-medium" role="status">{msg}</p>}
      {data.followups.length > 0 && <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{data.followups.map((f) => <li key={f.id}>{f.slot} · {f.kind.replace(/_/g, " ")} · {f.status}{f.suppression_reason ? ` (${f.suppression_reason})` : ""}{f.sent_at ? ` · sent ${d(f.sent_at)}` : ""}</li>)}</ul>}
      {reason.dialog}
    </div>
  );
}
