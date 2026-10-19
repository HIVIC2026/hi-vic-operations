import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Section } from "@/components/portal/panels";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAction, useMe } from "@/hooks/use-me";
import { useServerFn } from "@tanstack/react-start";
import {
  getAutomaticSaveSpotRules,
  previewAutomaticSaveSpotMatching,
  saveAutomaticSaveSpotRules,
} from "@/lib/save-spot-rules.functions";
import {
  CATEGORY_LABEL,
  ELIGIBILITY_OUTCOMES,
  ENQUIRY_DATE_LABEL,
  ENQUIRY_DATE_WINDOWS,
  FILTER_CATEGORIES,
  INSULATION_VALUES,
  SELECTABLE_JOB_STATUSES,
  defaultFilters,
  jobStatusLabel,
  type AutomaticRuleFilters,
  type FilterCategory,
} from "@/lib/save-spot-rules.core";

const TITLE = "Save My Spot — Automatic Sending Rules — Home Insulation Victoria Portal";
const DESC = "Office-only selection rules for automatic Save My Spot emails. Extra restrictions only: they never send an email and never switch sending on.";

/** Checks the sender applies later that this read-only preview deliberately does NOT model. */
const NOT_MODELLED = [
  "a secure estimate link exists",
  "a current preliminary price exists",
  "the spot is not already saved",
  "the whole-VEEC discount check passes",
  "the approved email template for this outcome",
  "the live provider is configured and accepts the send",
];

export const Route = createFileRoute("/_authenticated/admin/save-my-spot-rules")({
  head: () => ({ meta: [{ title: TITLE }, { name: "description", content: DESC }, { property: "og:title", content: TITLE }, { property: "og:description", content: DESC }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: SaveMySpotRulesPage,
});

const MANDATORY = [
  "Customer communications master switch (COM-04)",
  "Save My Spot secondary switch (COM-04)",
  "Owner contact consent, opt-out and suppression",
  "Duplicate prevention and once-per-home idempotency",
  "Uncertain-delivery protection (no automatic retry)",
  "Approved templates only",
  "Mandatory eligibility exclusions (the existing automatic route selector)",
  "Service-area coverage established from existing records (S102) — a Victorian VEU location, not installer availability",
  "Test-recipient boundary (S102)",
  "Sender permissions",
];

const VERDICT_LABEL: Record<string, string> = {
  eligible: "Matches selection rules — final sending checks pending",
  mandatory_excluded: "Matches filters, but excluded by a mandatory rule",
  needs_office_review: "Needs office review",
  rule_excluded: "Does not match the configured filters",
  records_unavailable: "Cannot be determined — mandatory records unavailable",
};

function SaveMySpotRulesPage() {
  const me = useMe();
  if (me.isLoading) return <AppShell><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!me.data?.roles.includes("admin")) return <AppShell><h1 className="text-2xl font-bold">Not available</h1><p className="text-sm text-muted-foreground">This page is for office staff only.</p></AppShell>;
  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-bold">Save My Spot — Automatic Sending Rules</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Choose which enquiries may receive an automatic Save My Spot email. Every rule below only narrows the existing automatic
        route. Turning selection on never sends an email by itself and never switches customer communications on.
      </p>
      <Rules />
      <Preview />
    </AppShell>
  );
}

function Rules() {
  const load = useServerFn(getAutomaticSaveSpotRules);
  const save = useAction(saveAutomaticSaveSpotRules);
  const q = useQuery({ queryKey: ["save-spot-auto-rules"], queryFn: () => load() });
  const [draft, setDraft] = useState<AutomaticRuleFilters | null>(null);
  const [enable, setEnable] = useState(false);
  const [postcodes, setPostcodes] = useState("");
  const [touched, setTouched] = useState(false);

  const loaded = q.data;
  const rules = draft ?? loaded?.rules ?? defaultFilters();
  const currentEnable = touched ? enable : (loaded?.enabled ?? false);
  const set = <K extends FilterCategory>(key: K, patch: Partial<AutomaticRuleFilters[K]>) => {
    setTouched(true);
    setDraft({ ...rules, [key]: { ...rules[key], ...patch } });
  };
  const toggleIn = <T extends string>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  const dirty = JSON.stringify(rules) !== JSON.stringify(loaded?.rules ?? defaultFilters()) || currentEnable !== (loaded?.enabled ?? false);

  if (q.isLoading) return <Section title="Automatic sending rules"><p role="status" className="text-sm text-muted-foreground">Loading the saved rules…</p></Section>;
  if (q.error || !loaded) return <Section title="Automatic sending rules"><p role="alert" className="text-sm text-destructive">{(q.error as Error | undefined)?.message ?? "The saved rules could not be loaded."}</p></Section>;

  return (
    <div className="space-y-4">
      <p role="status" className="rounded-md border p-3 text-sm font-semibold">Automatic first responses: {loaded.firstResponses.on ? "ON" : "OFF"} — {loaded.firstResponses.reason}</p>
      <Section title="Automatic selection">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Select enquiries automatically for Save My Spot emails</p>
            <p className="text-xs text-muted-foreground">
              {loaded.state === "ok" ? `Saved ${loaded.updatedAt ?? "—"}.` : "No rules are saved yet."} Automatic selection is
              {" "}<strong>{currentEnable ? "ON" : "OFF"}</strong>.
            </p>
          </div>
          <Switch checked={currentEnable} aria-label="Automatic Save My Spot selection" onCheckedChange={(v) => { setTouched(true); setEnable(!!v); }} />
        </div>
        <p className="mt-2 rounded bg-warning-soft px-2 py-1 text-xs text-warning">
          This switch is separate from the COM-04 switches and cannot start sending on its own. If customer communications or
          Save My Spot sending is off, or if these rules cannot be read, nothing is sent automatically.
        </p>
        {loaded.state !== "ok" && (
          <p role="alert" className="mt-2 rounded bg-danger-soft px-2 py-1 text-xs text-danger">
            {loaded.reason} Nothing is automatically sent until valid rules are saved.
          </p>
        )}
      </Section>

      <Section title="Filters">
        <p className="mb-3 text-xs text-muted-foreground">
          Each filter is optional. A job must match every filter you switch on. Inside one filter, any one of the ticked values is
          enough. Leave a filter off to ignore it.
        </p>
        <div className="space-y-3">
          <FilterCard
            category="eligibility"
            enabled={rules.eligibility.enabled}
            onToggle={(on) => set("eligibility", { enabled: on })}
            hint="Uses the eligibility result already recorded by the official Gate 1 check."
          >
            <div className="flex flex-wrap gap-3">
              {ELIGIBILITY_OUTCOMES.map((o) => (
                <label key={o} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={rules.eligibility.outcomes.includes(o)} onCheckedChange={() => set("eligibility", { outcomes: toggleIn(rules.eligibility.outcomes, o) })} />
                  {o.replace(/_/g, " ")}
                </label>
              ))}
            </div>
          </FilterCard>

          <FilterCard
            category="insulation"
            enabled={rules.insulation.enabled}
            onToggle={(on) => set("insulation", { enabled: on })}
            hint="Uses the owner's own answer to the existing-insulation question. It is never inferred."
          >
            <div className="flex flex-wrap gap-3">
              {INSULATION_VALUES.map((v) => (
                <label key={v} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={rules.insulation.values.includes(v)} onCheckedChange={() => set("insulation", { values: toggleIn(rules.insulation.values, v) })} />
                  {v === "none" ? "No insulation" : v === "present" ? "Insulation present" : "Unknown / not sure"}
                </label>
              ))}
            </div>
          </FilterCard>

          <FilterCard
            category="ceilingArea"
            enabled={rules.ceilingArea.enabled}
            onToggle={(on) => set("ceilingArea", { enabled: on })}
            hint="Uses the ceiling area already recorded on the enquiry. Leave both boxes empty to accept any recorded area."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Minimum m²<Input inputMode="decimal" value={rules.ceilingArea.minM2 ?? ""} onChange={(e) => set("ceilingArea", { minM2: e.target.value.trim() === "" ? null : Number(e.target.value) })} /></label>
              <label className="text-sm">Maximum m²<Input inputMode="decimal" value={rules.ceilingArea.maxM2 ?? ""} onChange={(e) => set("ceilingArea", { maxM2: e.target.value.trim() === "" ? null : Number(e.target.value) })} /></label>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <Checkbox checked={rules.ceilingArea.includeUnknownArea} onCheckedChange={(v) => set("ceilingArea", { includeUnknownArea: !!v })} />
              Also include enquiries with no recorded ceiling area
            </label>
          </FilterCard>

          <FilterCard
            category="postcode"
            enabled={rules.postcode.enabled}
            onToggle={(on) => set("postcode", { enabled: on, ...(on ? {} : { postcodes: [], rangeFrom: null, rangeTo: null }) })}
            hint="Matches the property postcode only. A postcode match never proves service coverage — the mandatory coverage check still runs, and even that only establishes a Victorian VEU location, not installer availability."
          >
            <div className="flex flex-wrap gap-3">
              {(["specific", "range"] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={rules.postcode.mode === mode} onCheckedChange={() => set("postcode", { mode, ...(mode === "specific" ? { rangeFrom: null, rangeTo: null } : { postcodes: [] }) })} />
                  {mode === "specific" ? "Specific postcodes" : "Postcode range"}
                </label>
              ))}
            </div>
            {rules.postcode.mode === "specific" ? (
              <label className="mt-2 block text-sm">
                Postcodes (comma separated)
                <Input value={postcodes} placeholder="3000, 3121" onChange={(e) => { setPostcodes(e.target.value); set("postcode", { postcodes: e.target.value.split(",").map((p) => p.trim()).filter(Boolean) }); }} />
              </label>
            ) : (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="text-sm">From<Input inputMode="numeric" value={rules.postcode.rangeFrom ?? ""} onChange={(e) => set("postcode", { rangeFrom: e.target.value.trim() || null })} /></label>
                <label className="text-sm">To<Input inputMode="numeric" value={rules.postcode.rangeTo ?? ""} onChange={(e) => set("postcode", { rangeTo: e.target.value.trim() || null })} /></label>
              </div>
            )}
          </FilterCard>

          <FilterCard category="jobStatus" enabled={rules.jobStatus.enabled} onToggle={(on) => set("jobStatus", { enabled: on })} hint="Only these existing enquiry stages can receive a first Save My Spot email. Cancelled, complete and on-hold jobs are always excluded.">
            <div className="flex flex-wrap gap-3">
              {SELECTABLE_JOB_STATUSES.map((st) => (
                <label key={st} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={rules.jobStatus.stages.includes(st)} onCheckedChange={() => set("jobStatus", { stages: toggleIn(rules.jobStatus.stages, st) })} />
                  {jobStatusLabel(st)}
                </label>
              ))}
            </div>
          </FilterCard>

          <FilterCard category="enquiryDate" enabled={rules.enquiryDate.enabled} onToggle={(on) => set("enquiryDate", { enabled: on })} hint="Uses the enquiry date already recorded on the job.">
            <div className="flex flex-wrap gap-3">
              {ENQUIRY_DATE_WINDOWS.map((w) => (
                <label key={w} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={rules.enquiryDate.window === w} onCheckedChange={() => set("enquiryDate", { window: w, fromDate: null, toDate: null })} />
                  {ENQUIRY_DATE_LABEL[w]}
                </label>
              ))}
            </div>
            {rules.enquiryDate.window === "custom" && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="text-sm">From<input type="date" value={rules.enquiryDate.fromDate ?? ""} onChange={(e) => set("enquiryDate", { fromDate: e.target.value || null })} /></label>
                <label className="text-sm">To<input type="date" value={rules.enquiryDate.toDate ?? ""} onChange={(e) => set("enquiryDate", { toDate: e.target.value || null })} /></label>
              </div>
            )}
          </FilterCard>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={!dirty}
            onClick={async () => {
              const out = await save({ rules, enabled: currentEnable, previousEnabled: loaded.enabled, previousActivatedAt: loaded.activatedAt }, "Automatic sending rules saved. No email was sent.");
              if (out) { setDraft(null); setTouched(false); setEnable(out.enabled); await q.refetch(); }
            }}
          >
            Save rules
          </Button>
          <Button variant="outline" disabled={!dirty} onClick={() => { setDraft(null); setTouched(false); setEnable(loaded.enabled); setPostcodes(""); }}>Discard changes</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Saving records who changed the rules, when, and what they were before. It never sends an email.</p>
      </Section>

      <Section title="Rules that always apply">
        <p className="mb-2 text-xs text-muted-foreground">These can never be switched off, removed or worked around by the filters above.</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {MANDATORY.map((m) => <li key={m}>{m}</li>)}
        </ul>
      </Section>
    </div>
  );
}

function FilterCard({ category, enabled, onToggle, hint, children }: { category: FilterCategory; enabled: boolean; onToggle: (on: boolean) => void; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox checked={enabled} onCheckedChange={(v) => onToggle(!!v)} />
        {CATEGORY_LABEL[category]}
      </label>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      {enabled && <div className="mt-2">{children}</div>}
    </div>
  );
}

function Preview() {
  const run = useServerFn(previewAutomaticSaveSpotMatching);
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["save-spot-auto-rules-preview", page], queryFn: () => run({ data: { page } }), enabled: false });
  const d = q.data;
  return (
    <div className="mt-4 space-y-4">
      <Section title="Preview matching customers">
        <p className="mb-3 text-xs text-muted-foreground">
          Read-only. It shows how the automatic route would <strong>select</strong> customers today.
          {" "}It is not a promise that an email is sent: the final sending checks run later, in the email sender.
          It never sends an email, never reserves a send, and never changes a job.
        </p>
        <Button variant="outline" onClick={() => void q.refetch()} disabled={q.isFetching}>{q.isFetching ? "Checking…" : "Preview matching customers"}</Button>
        {d && (
          <>
            {!d.automaticSelectionEnabled && <p className="mt-3 rounded bg-warning-soft px-2 py-1 text-xs text-warning">Automatic selection is OFF, so nothing is sent automatically even where the filters match.</p>}
            {d.recordsUnavailable && (
              <div role="alert" className="mt-3 rounded border border-danger/40 bg-danger-soft p-3 text-sm">
                <strong>The preview could not read the mandatory safety records.</strong>
                <p className="mt-1 text-xs">
                  No enquiry below can be confirmed as ready, and no enquiry is reported as excluded by a mandatory rule — the
                  records simply could not be read. Nothing was sent and nothing was changed. {d.recordsError}
                </p>
              </div>
            )}
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Match the filters" value={d.counts.matching} />
              <Stat label="Matches filters, but excluded by a mandatory rule" value={d.counts.mandatoryExcluded} />
              <Stat label="Needs office review" value={d.counts.needsOfficeReview} />
              <Stat label="Matches selection rules — final sending checks pending" value={d.counts.eligible} />
              <Stat label="Cannot be determined — records unavailable" value={d.counts.recordsUnavailable} />
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">Checked {d.scanned} recent decided enquiries. Active rules: {d.activeRules.join(" · ")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              How to read these totals: <strong>Match the filters</strong> is a subset of the {d.scanned} checked — it equals
              {" "}{d.counts.eligible} ready + {d.counts.mandatoryExcluded} mandatory exclusions + {d.counts.recordsUnavailable}{" "}
              undetermined. The remaining {d.counts.ruleExcluded} did not match the configured filters and{" "}
              {d.counts.needsOfficeReview} need office review because a required record is missing.
            </p>
            <details className="mt-2 rounded border p-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">What this preview does and does not cover</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Scope: the most recent {d.scanLimit} non-deleted enquiries that have an official eligibility decision. Older enquiries are not listed, and this is not a full history report.</li>
                <li>A postcode in the Victorian VEU location table establishes a covered VEU Victorian location for the rebate. It does <strong>not</strong> confirm installer availability for the home.</li>
                <li>Not modelled here (checked later, in the sender): {NOT_MODELLED.join("; ")}.</li>
              </ul>
            </details>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b text-xs text-muted-foreground">
                  <th className="py-1 pr-2">Job</th><th className="py-1 pr-2">Eligibility</th><th className="py-1 pr-2">Insulation</th>
                  <th className="py-1 pr-2">Postcode</th><th className="py-1 pr-2">Job status</th><th className="py-1 pr-2">Enquiry date</th><th className="py-1">Outcome</th>
                </tr></thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.jobId} className="border-b align-top">
                      <td className="py-1 pr-2 font-medium">{r.jobNumber ?? r.jobId.slice(0, 8)}</td>
                      <td className="py-1 pr-2">{r.eligibilityOutcome ?? "—"}</td>
                      <td className="py-1 pr-2">{r.insulation ?? "—"}</td>
                      <td className="py-1 pr-2">{r.postcode ?? "—"}</td>
                      <td className="py-1 pr-2">{r.stageLabel}</td>
                      <td className="py-1 pr-2">{r.enquiryDate ? r.enquiryDate.slice(0, 10) : "—"}</td>
                      <td className="py-1"><strong>{VERDICT_LABEL[r.verdict]}</strong><span className="block text-xs text-muted-foreground">{r.reason}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!d.rows.length && <p className="mt-2 text-sm text-muted-foreground">No decided enquiries to check.</p>}
            </div>
            {d.pages > 1 && (
              <div className="mt-3 flex items-center gap-2 text-sm">
                <Button variant="outline" size="sm" disabled={d.page <= 1} onClick={() => setPage(Math.max(1, d.page - 1))}>Previous</Button>
                <span className="text-muted-foreground">Page {d.page} of {d.pages}</span>
                <Button variant="outline" size="sm" disabled={d.page >= d.pages} onClick={() => setPage(d.page + 1)}>Next</Button>
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="font-display text-2xl font-bold">{value}</div>
      <div className="whitespace-normal text-xs text-muted-foreground">{label}</div>
    </div>
  );
}