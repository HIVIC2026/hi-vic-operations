import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check, Ruler, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAction } from "@/hooks/use-me";
import { completeMeasurement, flagMeasurement, getJobScope, getMeasurementReview, reviewMeasurement, saveMeasurement, setMeasureUpResponsibility } from "@/lib/portal.functions";
import { MEASURE_FIELD_LABEL, type MeasureField } from "@/lib/scope.core";
import { fmtDate } from "@/lib/workflow";
import { METHOD_LABEL, PURPOSE_LABEL, type MeasureMethod, type MeasurePurpose } from "@/lib/measurement.core";
import { Pill } from "./badges";
import { EvidencePanel, Section } from "./panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function useJobScope(jobId: string) {
  const fn = useServerFn(getJobScope);
  return useQuery({ queryKey: ["scope", jobId], queryFn: () => fn({ data: { jobId } }) });
}

export function useMeasurements(jobId: string) {
  return useQuery({
    queryKey: ["measurements", jobId],
    queryFn: async () => {
      const { data } = await supabase.from("ceiling_measurements")
        .select("*, completer:profiles!ceiling_measurements_completed_by_fkey(full_name), supplementer:profiles!ceiling_measurements_supplemented_by_fkey(full_name)")
        .eq("job_id", jobId).order("created_at", { ascending: false });
      const rows = data ?? [];
      return { current: rows.find((r) => r.is_current) ?? null, history: rows.filter((r) => !r.is_current) };
    },
  });
}

const yn = (v: unknown) => (v === true ? "Yes" : v === false ? "No" : v == null || v === "" ? "—" : String(v));
const SOURCE: Record<string, string> = { electrician: "Electrician", installer: "Installer", admin_import: "Admin / import" };
const M_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = { accepted: "good", needs_review: "bad", draft: "warn", missing: "neutral" };
const M_LABEL: Record<string, string> = { accepted: "Accepted", needs_review: "Needs review", draft: "In progress", missing: "Not started" };
const E_LABEL: Record<string, string> = { current: "Current", expired: "Expired – reassess", missing: "Not recorded" };

type M = NonNullable<ReturnType<typeof useMeasurements>["data"]>["current"];

export function MeasurementDetails({ m, admin = false }: { m: M; admin?: boolean }) {
  if (!m) return <p className="text-sm text-muted-foreground">No Ready Check recorded yet.</p>;
  const who = (m.completer as { full_name: string | null } | null)?.full_name;
  const sup = (m.supplementer as { full_name: string | null } | null)?.full_name;
  const rows: [string, unknown][] = [
    ["Source", `${SOURCE[m.source_role] ?? m.source_role}${who ? ` · ${who}` : ""}`],
    ["Completed", m.completed_at ? fmtDate(m.completed_at) : "—"],
    m.measured_area_m2 == null && m.supplied_area_m2 != null && m.provenance === "installer_supplied_provisional"
      ? ["Installer's measure", `${Number(m.supplied_area_m2)} m²`]
      : ["Measured area", m.measured_area_m2 != null ? `${Number(m.measured_area_m2)} m²` : null],
    ["Removal", m.removal_required ? `${m.removal_m2 ?? "?"} m²` : m.removal_required],
    ["Existing insulation", m.insulation_present], ["Existing R-value", m.existing_r_value],
    ["Access", m.access_difficulty],
    // Internal reference codes (e.g. installer import IDs) are not shown on the office screen; Mitti IDs stay visible.
    ["Reference", m.external_id && m.external_source === "mitti" ? `mitti ${m.external_id}` : null],
  ];
  const provisional = m.provenance === "installer_supplied_provisional";
  if (provisional) rows.unshift(["Status", m.verified_at ? "Installer-supplied – verified onsite" : "Installer-supplied – provisional (onsite measurement required)"]);
  if (m.measurement_purpose) rows.push(["Purpose", PURPOSE_LABEL[m.measurement_purpose as MeasurePurpose] ?? m.measurement_purpose]);
  if (m.measurement_method) rows.push(["Supplied method", METHOD_LABEL[m.measurement_method as MeasureMethod] ?? m.measurement_method]);
  if (m.measured_by_name || m.measured_on) rows.push(["Measured by", [m.measured_by_name, m.measured_by_role, m.measured_on && fmtDate(m.measured_on)].filter(Boolean).join(" · ")]);
  if (m.gross_area_m2 != null || m.excluded_area_m2 != null) rows.push(["Gross / excluded", `${m.gross_area_m2 ?? "—"} m² / ${m.excluded_area_m2 ?? "—"} m²`]);
  if (admin && provisional) {
    if (m.measured_area_m2 != null) rows.push(["Installer's measure", m.supplied_area_m2 != null ? `${Number(m.supplied_area_m2)} m²` : null]);
    if (m.supplied_removal_m2 != null) rows.push(["Installer-supplied removal", `${Number(m.supplied_removal_m2)} m²`]);
    if (m.verified_at) {
      rows.push(["Onsite verified area", `${Number(m.verified_area_m2)} m² (${METHOD_LABEL[m.verified_method as MeasureMethod] ?? m.verified_method}, ${m.verified_role})`]);
      rows.push(["Variance (supplied − onsite)", m.variance_m2 != null ? `${Number(m.variance_m2)} m² (${Number(m.variance_pct)}%)` : null]);
    }
  }
  if (m.accepted_at) rows.push(["Accepted by Home Insulation Victoria", `${fmtDate(m.accepted_at)}${m.accepted_standard_version ? ` · standard ${m.accepted_standard_version}` : ""}${m.accepted_reason ? ` · ${m.accepted_reason}` : ""}`]);
  if (sup) rows.push(["Completed onsite by", `${sup} (${((m.supplemented_fields as string[]) ?? []).map((f) => MEASURE_FIELD_LABEL[f as MeasureField] ?? f).join(", ")})`]);
  if (m.review_reason) rows.push(["Review note", m.review_reason]);
  return <dl className="grid grid-cols-2 gap-1 text-sm">{rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd>{yn(v)}</dd></Fragment>)}</dl>;
}

/** Admin: two requirement cards + derived visit scope banner. */
export function RequirementCards({ jobId, isAdmin, job }: { jobId: string; isAdmin: boolean; job: { electrician_name: string | null; piesa_date: string | null; install_deadline: string | null; days_remaining: number | null } }) {
  const { data: s } = useJobScope(jobId);
  const { data: ms } = useMeasurements(jobId);
  const { data: el } = useQuery({
    queryKey: ["assessment-el", jobId],
    queryFn: async () => {
      const [{ data: a }, { count }, { data: j }] = await Promise.all([
        supabase.from("assessments").select("status, assessed_on, piesa_outcome").eq("job_id", jobId).maybeSingle(),
        supabase.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "required"),
        supabase.from("jobs").select("measure_up_responsibility").eq("id", jobId).single(),
      ]);
      return { a, rect: count ?? 0, by: "installer" };
    },
  });
  const review = useAction(reviewMeasurement);
  const loadReview = useServerFn(getMeasurementReview);
  const { data: rv } = useQuery({ queryKey: ["measurement-review", jobId, ms?.current?.id, ms?.current?.status], queryFn: () => loadReview({ data: { jobId } }), enabled: isAdmin && !!ms?.current });
  const setBy = useAction(setMeasureUpResponsibility);
  const [reason, setReason] = useState("");
  if (!s) return null;
  const m = ms?.current ?? null;
  return (
    <div className="space-y-3">
      <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${s.scope === "COMPLETE" ? "border-success/30 bg-success-soft text-success" : "border-primary/30 bg-secondary text-secondary-foreground"}`}>
        <div><div className="text-xs font-semibold uppercase">Visit scope</div><div className="font-semibold">{s.label}</div>{s.nextAction && <div className="text-xs">{s.nextAction}</div>}</div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Ready Check" action={<Pill t={M_TONE[s.measurement.state] ?? "neutral"}>{M_LABEL[s.measurement.state]}</Pill>}>
          <Ruler className="mb-2 h-4 w-4 text-muted-foreground" />
          <MeasurementDetails m={m} admin={isAdmin} />
          {isAdmin && rv?.withinTolerance != null && <p className={`mt-1 text-xs ${rv.withinTolerance ? "text-success" : "text-danger"}`}>Variance {rv.withinTolerance ? "within" : "outside"} the {rv.tolerancePct}% pilot tolerance</p>}
          {(() => {
            // Installer-supplied area counts as the installer's measure, so it is not listed as missing.
            const hasSupplied = m?.provenance === "installer_supplied_provisional" && m.supplied_area_m2 != null;
            const missing = s.measurement.missing.filter((f) => !(hasSupplied && f === "measured_area_m2"));
            return s.measurement.state !== "accepted" && missing.length > 0 && <p className="mt-2 text-xs text-danger">Missing: {missing.map((f) => MEASURE_FIELD_LABEL[f]).join(", ")}</p>;
          })()}
          {isAdmin && (
            <div className="mt-3 space-y-2 border-t pt-3">
              <div className="flex items-center gap-2 text-sm"><Label>Ready Check</Label><span className="font-semibold">Installer only</span></div>
              {m && (
                <>
                  {/* Installer-supplied jobs: the installer's own measure counts as the Ready Check (Jo, 22 Oct), so the AP-standard box is not shown. */}
                  {m.status !== "complete" && m.provenance !== "installer_supplied_provisional" && !!rv?.blockers.length && <ul className="rounded bg-warning-soft p-2 text-xs text-warning">{rv.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
                  <Input placeholder="Review reason (audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    {m.status !== "complete" && <Button size="sm" disabled={reason.trim().length < 3 || !!rv?.blockers.length} onClick={async () => { await review({ jobId, action: "accept", reason }, "Ready Check accepted"); setReason(""); }}>Accept Ready Check</Button>}
                    <Button size="sm" variant="outline" disabled={reason.trim().length < 3} onClick={async () => { await review({ jobId, action: "needs_review", reason }, "Marked needs review"); setReason(""); }}>Needs review</Button>
                    <Button size="sm" variant="destructive" disabled={reason.trim().length < 3} onClick={async () => { await review({ jobId, action: "reject", reason }, "Ready Check rejected"); setReason(""); }}>Reject</Button>
                  </div>
                </>
              )}
              {!!ms?.history.length && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{ms.history.length} earlier Ready Check record(s)</summary>{ms.history.map((h) => <p key={h.id}>{fmtDate(h.created_at)} · {SOURCE[h.source_role]} · {h.status} · {h.measured_area_m2 ?? "—"} m² {h.review_reason && `· ${h.review_reason}`}</p>)}</details>}
            </div>
          )}
        </Section>
        <Section title="Electrical / PIESA" action={<Pill t={s.electrical.state === "current" ? "good" : s.electrical.state === "expired" ? "bad" : "neutral"}>{E_LABEL[s.electrical.state]}</Pill>}>
          <Zap className="mb-2 h-4 w-4 text-muted-foreground" />
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-muted-foreground">Electrician</dt><dd>{job.electrician_name ?? "Unassigned"}</dd>
            <dt className="text-muted-foreground">Assessment date</dt><dd>{el?.a?.assessed_on ? fmtDate(el.a.assessed_on) : "—"}</dd>
            <dt className="text-muted-foreground">Outcome</dt><dd>{el?.a?.piesa_outcome ?? "—"}{el?.a?.status === "complete" ? " (recorded)" : el?.a ? " (draft)" : ""}</dd>
            <dt className="text-muted-foreground">30-day deadline</dt><dd>{job.piesa_date ? `${fmtDate(job.install_deadline)} (${s.electrical.state === "expired" ? "expired" : `${job.days_remaining} days`})` : "—"}</dd>
            <dt className="text-muted-foreground">Electrical fixes</dt><dd>{el?.rect ? `${el.rect} item(s) required` : "None open"}</dd>
          </dl>
        </Section>
      </div>
    </div>
  );
}

/** Trade view: accepted measure-up read-only + "needs review" flag (never re-entry). */
export function MeasurementReadOnly({ jobId, canFlag }: { jobId: string; canFlag: boolean }) {
  const { data: ms } = useMeasurements(jobId);
  const flag = useAction(flagMeasurement, { refresh: { jobId } });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [fields, setFields] = useState<MeasureField[]>([]);
  return (
    <Section title="Ready Check (accepted – read only)" action={<Pill t="good">Accepted</Pill>}>
      <MeasurementDetails m={ms?.current ?? null} />
      {canFlag && (!open ? (
        <Button size="field" variant="outline" className="mt-3 w-full" onClick={() => setOpen(true)}><AlertTriangle /> Measurement appears inconsistent / needs review</Button>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">{(Object.keys(MEASURE_FIELD_LABEL) as MeasureField[]).map((f) => (
            <Button key={f} type="button" size="sm" variant={fields.includes(f) ? "default" : "outline"} onClick={() => setFields(fields.includes(f) ? fields.filter((x) => x !== f) : [...fields, f])}>{MEASURE_FIELD_LABEL[f]}</Button>
          ))}</div>
          <Textarea placeholder="What looks wrong?" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="field" className="w-full" disabled={reason.trim().length < 5} onClick={async () => { await flag({ jobId, reason, fields }, "Flagged for review"); setOpen(false); }}>Flag for review</Button>
        </div>
      ))}
    </Section>
  );
}

/** Measure-up entry: only the fields in scope are editable. Autosaves. */
export function MeasurementForm({ jobId, editable, title, showComplete }: { jobId: string; editable: MeasureField[]; title: string; showComplete: boolean }) {
  const { data: ms } = useMeasurements(jobId);
  const save = useAction(saveMeasurement);
  const done = useAction(completeMeasurement);
  const m = ms?.current;
  const provisional = m?.provenance === "installer_supplied_provisional" && !m?.verified_at;
  const [method, setMethod] = useState<"laser" | "tape" | "floorplan" | "other" | null>(null);
  const [local, setLocal] = useState<Record<string, unknown>>({});
  const v = (k: MeasureField) => (k in local ? local[k] : m?.[k]);
  const put = async (k: MeasureField, val: unknown) => { setLocal((p) => ({ ...p, [k]: val })); await save({ jobId, patch: { [k]: val } as never }); };
  const can = (k: MeasureField) => editable.includes(k);
  const Yn = ({ k, label }: { k: MeasureField; label: string }) => (
    <div><Label>{label}</Label><div className="mt-1 grid grid-cols-2 gap-2">{[true, false].map((b) => <Button key={String(b)} type="button" size="field" variant={v(k) === b ? "default" : "outline"} disabled={!can(k)} onClick={() => put(k, b)}>{b ? "Yes" : "No"}</Button>)}</div></div>
  );
  const Num = ({ k, label }: { k: MeasureField; label: string }) => (
    <div><Label>{label}</Label><Input className="h-12 text-base" type="number" inputMode="decimal" step="0.1" defaultValue={(v(k) as number | null) ?? ""} key={String(v(k))} disabled={!can(k)} onBlur={(e) => e.target.value !== "" && put(k, Number(e.target.value))} /></div>
  );
  return (
    <Section title={title}>
      {m?.source_role && <p className="mb-2 text-xs text-muted-foreground">Original Ready Check by {SOURCE[m.source_role]} – only missing or flagged fields can be completed here.</p>}
      {provisional && <p className="mb-2 rounded bg-warning-soft p-2 text-sm text-warning">Measure the ceiling area yourself onsite – the installer's figure is kept separately for comparison.</p>}
      <div className="grid gap-3">
        <Num k="measured_area_m2" label="Measured ceiling area (m²)" />
        <Yn k="insulation_present" label="Existing insulation present?" />
        {v("insulation_present") === true && <Num k="existing_r_value" label="Measured / confirmed R-value" />}
        <Yn k="removal_required" label="Removal required?" />
        {v("removal_required") === true && <Num k="removal_m2" label="Removal area (m²)" />}
        <div><Label>Ceiling access</Label><div className="mt-1 grid grid-cols-3 gap-2">{(["easy", "moderate", "difficult"] as const).map((o) => <Button key={o} type="button" size="field" variant={v("access_difficulty") === o ? "default" : "outline"} disabled={!can("access_difficulty")} onClick={() => put("access_difficulty", o)} className="capitalize">{o}</Button>)}</div></div>
      </div>
      <div className="mt-3"><EvidencePanel jobId={jobId} role="measure" gates={["assessment"]} /></div>
      {showComplete && provisional && <div className="mt-3"><Label>How did you measure the ceiling area?</Label><div className="mt-1 grid grid-cols-4 gap-2">{(["laser", "tape", "floorplan", "other"] as const).map((k) => <Button key={k} type="button" size="field" variant={method === k ? "default" : "outline"} onClick={() => setMethod(k)}>{METHOD_LABEL[k]}</Button>)}</div></div>}
      {showComplete && <Button size="field" className="mt-3 w-full" disabled={provisional && !method} onClick={() => done({ jobId, ...(method ? { method } : {}) }, "Ready Check complete")}><Check /> Complete Ready Check</Button>}
    </Section>
  );
}
