// S64 (owner ruling G-E1): manual PIESA entry when no Mitti form is linked to the job. Saves through the same
// saveAssessment action the Mitti path uses; completion stays with completeAssessment and its full gate chain.
// When assessments.external_mitti_id is present the Mitti-linked interface stays authoritative (see manualResultEntry).
import { useEffect, useState } from "react";
import { Button, Section, YesNo } from "@/components/trade/trade-ui";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Assessment fields used by the manual entry form. Extend as needed for future fields. */
type AssessmentFields = {
  switchboard_condition?: "ok" | "upgrade_required" | null;
  rcds_present?: boolean | null;
  rcds_required_qty?: number | null;
  life_support_confirmed?: boolean | null;
  hazards?: string | null;
  notes?: string | null;
  assessed_on?: string | null;
  no_rectification_confirmed?: boolean | null;
  piesa_outcome?: "pending" | "pass" | "fail";
  [key: string]: string | number | boolean | null | undefined;
};

/** Manual entry exists only for an unlocked assessment with no Mitti form linked. */
export function manualResultEntry(a: { external_mitti_id: string | null; status: string } | null | undefined): boolean {
  return !a?.external_mitti_id && a?.status !== "complete";
}

export function ElectricianManualResult({ value, locked, savedAt, onPut }: {
  value: AssessmentFields;
  locked: boolean;
  savedAt: string | null;
  onPut: (k: string, v: string | number | boolean | null) => void;
}) {
  // Free text saves on blur, like the number inputs; local state keeps typing off the server.
  const [hazards, setHazards] = useState(value.hazards ?? "");
  const [notes, setNotes] = useState(value.notes ?? "");
  useEffect(() => { setHazards(value.hazards ?? ""); setNotes(value.notes ?? ""); }, [value.hazards, value.notes]);
  const Yn = ({ k, label }: { k: string; label: string }) => (
    <div className="flex items-center justify-between gap-3"><Label>{label}</Label><YesNo label={label} value={value[k] as boolean | null} disabled={locked} onChange={(v) => onPut(k, v)} /></div>
  );
  const Num = ({ k, label }: { k: string; label: string }) => (
    <div><Label>{label}</Label><Input className="h-12 text-base" type="number" inputMode="decimal" defaultValue={(value[k] as number | null) ?? ""} key={String(value[k])} disabled={locked}
      onBlur={(e) => onPut(k, e.target.value === "" ? null : Number(e.target.value))} /></div>
  );
  const Choice = ({ k, label, opts }: { k: string; label: string; opts: [string, string][] }) => (
    <div><Label>{label}</Label><div className="mt-1 grid gap-2" style={{ gridTemplateColumns: `repeat(${opts.length}, minmax(0,1fr))` }}>{opts.map(([v, l]) => <Button key={v} type="button" size="field" variant={value[k] === v ? "default" : "outline"} disabled={locked} onClick={() => onPut(k, v)}>{l}</Button>)}</div></div>
  );
  return (
    <Section title="Electrical assessment · manual entry" action={savedAt ? <span className="text-xs text-muted-foreground">Saved {savedAt}</span> : null}>
      <p className="mb-3 text-sm text-sub">The Mitti form isn't linked to this job yet, so record your results here. Home Insulation Victoria links Mitti forms.</p>
      <div className="space-y-3">
        <Choice k="switchboard_condition" label="Switchboard condition" opts={[["ok", "OK"], ["upgrade_required", "Upgrade needed"]]} />
        <Yn k="rcds_present" label="RCDs present" />
        <Num k="rcds_required_qty" label="RCDs to install" />
        <Yn k="life_support_confirmed" label="Life support onsite" />
        <div><Label>Hazards</Label><Textarea className="mt-1" value={hazards} disabled={locked} onChange={(e) => setHazards(e.target.value)} onBlur={() => onPut("hazards", hazards === "" ? null : hazards)} /></div>
        <div><Label>Notes</Label><Textarea className="mt-1" value={notes} disabled={locked} onChange={(e) => setNotes(e.target.value)} onBlur={() => onPut("notes", notes === "" ? null : notes)} /></div>
        <div><Label>Assessment date</Label><Input className="mt-1 h-12" type="date" value={(value.assessed_on as string) ?? ""} disabled={locked} onChange={(e) => onPut("assessed_on", e.target.value || null)} /></div>
        <Yn k="no_rectification_confirmed" label="No rectification required" />
        <Choice k="piesa_outcome" label="PIESA outcome" opts={[["pass", "Pass"], ["fail", "Fail"]]} />
      </div>
    </Section>
  );
}
