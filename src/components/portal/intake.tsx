import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getIntakeSummary } from "@/lib/portal.functions";
import { Pill } from "./badges";

const yn = (v: string | null | undefined) => (v ? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ") : "Not answered");
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" }) : "—");

/** Read-only website intake summary. Declarations are labelled as owner-declared, never verified. */
export function IntakeSummary({ jobId }: { jobId: string }) {
  const fn = useServerFn(getIntakeSummary);
  const { data, isLoading } = useQuery({ queryKey: ["intake_summary", jobId], queryFn: () => fn({ data: { jobId } }) });
  const [showRaw, setShowRaw] = useState(false);
  if (isLoading) return <div className="rounded-xl border p-4 text-sm text-muted-foreground">Loading website intake…</div>;
  if (!data || data.source !== "base44") return null;
  const c = data.consent;
  const rows: [string, string][] = [
    ["Property type", data.declared?.property_type ?? "Not answered"],
    ["Over 5 years old", yn(data.declared?.over_five_years)],
    ["Previous VEU upgrade", yn(data.declared?.previous_upgrade)],
    ["Life support", yn(data.lifeSupport)],
    ["Occupancy", yn(data.occupancy)],
    ["Estimated area", data.area != null ? `${data.area} m²` : "Unknown"],
    ["State", data.state ?? "—"],
  ];
  if (data.declaredExtras?.existing_insulation) rows.splice(3, 0, ["Existing insulation", yn(data.declaredExtras.existing_insulation)]);
  if (data.declaredExtras?.top_floor) rows.splice(4, 0, ["Top floor", yn(data.declaredExtras.top_floor)]);
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Website intake</h3>
        {data.reference && <span className="text-xs text-muted-foreground">Ref {data.reference}</span>}
        {c?.consent_status === "granted"
          ? <Pill t="good">Contact consent granted</Pill>
          : <Pill t="bad">Contact consent missing — no external contact</Pill>}
        {data.postIntake && data.postIntake.status !== "complete" && (
          <Pill t={data.postIntake.status === "failed" ? "bad" : "warn"}>
            {data.postIntake.status === "failed" ? "Initial eligibility checks failed" : "Initial eligibility checks processing"} · {data.postIntake.status}
            {data.postIntake.attempts ? ` · attempt ${data.postIntake.attempts}` : ""}
          </Pill>
        )}
      </div>
      {data.postIntake?.last_error && data.postIntake.status !== "complete" && (
        <p className="mb-2 text-xs text-muted-foreground">Last error: {data.postIntake.last_error} · next try {when(data.postIntake.available_at)}</p>
      )}
      {data.postIntake?.status === "complete" && <p className="mb-2 text-xs text-muted-foreground">Initial eligibility checks complete {when(data.postIntake.completed_at)}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1 text-sm">
          <div className="text-xs font-medium uppercase text-muted-foreground">Contact</div>
          <div>Consent: {c ? `${yn(c.consent_status)}${c.consent_version ? ` · version ${c.consent_version}` : ""} · ${when(c.consented_at)}` : "No record"}</div>
          <div>Age confirmed: {c?.age_confirmed == null ? "Not answered" : c.age_confirmed ? "Yes" : "No"}</div>
          <div>Assistance: {yn(c?.assistance)}</div>
          <div>Preferred contact: {c?.contact_preference ?? "Not given"}</div>
        </div>
        <div className="space-y-1 text-sm">
          <div className="text-xs font-medium uppercase text-muted-foreground">Owner declared (not verified)</div>
          {rows.map(([k, v]) => <div key={k}>{k}: {v}</div>)}
        </div>
        <div className="space-y-1 text-sm">
          <div className="text-xs font-medium uppercase text-muted-foreground">Website screening (information only)</div>
          <div>{data.screening.outcome ? yn(data.screening.outcome) : "No result"}</div>
          {data.screening.reasons && <div className="text-muted-foreground">{data.screening.reasons}</div>}
          {data.research && <div className="text-muted-foreground">Research: {data.research.status ?? "—"}{data.research.first_appearance_year ? ` · first seen ${data.research.first_appearance_year}` : ""}{data.research.evidence_summary ? ` · ${data.research.evidence_summary}` : ""}</div>}
        </div>
        <div className="space-y-1 text-sm">
          <div className="text-xs font-medium uppercase text-muted-foreground">Photos & videos ({data.media.length})</div>
          {data.media.map((m) => (
            <div key={m.id}>{m.url ? <a className="text-primary underline" href={m.url} target="_blank" rel="noreferrer">{m.name}</a> : m.name}</div>
          ))}
          {data.lastMediaFailure && <div className="text-destructive">{data.lastMediaFailure.summary} ({when(data.lastMediaFailure.created_at)})</div>}
        </div>
      </div>
      {data.raw != null && (
        <div className="mt-3">
          <button className="text-xs text-muted-foreground underline" onClick={() => setShowRaw((s) => !s)}>{showRaw ? "Hide" : "Show"} full website snapshot (audit)</button>
          {showRaw && <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(data.raw, null, 2)}</pre>}
        </div>
      )}
    </section>
  );
}
