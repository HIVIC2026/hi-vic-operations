import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StaffJobRow } from "../src/components/portal/StaffJobRow";
import { EligibilityGlance, RecordDisclosure, usePortalTargetNavigation, type RecordGroup } from "../src/components/portal/job-workspace";
import { IntakeSummary } from "../src/components/portal/intake";
import { PaymentsPanel } from "../src/components/portal/panels";
import { filterVisibleJobs } from "../src/lib/portal-presentation.core";
import { Checkbox } from "../src/components/ui/checkbox";
import { Button } from "../src/components/ui/button";
import "../src/styles.css";

type FixtureMode = "normal" | "deposit" | "consent";
const query = new URLSearchParams(location.search);
const mode = (query.get("mode") ?? "normal") as FixtureMode;
const job = (stage: string, overrides: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), job_number: "HV-QA-204", property_address: "18 Long Gumtree Crescent, Wattle Park VIC 3128", owner_name: "Alexandra Montgomery-Williams", owner_phone: "0412 345 678", owner_email: "alexandra@example.test", stage, eligibility_review_required: false, eligibility_outcome: "likely_eligible", next_action: null, hold_reason: null, life_support: false, stuck_reasons: [], comms_status: { label: "Messages off", tone: "neutral" }, last_activity_at: "2026-10-02T04:00:00Z", ...overrides }) as never;

function ListFixture() {
  const [phase, setPhase] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mobileOpen, setMobileOpen] = useState(true);
  const jobs = [job("eligibility_review", { id: "review", eligibility_review_required: true }), job("on_hold", { id: "hold", eligibility_review_required: true }), job("eligibility_review", { id: "ineligible", eligibility_outcome: "does_not_appear_eligible" }), job("installation_booked", { id: "install", property_address: "92 Example Road, North Melbourne VIC 3051" })] as any[];
  const shown = filterVisibleJobs(jobs, phase, (stage) => stage === "installation_booked" ? "delivery" : "intake");
  const all = shown.length > 0 && shown.every((item) => selected.has(item.id));
  return <main className="portal-theme min-h-screen bg-background p-4 sm:p-7"><div className="mx-auto max-w-6xl"><p className="text-xs font-bold uppercase text-primary">Home Insulation Victoria</p><h1 className="text-3xl font-bold">ENQUIRIES</h1><div className="mt-4 flex gap-2"><Button>In progress 4</Button><Button variant="outline">Needs review 2</Button><Button variant="outline">Exceptions 2</Button></div>
    <details data-testid="mobile-filters" className="group my-3 rounded-md border bg-card sm:hidden" open={mobileOpen} onToggle={(event) => setMobileOpen(event.currentTarget.open)}><summary className="cursor-pointer px-3 py-2 font-semibold">Search and filters</summary><FilterFields phase={phase} setPhase={setPhase} /></details>
    <div data-testid="desktop-filters" className="my-3 hidden rounded-md border bg-card sm:block"><FilterFields phase={phase} setPhase={setPhase} /></div>
    <label className="mb-3 flex items-center gap-2"><Checkbox checked={all} onCheckedChange={() => setSelected(all ? new Set() : new Set(shown.map((item) => item.id)))} />Select all shown</label>
    <ul aria-label="Records" className="divide-y overflow-hidden rounded-md border bg-card">{shown.map((item) => <StaffJobRow key={item.id} job={item} select={<Checkbox checked={selected.has(item.id)} />} />)}{shown.length === 0 && <li className="p-10 text-center text-sm text-muted-foreground">No records match this view or its filters.<Button variant="ghost" onClick={() => setPhase("all")}>Clear filters</Button></li>}</ul>
  </div></main>;
}

function FilterFields({ phase, setPhase }: { phase: string; setPhase: (phase: string) => void }) { return <div className="flex flex-wrap gap-2 p-3"><input aria-label="Search" className="h-9 min-w-48 flex-1 rounded-md border px-3" placeholder="Search job number, address or person" /><select aria-label="Phase" className="h-9 rounded-md border px-2" value={phase} onChange={(event) => setPhase(event.target.value)}><option value="all">All phases</option><option value="delivery">Delivery</option><option value="missing">No matching phase</option></select></div>; }

function DetailFixture() {
  const [open, setOpen] = useState<Set<RecordGroup>>(new Set(["enquiry"]));
  const ensureOpen = React.useCallback((group: RecordGroup) => setOpen((value) => new Set(value).add(group)), []);
  const navigate = usePortalTargetNavigation(ensureOpen);
  const toggle = (group: RecordGroup) => setOpen((value) => { const next = new Set(value); next.has(group) ? next.delete(group) : next.add(group); return next; });
  const [depositReady, setDepositReady] = useState(false);
  useEffect(() => { if (mode === "deposit") setTimeout(() => setDepositReady(true), 350); }, []);
  return <main className="portal-theme min-h-screen bg-background p-4 sm:p-7"><div className="mx-auto max-w-5xl"><p className="text-xs font-bold uppercase text-primary">Home Insulation Victoria · QA fixture</p><h1 className="text-2xl font-bold">18 Long Gumtree Crescent, Wattle Park VIC 3128</h1><div className="my-3 rounded-md border bg-success-soft p-3"><b>Next action</b><p>Record the deposit request after it is raised in Xero.</p><Button onClick={() => navigate("deposit-request")}>Record deposit request</Button></div>
    <EligibilityGlance jobId="qa-job" onOpen={navigate} />
    <h2 className="mb-1 text-sm font-bold">Job records</h2><div className="rounded-md border bg-card">
      <RecordDisclosure id="enquiry" title="Enquiry" summary="Gate 1 evidence, estimate, eligibility decision, intake and consent" open={open.has("enquiry")} onToggle={() => toggle("enquiry")}><div id="panel-intake-consent"><IntakeSummary jobId="qa-job" /></div></RecordDisclosure>
      <RecordDisclosure id="ready_check" title="Ready Check" open={open.has("ready_check")} onToggle={() => toggle("ready_check")}><input aria-label="Draft note" defaultValue="Keep this draft" className="h-9 rounded-md border px-3" /></RecordDisclosure>
      <RecordDisclosure id="quote" title="Quote" summary="Quotes, invoice & deposit, electronic signing" open={open.has("quote")} onToggle={() => toggle("quote")}><div id="panel-deposit-request">{depositReady || mode !== "deposit" ? <PaymentsPanel jobId="qa-job" isAdmin /> : <p role="status">Loading payment records…</p>}</div></RecordDisclosure>
      {(["piesa", "installation", "ap_veec", "history"] as RecordGroup[]).map((group) => <RecordDisclosure key={group} id={group} title={group === "ap_veec" ? "AP review & VEECs" : group === "history" ? "Correspondence & history" : group[0]!.toUpperCase() + group.slice(1)} open={open.has(group)} onToggle={() => toggle(group)}><p>QA-only record content.</p></RecordDisclosure>)}
    </div></div></main>;
}

createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{query.get("page") === "list" ? <ListFixture /> : <DetailFixture />}</QueryClientProvider>);