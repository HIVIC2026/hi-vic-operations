// Ready Check on the installer's own job page (installer-supplied jobs). Same canonical field model as the Mitti A1
// form; partial Save + reopen. Evidence uses the job's existing evidence list (uploads kept). Saving never submits.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button, Section } from "@/components/trade/trade-ui";
import { Input } from "@/components/ui/input";
import { EvidencePanel } from "@/components/portal/panels";
import { getReadyCheckDraft, saveReadyCheckDraft } from "@/lib/ready-check-draft.functions";
import { RC_DRAFT_FIELDS, type RcDraftValues } from "@/lib/ready-check-draft.core";
import { refreshInstallerJob } from "./job-cache";

const SECTION: Record<string, string> = { A: "Attendance", B: "Measurement and existing insulation", C: "Access", D: "Electrical observations (not a PIESA)" };
const OPTION_LABEL: Record<string, string> = { unable_to_confirm: "Can't tell", plan_verified_onsite: "Plan checked onsite", modern_breakers: "Modern breakers", ceramic_fuses_visible: "Ceramic fuses", not_visible: "Not visible", uncertain: "Not sure" };
const opt = (o: string) => OPTION_LABEL[o] ?? o.charAt(0).toUpperCase() + o.slice(1).replace(/_/g, " ");

export function ReadyCheckDraft({ jobId, evidence = true }: { jobId: string; evidence?: boolean }) {
  const qc = useQueryClient();
  const load = useServerFn(getReadyCheckDraft), save = useServerFn(saveReadyCheckDraft);
  const { data, isError, error, refetch, isFetching } = useQuery({ queryKey: ["rc-draft", jobId], queryFn: () => load({ data: { jobId } }), retry: false });
  const [v, setV] = useState<RcDraftValues>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (data && !dirty && !busy) setV(data.values); }, [data, dirty, busy]);

  if (isError && !data) return <Section title="Ready Check"><p className="text-sm" role="alert">Couldn't load the Ready Check: {(error as Error).message}</p><Button variant="outline" disabled={isFetching} onClick={() => void refetch()}>Retry</Button></Section>;
  if (!data) return <Section title="Ready Check"><p className="text-sm text-sub">Loading…</p></Section>;
  const locked = data.status === "submitted";
  const set = (k: string, x: string) => { setV((o) => ({ ...o, [k]: x })); setDirty(true); setMsg(null); };
  const onSave = async () => {
    if (busy || locked || !dirty) return;
    setBusy(true); setMsg(null);
    try { const r = await save({ data: { jobId, values: v } }); qc.setQueryData(["rc-draft", jobId], r); await refreshInstallerJob(qc, jobId); setDirty(false); setMsg({ ok: true, text: "Saved. You can come back and finish it any time — nothing has been submitted." }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message || "Couldn't save — check your signal and try again." }); }
    finally { setBusy(false); }
  };
  const p = data.progress;
  return (
    <div className="space-y-4" data-rc-draft data-rc-status={data.status}>
      <Section title="Ready Check" right={<span className="text-xs text-sub">{locked ? "Submitted" : data.savedAt ? `Draft saved ${new Date(data.savedAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "Not started"}</span>}>
        <div className="space-y-1 text-sm" data-rc-commercial>
          <p><span className="font-bold">Organised by:</span> {data.coordination === "self_managed" ? "you" : data.coordination === "hivic_managed" ? "Home Insulation Victoria" : "not recorded"}</p>
          <p><span className="font-bold">Owner quote:</span> {data.commercial.ready ? (data.commercial.releaseBlockers.length ? `ready to prepare — waiting on: ${data.commercial.releaseBlockers.join("; ")}` : "ready for the office to send") : `on hold — ${data.commercial.blockers.join("; ")}`}</p>
          <p className="text-xs text-sub">The owner quote and the Ready Check are tracked separately. You can enter answers now or on install day.</p>
        </div>
        <div className="mt-3 rounded-[12px] bg-mist p-3 text-sm" data-rc-outstanding>
          <p className="font-bold">{p.outstandingCount === 0 ? "Everything entered — waiting for Home Insulation Victoria to check it" : `${p.outstandingCount} item${p.outstandingCount === 1 ? "" : "s"} outstanding`}</p>
          <List title="Answers still needed" items={p.missingAnswers} attr="missing" />
          <List title="Photos or videos still needed" items={p.evidence.missing} attr="evidence-missing" />
          <List title="Rejected — upload again" items={p.evidence.rejected} attr="rejected" tone="text-danger" />
          <List title="Uploaded, waiting for review" items={p.evidence.awaitingReview} attr="awaiting" />
          {p.worksBlockers.length > 0 && <p className="mt-2 text-xs font-semibold" data-rc-works-blocked>Works can't start until the original condition is recorded ({p.worksBlockers.length} answer{p.worksBlockers.length === 1 ? "" : "s"}).</p>}
        </div>
      </Section>
      {(["A", "B", "C", "D"] as const).map((s) => (
        <Section key={s} title={SECTION[s]}>
          <div className="space-y-3">
            {RC_DRAFT_FIELDS.filter((f) => f.section === s).map((f) => (
              <label key={f.key} className="block text-sm font-bold" data-rc-field={f.key}>
                {f.label}{!f.required && <span className="font-normal text-sub"> (if applicable)</span>}
                {data.prefilled.includes(f.key) && v[f.key] === data.values[f.key] && <span className="block text-xs font-normal text-sub">From the job details — check it</span>}
                {f.key === "measure.eligible_area_m2" && data.suppliedAreaHint != null && <span className="block text-xs font-normal text-sub">Your quote said {data.suppliedAreaHint} m² — enter what you measure</span>}
                {f.kind === "enum" || f.kind === "boolean"
                  ? <select className="mt-1 h-12 w-full rounded-[10px] border border-line bg-paper px-3 text-base font-normal" disabled={locked || busy} value={v[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label}>
                      <option value="">Not recorded yet</option>
                      {(f.kind === "boolean" ? ["yes", "no"] : f.options ?? []).map((o) => <option key={o} value={o}>{opt(o)}</option>)}
                    </select>
                  : <Input className="mt-1 h-12 text-base font-normal" disabled={locked || busy} aria-label={f.label} type={f.kind === "datetime" ? "datetime-local" : "text"} inputMode={f.kind === "number" ? "decimal" : f.kind === "integer" ? "numeric" : undefined} value={v[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />}
              </label>
            ))}
          </div>
        </Section>
      ))}
      {evidence && <EvidencePanel jobId={jobId} role="measure" gates={["assessment"]} />}
      {isError && <p role="alert">Couldn't refresh the Ready Check. Your answers are kept. <Button variant="outline" disabled={isFetching || busy} onClick={() => void refetch()}>Retry</Button></p>}
      {msg && <p role="status" className={`rounded-[12px] border border-line bg-paper p-3 text-sm ${msg.ok ? "" : "text-danger"}`} data-rc-save-msg>{msg.text}</p>}
      {!locked && <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-10 md:bottom-3"><Button size="field" className="w-full" disabled={busy || !dirty} aria-busy={busy} onClick={onSave}>{busy ? "Saving…" : dirty ? "Save Ready Check" : "Saved"}</Button></div>}
    </div>
  );
}

function List({ title, items, attr, tone }: { title: string; items: string[]; attr: string; tone?: string }) {
  if (!items.length) return null;
  return <div className="mt-2" data-rc-list={attr}><p className={`text-xs font-bold uppercase tracking-wide ${tone ?? "text-sub"}`}>{title}</p><ul className="list-disc pl-5">{items.map((i) => <li key={i}>{i}</li>)}</ul></div>;
}
