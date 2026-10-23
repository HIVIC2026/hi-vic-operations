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
import { addEscConfig, approveEscConfig, getInstallReadiness, recordEscSubmissionFn, recordPiesaDelivery, regenerateEscNotificationFn } from "@/lib/portal.functions";

export function EscInstallPanel({ jobId }: { jobId: string }) {
  const readiness = useServerFn(getInstallReadiness);
  const regen = useAction(regenerateEscNotificationFn);
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
          <div className="mt-1 flex flex-wrap gap-2">{(["owner", "installer"] as const).map((who) => <Button key={who} size="sm" variant="outline" onClick={() => deliver({ jobId, recipient: who, deliveredAt: new Date().toISOString(), method: "email" }, `Delivery to ${who} recorded`)}>Record delivered to {who} now</Button>)}</div>
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
