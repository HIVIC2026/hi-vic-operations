import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAction } from "@/hooks/use-me";
import { Section } from "./panels";
import { Pill } from "./badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fmtDateTime } from "@/lib/workflow";
import { addEscConfig, approveEscConfig, getInstallReadiness, markIntelligenceReviewed, recordEscSubmissionFn, recordPiesaDelivery, regenerateEscNotificationFn, runPropertyIntelligenceFn, submitEscNotification } from "@/lib/portal.functions";

const OUTCOME: Record<string, [string, "good" | "warn" | "bad"]> = {
  likely_eligible: ["Likely eligible", "good"], needs_onsite_confirmation: ["Needs onsite confirmation", "warn"], does_not_appear_eligible: ["Does not appear eligible", "bad"],
};
const STATUS_TONE = { pass: "good", review: "warn", fail: "bad", unknown: "neutral", info: "neutral" } as const;
type FactRow = { id: string; fact_key: string; value: unknown; check_status: string; source_name: string; source_url: string | null; source_record_id: string | null; source_date: string | null; retrieved_at: string; confidence: string; evidence_kind: string; note: string | null; is_stale: boolean };

const ROWS: { label: string; keys: string[] }[] = [
  { label: "Address confirmed", keys: ["address_verified", "normalized_address", "in_victoria", "property_identifier"] },
  { label: "Residential", keys: ["residential_likelihood", "planning_zone", "ncc_class_evidence", "multi_assessment_property"] },
  { label: "Older than 5 years", keys: ["age_evidence"] },
];
const show = (v: unknown) => v == null ? "Unknown" : typeof v === "object" ? Object.entries(v as Record<string, unknown>).filter(([, x]) => x != null).map(([k, x]) => `${k.replace(/_/g, " ")}: ${String(x)}`).join(" · ") : String(v).replace(/_/g, " ");
const worst = (fs: FactRow[]) => fs.some((f) => f.check_status === "fail") ? "fail" : fs.some((f) => f.check_status === "review") ? "review" : fs.some((f) => f.check_status === "pass") ? "pass" : "unknown";

export function PropertyIntelligenceCard({ jobId }: { jobId: string }) {
  const rerun = useAction(runPropertyIntelligenceFn);
  const review = useAction(markIntelligenceReviewed);
  const [note, setNote] = useState("");
  const { data } = useQuery({
    queryKey: ["intel", jobId],
    queryFn: async () => {
      const [run, facts] = await Promise.all([
        supabase.from("property_intelligence_runs").select("*").eq("job_id", jobId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("property_facts").select("*").eq("job_id", jobId).eq("is_current", true),
      ]);
      return { run: run.data, facts: (facts.data ?? []) as FactRow[] };
    },
  });
  const run = data?.run;
  const o = run?.result ? OUTCOME[run.result] : null;
  return (
    <Section title="Property Intelligence (preliminary – information only)" action={<Button size="sm" variant="outline" onClick={() => rerun({ jobId }, "Property intelligence re-run")}>Re-run property intelligence</Button>}>
      {!run ? <p className="text-sm text-muted-foreground">Not run yet.</p> : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {o ? <Pill t={o[1]}>{o[0]}</Pill> : <Pill>{run.status}</Pill>}
            {run.is_stale && <Pill t="bad">Stale – re-run required</Pill>}
          </div>
          <p className="rounded bg-accent px-2 py-1.5 font-medium text-accent-foreground">{run.next_action}</p>
          {run.result_reason && <p className="text-xs text-muted-foreground">{run.result_reason}</p>}
          <ul className="divide-y rounded border">
            {ROWS.map((r) => {
              const fs = data!.facts.filter((f) => r.keys.includes(f.fact_key));
              const main = fs.find((f) => f.fact_key === r.keys[0]);
              const st = worst(fs);
              return (
                <li key={r.label} className="flex items-center gap-2 px-2 py-1.5">
                  <Pill t={STATUS_TONE[st as keyof typeof STATUS_TONE]} className="w-20 justify-center">{st.toUpperCase()}</Pill>
                  <span className="w-40 shrink-0 font-medium">{r.label}</span>
                  <span className="truncate">{show(main?.value)}</span>
                </li>
              );
            })}
          </ul>
          <div>
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Must be confirmed onsite</h3>
            <ul className="list-disc pl-5 text-xs"><li>Existing insulation type / R-value (&lt; R2.0; foil / uncompressed only)</li><li>All luminaires IC / IC-4</li><li>Electrical safety / PIESA</li><li>Measured relevant ceiling area (governs quote & VEEC)</li><li>Roof cavity or exposed roof above, and no storey above</li></ul>
          </div>
          <div className="flex gap-2"><Input placeholder="Review note (what you checked)" value={note} onChange={(e) => setNote(e.target.value)} /><Button size="sm" variant="outline" disabled={note.trim().length < 3} onClick={async () => { await review({ jobId, note }, "Review recorded"); setNote(""); }}>Review evidence</Button></div>
        </div>
      )}
    </Section>
  );
}

export function EscInstallPanel({ jobId }: { jobId: string }) {
  const readiness = useServerFn(getInstallReadiness);
  const regen = useAction(regenerateEscNotificationFn);
  const submit = useAction(submitEscNotification);
  const record = useAction(recordEscSubmissionFn);
  const deliver = useAction(recordPiesaDelivery);
  const { data: r } = useQuery({ queryKey: ["ready", jobId], queryFn: () => readiness({ data: { jobId } }) });
  const { data: notes = [] } = useQuery({ queryKey: ["esc", jobId], queryFn: async () => (await supabase.from("esc_notifications").select("*").eq("job_id", jobId).order("created_at", { ascending: false })).data ?? [] });
  const { data: dels = [] } = useQuery({ queryKey: ["piesa_del", jobId], queryFn: async () => (await supabase.from("piesa_deliveries").select("*").eq("job_id", jobId).order("delivered_at", { ascending: false })).data ?? [] });
  const [ref, setRef] = useState(""); const [at, setAt] = useState(""); const [confirm, setConfirm] = useState(false);
  const cur = notes.find((n) => n.status !== "stale" && n.status !== "cancelled");
  return (
    <Section title="Pre-install compliance (ESC notice · consent · PIESA copies)" action={<Button size="sm" variant="outline" onClick={() => regen({ jobId }, "Notification regenerated")}>Regenerate notice</Button>}>
      <div className="space-y-3 text-sm">
        <div className={`rounded-md px-3 py-2 font-semibold ${r?.ready ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
          {r?.ready ? "READY TO INSTALL" : "NOT READY TO INSTALL"}{r?.dueBy && <span className="ml-2 font-normal">· ESC notification due by {fmtDateTime(r.dueBy)}</span>}
        </div>
        {!!r?.blockers.length && <ul className="list-disc pl-5 text-xs text-danger">{r.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
        {cur ? (
          <div className="rounded border p-2">
            <div className="flex flex-wrap items-center gap-2"><b>ESC notification v{cur.version}</b><Pill t={cur.status === "sent" || cur.status === "accepted" ? "good" : cur.status === "ready" ? "brand" : "warn"}>{cur.status.replace("_", " ")}</Pill><span className="text-xs text-muted-foreground">start {fmtDateTime(cur.scheduled_start)} · due {fmtDateTime(cur.due_by)}</span></div>
            {cur.last_error && <p className="text-xs text-danger">{cur.last_error}</p>}
            {cur.sent_at && <p className="text-xs">Sent {fmtDateTime(cur.sent_at)} · ref {cur.submission_reference} · {cur.submission_method?.replace("_", " ")}</p>}
            <details className="mt-1"><summary className="cursor-pointer text-xs">Payload (export)</summary><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(cur.payload_json, null, 2)}</pre>
              <Button size="sm" variant="outline" className="mt-1" onClick={() => navigator.clipboard.writeText(JSON.stringify(cur.payload_json, null, 2))}>Copy payload</Button></details>
            {cur.status === "ready" && (
              <div className="mt-2 space-y-2">
                <Button size="sm" onClick={() => submit({ notificationId: cur.id }, "Submitted")}>Submit via ESC adapter</Button>
                <div className="grid gap-2 sm:grid-cols-3"><Input placeholder="ESC submission reference" value={ref} onChange={(e) => setRef(e.target.value)} /><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I confirm this was actually submitted to ESC</label></div>
                <Button size="sm" variant="outline" disabled={!confirm || ref.trim().length < 3 || !at} onClick={async () => { await record({ notificationId: cur.id, reference: ref, sentAt: new Date(at).toISOString(), method: "manual_portal", confirmed: true }, "Submission recorded"); setRef(""); setAt(""); setConfirm(false); }}>Record manual submission</Button>
              </div>
            )}
          </div>
        ) : <p className="text-xs text-muted-foreground">No notification yet – created when installation is booked.</p>}
        {notes.filter((n) => n.status === "stale").length > 0 && <p className="text-xs text-muted-foreground">{notes.filter((n) => n.status === "stale").length} earlier notice(s) stale.</p>}
        <div className="rounded border p-2">
          <b>Signed PIESA copy delivered</b>
          <ul className="text-xs">{(["owner", "installer"] as const).map((who) => { const d = dels.find((x) => x.recipient === who); return <li key={who}>{who}: {d ? `${fmtDateTime(d.delivered_at)} (${d.method})` : <span className="text-danger">not recorded</span>}</li>; })}</ul>
          <div className="mt-1 flex gap-2">{(["owner", "installer"] as const).map((who) => <Button key={who} size="sm" variant="outline" onClick={() => deliver({ jobId, recipient: who, deliveredAt: new Date().toISOString(), method: "email" }, `Delivery to ${who} recorded`)}>Record delivered to {who} now</Button>)}</div>
        </div>
      </div>
    </Section>
  );
}

export function EscConfigSection() {
  const add = useAction(addEscConfig); const approve = useAction(approveEscConfig);
  const { data = [] } = useQuery({ queryKey: ["esc_config"], queryFn: async () => (await supabase.from("esc_notification_config").select("*").order("created_at", { ascending: false })).data ?? [] });
  const [version, setVersion] = useState(""); const [src, setSrc] = useState(""); const [fields, setFields] = useState("");
  const parsed = fields.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [key, ...rest] = l.split("|"); return { key: (key ?? "").trim(), label: rest.join("|").trim() }; });
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">ESC notification fields (Ceiling Insulation Activity Guide)</h2>
      <p className="text-xs text-muted-foreground">Base fields (installation days, premises address, owner contact) are always sent. List any additional fields the current Activity Guide requires. Until a version is approved, every notice is "configuration required" and installation is blocked.</p>
      {data.length === 0 && <p className="text-sm text-danger">Not configured</p>}
      <ul className="space-y-1 text-sm">{data.map((c) => <li key={c.id} className="flex items-center gap-2 rounded border p-2"><b>{c.version}</b>{c.is_active ? <Pill t="good">Active</Pill> : c.approved ? <Pill>Superseded</Pill> : <Pill t="warn">Draft</Pill>}<span className="truncate text-xs text-muted-foreground">{(c.required_fields as { label: string }[]).map((f) => f.label).join(", ") || "no additional fields"}</span>{!c.approved && <Button size="sm" className="ml-auto" onClick={() => approve({ id: c.id }, "Approved")}>Approve & activate</Button>}</li>)}</ul>
      <Input placeholder="Version" value={version} onChange={(e) => setVersion(e.target.value)} />
      <Input placeholder="Source (Activity Guide name / date / URL)" value={src} onChange={(e) => setSrc(e.target.value)} />
      <Textarea rows={4} placeholder={"One per line: field_key|Label"} value={fields} onChange={(e) => setFields(e.target.value)} />
      <Button size="sm" disabled={!version.trim() || src.trim().length < 5} onClick={async () => { await add({ version, fields: parsed, source_note: src }, "Draft saved"); setVersion(""); setSrc(""); setFields(""); }}>Save draft</Button>
    </section>
  );
}
