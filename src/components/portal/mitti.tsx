import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAction } from "@/hooks/use-me";
import { createMittiAssessment, priceRectItem, syncFromMitti, syncPendingMittiAssessments } from "@/lib/portal.functions";
import { Pill } from "./badges";
import { Section } from "./panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mittiFormUrl } from "@/lib/mitti-link.core";

export function useMittiState(jobId: string) {
  return useQuery({
    queryKey: ["mitti", jobId],
    queryFn: async () => {
      const [{ data: a }, { data: ev }, { data: m }] = await Promise.all([
        supabase.from("assessments").select("*").eq("job_id", jobId).maybeSingle(),
        supabase.from("evidence_requirements").select("label,status,category,gate,required").eq("job_id", jobId).eq("required", true),
        supabase.from("ceiling_measurements").select("external_source,external_id,status,measured_area_m2,verified_area_m2,removal_required").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
      ]);
      return { a, ev: ev ?? [], m };
    },
  });
}

function status(a: { external_mitti_id: string | null; mitti_sync_status: string; mitti_completed: boolean; mitti_last_error: string | null; mitti_synced_at: string | null; mitti_modified_at: string | null } | null) {
  if (a?.mitti_sync_status === "error" || a?.mitti_last_error) return ["Error", "bad"] as const;
  if (!a?.external_mitti_id) return ["Not created", "neutral"] as const;
  if (a.mitti_sync_status === "synced") return ["Synced", "good"] as const;
  if (a.mitti_modified_at || a.mitti_synced_at) return ["Waiting for Mitti completion", "warn"] as const;
  return ["Assigned", "warn"] as const;
}

export function MittiCard({ jobId, isAdmin }: { jobId: string; isAdmin: boolean }) {
  const { data } = useMittiState(jobId);
  const create = useAction(createMittiAssessment);
  const sync = useAction(syncFromMitti);
  const batch = useAction(syncPendingMittiAssessments);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const a = data.a;
  const [label, tone] = status(a as never);
  const issues = (a?.mitti_validation_issues as string[] | null) ?? [];
  const locked = a?.status === "complete";
  const evMissing = data.ev.filter((e) => ((e.gate === "assessment" && a?.mitti_scope !== "ELECTRICAL_ONLY") || (a?.piesa_outcome === "pass" && e.category === "piesa_signoff")) && !["uploaded", "verified"].includes(e.status));
  const piesaMissing = evMissing.find((e) => e.category === "piesa_signoff");
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); } finally { setBusy(false); } };
  // Ready Check-only job (installer's own measure-up counts as the Ready Check): the form lives on the
  // measurement row, so show the Ready Check card — never PIESA framing.
  const mAudit = !a?.external_mitti_id && data.m?.external_source === "mitti" ? String(data.m.external_id ?? "") : null;
  if (mAudit) {
    const mUrl = mittiFormUrl(mAudit);
    const mDone = data.m?.status === "complete";
    return (
      <Section title="Ready Check (Mitti)" action={<Pill t={mDone ? "good" : "warn"}>{mDone ? "Complete" : "In progress in Mitti"}</Pill>}>
        <dl className="grid grid-cols-2 gap-1 text-sm">
          <dt className="text-muted-foreground">Form ID</dt><dd className="break-all">{mAudit}</dd>
          <dt className="text-muted-foreground">Measured area</dt><dd>{data.m?.verified_area_m2 ?? data.m?.measured_area_m2 ?? "—"}{data.m?.verified_area_m2 ?? data.m?.measured_area_m2 ? " m²" : ""}</dd>
          <dt className="text-muted-foreground">Removal</dt><dd>{data.m?.removal_required == null ? "—" : data.m.removal_required ? "Required" : "Not required"}</dd>
        </dl>
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <a href={mUrl} target="_blank" rel="noreferrer" className="font-medium text-primary underline">Open this form in Mitti</a>
          <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(mUrl); (await import("sonner")).toast.success("Mitti link copied – send it to the installer"); }}>Copy link for installer</Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">The Ready Check is done in Mitti. Sync brings the answers onto this job — nothing is sent to the owner from here.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size={isAdmin ? "sm" : "field"} variant="outline" className={isAdmin ? "" : "w-full"} disabled={busy} onClick={() => run(() => sync({ jobId }, "Synced from Mitti"))}><RefreshCw /> {isAdmin ? "Sync from Mitti" : "Refresh from Mitti"}</Button>
        </div>
      </Section>
    );
  }
  const mittiUrl = a?.external_mitti_id ? mittiFormUrl(a.external_mitti_id) : null;
  return (
    <Section title={a?.mitti_scope === "MEASURE_UP_ONLY" ? "Mitti installer measurements" : "Mitti electrical assessment · PIESA"} action={<Pill t={tone as never}>{label}</Pill>}>
      <dl className="grid grid-cols-2 gap-1 text-sm">
        <dt className="text-muted-foreground">Audit ID</dt><dd className="break-all">{a?.external_mitti_id ?? "—"}</dd>
        <dt className="text-muted-foreground">Assignee</dt><dd className="break-all">{a?.mitti_assignee_email ?? "—"}</dd>
        <dt className="text-muted-foreground">Last sync</dt><dd>{a?.mitti_synced_at ? new Date(a.mitti_synced_at).toLocaleString("en-AU") : a?.mitti_modified_at ? `partial (Mitti edited ${new Date(a.mitti_modified_at).toLocaleString("en-AU")})` : "—"}</dd>
        {isAdmin && a?.mitti_prefill_count != null && <><dt className="text-muted-foreground">Prefilled fields</dt><dd>{a.mitti_prefill_count}</dd></>}
      </dl>
      {mittiUrl && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <a href={mittiUrl} target="_blank" rel="noreferrer" className="font-medium text-primary underline">Open this form in Mitti</a>
          <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(mittiUrl); (await import("sonner")).toast.success("Mitti link copied – send it to the installer"); }}>Copy link for installer</Button>
        </div>
      )}
      {a?.mitti_last_error && <p className="mt-2 rounded bg-destructive/10 px-2 py-1 text-sm text-danger">{a.mitti_last_error}</p>}
      {issues.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
      {a?.mitti_completed && !locked && (
        <div className="mt-3 rounded-md border border-warning bg-accent px-3 py-2 text-sm font-medium text-accent-foreground">
          Onsite assessment completed in Mitti. Next: {piesaMissing ? "Upload signed PIESA / Pre Insulation Electrical Safety Assessment (PIESA) sign-off" : evMissing.length ? `Upload ${evMissing.map((e) => e.label).join(", ")}` : "Review and press Complete assessment"}.
        </div>
      )}
      {locked && <p className="mt-2 text-sm text-muted-foreground">Assessment complete in the portal – Mitti can no longer change it.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {isAdmin && !locked && <Button size="sm" disabled={busy} onClick={() => run(() => create({ jobId }, a?.external_mitti_id ? "Mitti assessment re-shared" : "Mitti assessment created & assigned"))}><Send /> {a?.external_mitti_id ? "Re-share Mitti assessment" : "Create & assign Mitti assessment"}</Button>}
        {a?.external_mitti_id && !locked && <Button size={isAdmin ? "sm" : "field"} variant="outline" className={isAdmin ? "" : "w-full"} disabled={busy} onClick={() => run(() => sync({ jobId }, "Synced from Mitti"))}><RefreshCw /> {isAdmin ? "Sync from Mitti" : "Refresh from Mitti"}</Button>}
        {isAdmin && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(async () => { const r = (await batch({}, undefined)) as { ok: boolean }[] | undefined; if (r) (await import("sonner")).toast.success(`Checked ${r.length} pending Mitti assessment(s); ${r.filter((x) => !x.ok).length} failed`); })}>Sync pending Mitti assessments</Button>}
      </div>
    </Section>
  );
}

/** Read-only view of Mitti-synced PIESA fields (the electrician does not enter them twice). */
export function MittiSyncedFields({ a: raw }: { a: Record<string, unknown> }) {
  const a = raw as { [k in "measured_area_m2"|"insulation_present"|"existing_r_value"|"removal_required"|"removal_m2"|"access_difficulty"|"downlights_qty"|"downlights_upgrade_qty"|"exhaust_fans_qty"|"exhaust_fans_clearance_qty"|"switchboard_condition"|"rcds_present"|"rcds_required_qty"|"life_support_confirmed"|"piesa_outcome"|"assessed_on"|"hazards"|"notes"]: unknown };
  const f = (v: unknown) => (v === true ? "Yes" : v === false ? "No" : v == null || v === "" ? "—" : String(v));
  const rows: [string, unknown][] = [
    ["Downlights", a.downlights_qty], ["Downlights to upgrade", a.downlights_upgrade_qty], ["Exhaust fans", a.exhaust_fans_qty], ["Need clearance", a.exhaust_fans_clearance_qty],
    ["Switchboard", a.switchboard_condition], ["RCDs present", a.rcds_present], ["RCDs to install", a.rcds_required_qty], ["Life support onsite", a.life_support_confirmed],
    ["PIESA outcome", a.piesa_outcome], ["Assessment date", a.assessed_on], ["Hazards", a.hazards], ["Notes", a.notes],
  ];
  return (
    <Section title="Electrical assessment (from Mitti – read only)">
      <dl className="grid grid-cols-2 gap-1 text-sm">{rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd>{f(v)}</dd></Fragment>)}</dl>
    </Section>
  );
}

export function PriceItemForm({ itemId }: { itemId: string }) {
  const price = useAction(priceRectItem);
  const [p, setP] = useState(""); const [r, setR] = useState("");
  return (
    <form className="mt-1 flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); await price({ itemId, unitPriceIncGst: Number(p), reason: r }, "Item priced"); }}>
      <Input className="h-8 w-32" type="number" step="0.01" placeholder="Unit $ inc GST" value={p} onChange={(e) => setP(e.target.value)} required />
      <Input className="h-8 flex-1" placeholder="Pricing reason" value={r} onChange={(e) => setR(e.target.value)} required minLength={5} />
      <Button size="sm" type="submit">Set price</Button>
    </form>
  );
}
