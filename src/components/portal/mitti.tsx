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

export function useMittiState(jobId: string) {
  return useQuery({
    queryKey: ["mitti", jobId],
    queryFn: async () => {
      const [{ data: a }, { data: ev }] = await Promise.all([
        supabase.from("assessments").select("*").eq("job_id", jobId).maybeSingle(),
        supabase.from("evidence_requirements").select("label,status,category,gate,required").eq("job_id", jobId).eq("required", true),
      ]);
      return { a, ev: ev ?? [] };
    },
  });
}

function status(a: { external_mitti_id: string | null; mitti_sync_status: string; mitti_completed: boolean; mitti_last_error: string | null; mitti_synced_at: string | null; mitti_modified_at: string | null } | null) {
  if (!a?.external_mitti_id) return ["Not created", "neutral"] as const;
  if (a.mitti_sync_status === "error" || a.mitti_last_error) return ["Error", "bad"] as const;
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
  const evMissing = data.ev.filter((e) => (e.gate === "assessment" || (a?.piesa_outcome === "pass" && e.category === "piesa_signoff")) && !["uploaded", "verified"].includes(e.status));
  const piesaMissing = evMissing.find((e) => e.category === "piesa_signoff");
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); } finally { setBusy(false); } };
  return (
    <Section title="Mitti combined assessment" action={<Pill t={tone as never}>{label}</Pill>}>
      <dl className="grid grid-cols-2 gap-1 text-sm">
        <dt className="text-muted-foreground">Audit ID</dt><dd className="break-all">{a?.external_mitti_id ?? "—"}</dd>
        <dt className="text-muted-foreground">Assignee</dt><dd className="break-all">{a?.mitti_assignee_email ?? "—"}</dd>
        <dt className="text-muted-foreground">Last sync</dt><dd>{a?.mitti_synced_at ? new Date(a.mitti_synced_at).toLocaleString("en-AU") : a?.mitti_modified_at ? `partial (Mitti edited ${new Date(a.mitti_modified_at).toLocaleString("en-AU")})` : "—"}</dd>
        {isAdmin && a?.mitti_prefill_count != null && <><dt className="text-muted-foreground">Prefilled fields</dt><dd>{a.mitti_prefill_count}</dd></>}
      </dl>
      {a?.mitti_last_error && <p className="mt-2 rounded bg-destructive/10 px-2 py-1 text-sm text-danger">{a.mitti_last_error}</p>}
      {issues.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
      {a?.mitti_completed && !locked && (
        <div className="mt-3 rounded-md border border-warning bg-accent px-3 py-2 text-sm font-medium text-accent-foreground">
          Onsite assessment completed in Mitti. Next: {piesaMissing ? "Upload signed PIESA / electrical safety sign-off" : evMissing.length ? `Upload ${evMissing.map((e) => e.label).join(", ")}` : "Review and press Complete assessment"}.
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

/** Read-only view of Mitti-synced assessment fields (electrician doesn't enter them twice). */
export function MittiSyncedFields({ a: raw }: { a: Record<string, unknown> }) {
  const a = raw as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const f = (v: unknown) => (v === true ? "Yes" : v === false ? "No" : v == null || v === "" ? "—" : String(v));
  const rows: [string, unknown][] = [
    ["Measured area (m²)", a.measured_area_m2], ["Insulation present", a.insulation_present], ["Existing R-value", a.existing_r_value],
    ["Removal", a.removal_required ? `${a.removal_m2 ?? "?"} m²` : a.removal_required], ["Access", a.access_difficulty],
    ["Downlights", a.downlights_qty], ["Downlights to upgrade", a.downlights_upgrade_qty], ["Exhaust fans", a.exhaust_fans_qty], ["Need clearance", a.exhaust_fans_clearance_qty],
    ["Switchboard", a.switchboard_condition], ["RCDs present", a.rcds_present], ["RCDs to install", a.rcds_required_qty], ["Life support onsite", a.life_support_confirmed],
    ["PIESA outcome", a.piesa_outcome], ["Assessment date", a.assessed_on], ["Hazards", a.hazards], ["Notes", a.notes],
  ];
  return (
    <Section title="Assessment (from Mitti – read only)">
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
