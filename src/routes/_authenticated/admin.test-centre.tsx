import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock3, ExternalLink, FlaskConical, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/portal/AppShell";
import { JoTradiePanel } from "@/components/portal/jo-tradie-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTestEnquiry, getAdminPipeline, getXeroConnection } from "@/lib/portal.functions";
import { clearOnboardingStartBlock, issueOnboardingLink, listOnboardingLinks, listOnboardingStartBlocks, revokeOnboardingLink, runOnboardingUploadCleanup } from "@/lib/onboarding-links.functions";
import { QA_PERSONA_LABEL, qaAccessPath, type QaPersona } from "@/lib/qa-role-link.core";
import { archiveQaJourney, createTestTradeAccounts, issueQaPersonaLink, prepareQaJourneyAccess, simulateQaJourneyTime, simulateQaPayment } from "@/lib/test-accounts.functions";

export const Route = createFileRoute("/_authenticated/admin/test-centre")({
  head: () => ({ meta: [
    { title: "Test Centre – Home Insulation Victoria Operations" },
    { name: "description", content: "Create and manage isolated launch-test journeys." },
    { property: "og:title", content: "Test Centre – Home Insulation Victoria Operations" },
    { property: "og:description", content: "Create and manage isolated launch-test journeys." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: TestCentre,
});

const INITIAL = {
  full_name: "", email: "", phone: "", address_line: "", suburb: "", postcode: "",
  occupancy: "owner_occupied" as "owner_occupied" | "rental", area: "", life: false,
  property_type: "house" as "house" | "townhouse" | "unit",
  over_five_years: "yes" as "yes" | "no" | "unknown",
  previous_upgrade: "no" as "yes" | "no" | "unknown",
  existing_insulation: "unknown" as "none" | "some" | "unknown",
  assistance: "none" as "none" | "interpreter" | "contract_support" | "both",
  age_confirmed: true, contact_consent: true,
};

function TestCentre() {
  const load = useServerFn(getAdminPipeline);
  const archive = useServerFn(archiveQaJourney);
  const { data = [], error, isPending, refetch } = useQuery({ queryKey: ["pipeline"], queryFn: () => load(), retry: 3 });
  const jobs = data.filter((job) => job.source === "qa_test");
  const [deleting, setDeleting] = useState<string | null>(null);
  return (
    <AppShell wide>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b pb-5">
        <div><p className="text-xs font-bold uppercase text-primary">Launch testing</p><h1 className="mt-1 font-display text-3xl font-bold">Test Centre</h1><p className="mt-1 text-sm text-muted-foreground">Dummy journeys stay marked as test records and do not enter live intake automation.</p></div>
        <CreateTestJob onDone={() => void refetch()} />
      </div>
      <JoTradiePanel />
      <XeroConnectionCard />
      <div className="mb-5 rounded-md border border-workspace-sun-strong/40 bg-workspace-sun p-4 text-sm"><b>Safe testing is active.</b> Customer messages and external writes remain locked. Use separate role accounts for final permission testing.</div>
      {error ? <div role="alert" className="rounded-md border border-danger bg-danger-soft p-4 text-sm text-danger">Test records could not be loaded. Nothing has been deleted. <Button size="sm" variant="outline" className="ml-2" onClick={() => void refetch()}>Try again</Button></div>
        : isPending ? <p className="text-sm text-muted-foreground">Loading test journeys…</p>
        : jobs.length === 0 ? <div className="rounded-md border border-dashed p-10 text-center"><FlaskConical className="mx-auto mb-2 h-7 w-7 text-primary" /><p className="font-semibold">No dummy journeys yet</p><p className="text-sm text-muted-foreground">Create one here so it is isolated from live work from the start.</p></div>
        : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{jobs.map((job) => (
          <article key={job.id} className="rounded-md border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2"><div><div className="font-display text-lg font-bold">{job.job_number}</div><div className="text-sm text-muted-foreground">{job.property_address}</div></div><Badge variant="outline">TEST</Badge></div>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm"><dt className="text-muted-foreground">Owner</dt><dd>{job.owner_name}</dd><dt className="text-muted-foreground">Stage</dt><dd>{String(job.stage ?? "new enquiry").replaceAll("_", " ")}</dd><dt className="text-muted-foreground">Next action</dt><dd>{job.next_action ?? "Review test journey"}</dd></dl>
            <div className="mt-4 border-t pt-3"><div className="flex flex-wrap gap-2"><Button asChild size="sm"><Link to="/admin/jobs/$jobId" params={{ jobId: job.id! }}>Open journey</Link></Button><QaRoleControls jobId={job.id!} /><Button size="sm" variant="outline" disabled={deleting === job.id} onClick={async () => { if (!window.confirm("Archive this TEST journey and revoke its TEST access? Its audit history will be retained.")) return; setDeleting(job.id!); try { await archive({ data: { jobId: job.id! } }); toast.success("TEST journey archived and access revoked"); await refetch(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not archive TEST journey"); } finally { setDeleting(null); } }}><Trash2 className="h-4 w-4" />Archive</Button></div></div>
          </article>
        ))}</div>}
      <TestTradeAccounts />
      <OnboardingLinks />
      <OnboardingLimits />
    </AppShell>
  );
}

function QaRoleControls({ jobId }: { jobId: string }) {
  const prepare = useServerFn(prepareQaJourneyAccess);
  const issue = useServerFn(issueQaPersonaLink);
  const simulate = useServerFn(simulateQaJourneyTime);
  const simPay = useServerFn(simulateQaPayment);
  const runPay = async () => {
    setBusy("pay");
    try { await simPay({ data: { jobId, reason: "Office TEST run — payment simulated" } }); toast.success("TEST payment recorded. No money and no Xero."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not simulate payment"); }
    finally { setBusy(null); }
  };
  const [workerPath, setWorkerPath] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const ready = async () => {
    const result = await prepare({ data: { jobId } });
    setWorkerPath(result.workerPath);
    return result;
  };
  // Sign-in only (no prepare/provision). Step 1 makes a single-use link; step 2 is the admin's own click on a real
  // link, so pop-up blockers never interfere and noopener keeps each TEST tab's session separate.
  const [roleLink, setRoleLink] = useState<{ persona: QaPersona; href: string } | null>(null);
  const openAs = async (persona: QaPersona) => {
    setBusy(persona); setRoleLink(null);
    try { const link = await issue({ data: { jobId, persona } }); setRoleLink({ persona, href: qaAccessPath(link) }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not open TEST role"); }
    finally { setBusy(null); }
  };
  const runTime = async (simulation: "response_24h" | "response_48h" | "piesa_expired") => {
    setBusy(simulation);
    try { await simulate({ data: { jobId, simulation } }); toast.success("TEST time condition is ready"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not simulate this condition"); }
    finally { setBusy(null); }
  };
  return <Dialog><DialogTrigger asChild><Button size="sm" variant="outline"><Users className="h-4 w-4" />Test roles</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>TEST roles and time</DialogTitle></DialogHeader>
    <p className="text-sm text-muted-foreground">Each role opens in a new tab with a real, restricted TEST account. Your office tab stays signed in.</p>
    <div className="grid gap-2 sm:grid-cols-2">
      <Button variant="outline" disabled={!!busy} onClick={() => void openAs("owner")}><ExternalLink className="h-4 w-4" />Open as owner</Button>
      <Button variant="outline" disabled={!!busy} onClick={() => void openAs("installer_boss")}><ExternalLink className="h-4 w-4" />Open as installer boss</Button>
      <Button variant="outline" disabled={!!busy} onClick={() => void openAs("electrician")}><ExternalLink className="h-4 w-4" />Open as electrician</Button>
    </div>
    {roleLink && <div className="rounded-md border p-3 text-sm" data-qa-role-link><p className="mb-2">Single-use TEST sign-in ready for the {QA_PERSONA_LABEL[roleLink.persona]}.</p>
      <a href={roleLink.href} target="_blank" rel="noopener noreferrer" onClick={() => setTimeout(() => setRoleLink(null), 0)} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 font-semibold text-primary-foreground"><ExternalLink className="h-4 w-4" />Open TEST {QA_PERSONA_LABEL[roleLink.persona]} tab</a></div>}
    <div className="border-t pt-4"><p className="mb-1 text-sm font-semibold">Set up TEST worker access (changes TEST accounts)</p>
      <p className="mb-2 text-xs text-muted-foreground">Resets the TEST owner and worker passwords, re-adds TEST assignment, membership and certificate, and reissues worker access. TEST accounts only — not a sign-in.</p>
      <Button size="sm" variant="outline" disabled={!!busy} onClick={async () => { setBusy("worker"); try { await ready(); toast.success("TEST worker access set up — use the worker link below."); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not set up TEST worker"); } finally { setBusy(null); } }}>Reset and set up TEST worker access</Button></div>
    {workerPath && <a href={workerPath} target="_blank" rel="noopener noreferrer" className="block break-all rounded-md bg-muted p-2 text-xs underline">Open TEST worker tab</a>}
    <div className="border-t pt-4"><p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Clock3 className="h-4 w-4" />Simulate a deadline on this TEST job</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!!busy} onClick={() => void runTime("response_24h")}>No reply 24h</Button><Button size="sm" variant="outline" disabled={!!busy} onClick={() => void runTime("response_48h")}>No reply 48h</Button><Button size="sm" variant="outline" disabled={!!busy} onClick={() => void runTime("piesa_expired")}>PIESA expired</Button><Button size="sm" variant="outline" disabled={!!busy} onClick={() => void runPay()}>Simulate payment (TEST only)</Button></div></div>
  </DialogContent></Dialog>;
}

function CreateTestJob({ onDone }: { onDone: () => void }) {
  const create = useServerFn(createTestEnquiry);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(INITIAL);
  const field = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button><Plus className="h-4 w-4" />Create dummy journey</Button></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>Create isolated dummy journey</DialogTitle></DialogHeader>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { const result = await create({ data: { full_name: form.full_name, email: form.email, phone: form.phone || null, address_line: form.address_line, suburb: form.suburb || null, postcode: form.postcode || null, state: "VIC", occupancy: form.occupancy, estimated_area_m2: Number(form.area), area_unknown: false, life_support: form.life, life_support_status: form.life ? "yes" : "no", declared_property_type: form.property_type, declared_over_five_years: form.over_five_years, declared_previous_upgrade: form.previous_upgrade, assistance: form.assistance, age_confirmed: form.age_confirmed, contact_consent: form.contact_consent, contact_consent_version: form.contact_consent ? "website-v1" : null, contact_consented_at: form.contact_consent ? new Date().toISOString() : null, base44_answers: { insulation: form.existing_insulation, top_floor: "yes" } } }); toast.success(`${result.job_number} created as a test journey`); setForm(INITIAL); setOpen(false); onDone(); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create test journey"); } finally { setBusy(false); } }}>
        <p className="text-xs text-muted-foreground sm:col-span-2">These mirror the real online enquiry questions so Gate 1 behaves exactly as it would for a live customer.</p>
        <div><Label htmlFor="test-name">Owner name</Label><Input id="test-name" value={form.full_name} onChange={field("full_name")} required /></div>
        <div><Label htmlFor="test-email">Test email</Label><Input id="test-email" type="email" value={form.email} onChange={field("email")} required /></div>
        <div><Label htmlFor="test-phone">Phone</Label><Input id="test-phone" value={form.phone} onChange={field("phone")} /></div>
        <label className="text-sm"><span className="text-muted-foreground">Occupancy</span><select className="h-9 w-full rounded-md border bg-background px-2" value={form.occupancy} onChange={(event) => setForm({ ...form, occupancy: event.target.value as typeof form.occupancy })}><option value="owner_occupied">Owner-occupied</option><option value="rental">Rental</option></select></label>
        <div className="sm:col-span-2"><Label htmlFor="test-address">Street address</Label><Input id="test-address" value={form.address_line} onChange={field("address_line")} required /></div>
        <div><Label htmlFor="test-suburb">Suburb</Label><Input id="test-suburb" value={form.suburb} onChange={field("suburb")} required /></div>
        <div><Label htmlFor="test-postcode">Postcode</Label><Input id="test-postcode" value={form.postcode} onChange={field("postcode")} required /></div>
        <div><Label htmlFor="test-area">Estimated ceiling area m²</Label><Input id="test-area" type="number" min="1" max="5000" value={form.area} onChange={field("area")} required /></div>
        <label className="flex items-end gap-2 pb-2 text-sm"><Checkbox checked={form.life} onCheckedChange={(value) => setForm({ ...form, life: !!value })} />Life support at property</label>
        <label className="text-sm"><span className="text-muted-foreground">Property type</span><select className="h-9 w-full rounded-md border bg-background px-2" value={form.property_type} onChange={(event) => setForm({ ...form, property_type: event.target.value as typeof form.property_type })}><option value="house">House</option><option value="townhouse">Townhouse</option><option value="unit">Unit / apartment</option></select></label>
        <label className="text-sm"><span className="text-muted-foreground">Owned the property 5+ years?</span><select className="h-9 w-full rounded-md border bg-background px-2" value={form.over_five_years} onChange={(event) => setForm({ ...form, over_five_years: event.target.value as typeof form.over_five_years })}><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Not sure</option></select></label>
        <label className="text-sm"><span className="text-muted-foreground">Previous VEU upgrade?</span><select className="h-9 w-full rounded-md border bg-background px-2" value={form.previous_upgrade} onChange={(event) => setForm({ ...form, previous_upgrade: event.target.value as typeof form.previous_upgrade })}><option value="no">No</option><option value="yes">Yes</option><option value="unknown">Not sure</option></select></label>
        <label className="text-sm"><span className="text-muted-foreground">Existing ceiling insulation?</span><select className="h-9 w-full rounded-md border bg-background px-2" value={form.existing_insulation} onChange={(event) => setForm({ ...form, existing_insulation: event.target.value as typeof form.existing_insulation })}><option value="unknown">Not sure</option><option value="none">None</option><option value="some">Some insulation</option></select></label>
        <label className="text-sm"><span className="text-muted-foreground">Assistance needs</span><select className="h-9 w-full rounded-md border bg-background px-2" value={form.assistance} onChange={(event) => setForm({ ...form, assistance: event.target.value as typeof form.assistance })}><option value="none">None</option><option value="interpreter">Interpreter</option><option value="contract_support">Help understanding the paperwork</option><option value="both">Both</option></select></label>
        <label className="flex items-end gap-2 pb-2 text-sm"><Checkbox checked={form.age_confirmed} onCheckedChange={(value) => setForm({ ...form, age_confirmed: !!value })} />Owner is 18 or over</label>
        <label className="flex items-end gap-2 pb-2 text-sm"><Checkbox checked={form.contact_consent} onCheckedChange={(value) => setForm({ ...form, contact_consent: !!value })} />Owner consents to being contacted</label>
        <Button type="submit" className="sm:col-span-2" disabled={busy}>{busy ? "Creating…" : "Create test journey"}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
// Creates 3 fake installers and 3 fake electricians with different agreed rates, for running examples.
function TestTradeAccounts() {
  const create = useServerFn(createTestTradeAccounts);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ name: string; role: string; status: string }[] | null>(null);
  return (
    <section className="mt-8 rounded-md border bg-card p-4">
      <h2 className="font-display text-xl font-bold">Test trade accounts</h2>
      <p className="mt-1 text-sm text-muted-foreground">Three installers and three electricians, all clearly marked TEST, each with different agreed rates. Use them to run example jobs and check quotes. Safe to press again — existing accounts are skipped.</p>
      <Button className="mt-4" disabled={busy} onClick={async () => { setBusy(true); try { const r = await create({ data: {} }); setResults(r.results); toast.success("Test trade accounts ready"); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not create test accounts"); } finally { setBusy(false); } }}>
        {busy ? "Creating…" : "Create 6 test trade accounts"}
      </Button>
      {results && <ul className="mt-4 grid gap-1 text-sm sm:grid-cols-2">{results.map((r) => <li key={r.name} className="flex items-center justify-between rounded border px-3 py-2"><span>{r.name} <span className="text-muted-foreground">({r.role})</span></span><Badge variant="outline">{r.status}</Badge></li>)}</ul>}
    </section>
  );
}
// One-use staff links for onboarding tests or helping a blocked applicant. Shown once; expires in 24 hours.
function OnboardingLinks() {
  const issue = useServerFn(issueOnboardingLink);
  const revoke = useServerFn(revokeOnboardingLink);
  const list = useServerFn(listOnboardingLinks);
  const links = useQuery({ queryKey: ["onboarding-links"], queryFn: () => list() });
  const [trade, setTrade] = useState<"rec" | "installer">("rec");
  const [purpose, setPurpose] = useState<"qa_test" | "office_recovery">("qa_test");
  const [incomplete, setIncomplete] = useState(false);
  const [note, setNote] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="mt-8 rounded-md border bg-card p-4">
      <h2 className="font-display text-xl font-bold">Onboarding staff links</h2>
      <p className="mt-1 text-sm text-muted-foreground">A test link starts an application marked as a test. An office link lets a real applicant start after being blocked. Each link works once and expires in 24 hours.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><Label>Trade</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" value={trade} onChange={(e) => setTrade(e.target.value as "rec" | "installer")}><option value="rec">Electrician (REC)</option><option value="installer">Installer</option></select></div>
        <div><Label>Purpose</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm" value={purpose} onChange={(e) => setPurpose(e.target.value as "qa_test" | "office_recovery")}><option value="qa_test">Test application</option><option value="office_recovery">Office help for a real applicant</option></select></div>
        <div className="sm:col-span-2"><Label>Reason</Label><Input className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Launch QA run" /></div>
        {purpose === "qa_test" && <label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox checked={incomplete} onCheckedChange={(v) => setIncomplete(v === true)} />Allow signing with steps unfinished (services tick is still required)</label>}
      </div>
      <Button className="mt-4" disabled={busy || note.trim().length < 3} onClick={async () => {
        setBusy(true); setLink(null);
        try { const r = await issue({ data: { trade, purpose, allow_incomplete_sign: incomplete, note } }); setLink(window.location.origin + r.path); void links.refetch(); }
        catch (e) { toast.error(e instanceof Error ? e.message : "Could not create the link"); }
        finally { setBusy(false); }
      }}>Create one-use link</Button>
      {link && <div className="mt-3 rounded-md border border-dashed p-3 text-sm"><p className="font-semibold">Copy this now — it won't be shown again.</p><code className="mt-1 block break-all">{link}</code></div>}
      <h3 className="mt-6 text-sm font-semibold">Recent links</h3>
      {links.isError && <p className="mt-2 text-sm text-destructive">{links.error instanceof Error ? links.error.message : "Could not load links."}</p>}
      {links.data && links.data.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No links yet.</p>}
      {links.data && links.data.length > 0 && <ul className="mt-2 divide-y rounded-md border text-sm">
        {links.data.map((l) => <li key={l.id} className="flex flex-wrap items-center gap-2 p-2">
          <Badge variant="outline">{l.trade === "rec" ? "Electrician" : "Installer"}</Badge>
          <span>{l.purpose === "qa_test" ? "Test" : "Office help"}</span>
          <span className="text-muted-foreground">{l.note}</span>
          <span className="ml-auto text-muted-foreground">{l.state === "unused" ? `Unused · expires ${new Date(l.expires_at).toLocaleString("en-AU")}` : l.state === "used" ? "Used" : l.state === "revoked" ? "Revoked" : "Expired"}</span>
          {l.state === "unused" && <Button size="sm" variant="outline" onClick={async () => {
            try { await revoke({ data: { id: l.id } }); toast.success("Link revoked"); }
            catch (e) { toast.error(e instanceof Error ? e.message : "Could not revoke the link"); }
            finally { void links.refetch(); }
          }}>Revoke</Button>}
        </li>)}
      </ul>}
    </section>
  );
}

// Office-only: clear ONE sign-up limit (hashed key only) with a reason, and run upload cleanup on demand.
function OnboardingLimits() {
  const listBlocks = useServerFn(listOnboardingStartBlocks);
  const clear = useServerFn(clearOnboardingStartBlock);
  const cleanup = useServerFn(runOnboardingUploadCleanup);
  const blocks = useQuery({ queryKey: ["onboarding-start-blocks"], queryFn: () => listBlocks() });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [swept, setSwept] = useState<string | null>(null);
  return (
    <section className="mt-8 rounded-md border bg-card p-4">
      <h2 className="font-display text-xl font-bold">Onboarding sign-up limits</h2>
      <p className="mt-1 text-sm text-muted-foreground">Each row is one hashed browser or network record. Clearing needs a reason, is recorded with your name, and resets only that record for that trade.</p>
      {blocks.isError && <p className="mt-2 text-sm text-destructive">{blocks.error instanceof Error ? blocks.error.message : "Could not load limits."}</p>}
      {blocks.data && blocks.data.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No one is currently limited.</p>}
      {blocks.data && blocks.data.length > 0 && <ul className="mt-3 divide-y rounded-md border text-sm">
        {blocks.data.map((b) => { const id = `${b.key}:${b.trade}:${b.kind}`; const reason = reasons[id] ?? ""; return <li key={id} className="grid gap-2 p-3 sm:grid-cols-[1fr_16rem_auto] sm:items-center">
          <div><span className="font-mono">{b.key_label}</span> <Badge variant="outline">{b.trade === "rec" ? "Electrician" : "Installer"}</Badge> {b.blocked && <Badge variant="destructive">Blocked</Badge>}
            <p className="text-xs text-muted-foreground">{b.recent_15m} starts in 15 min · {b.recent_24h} in 24 h · {b.refused} refused · last {new Date(b.last_attempt).toLocaleString("en-AU")}</p></div>
          <Input aria-label={`Reason for clearing ${b.key_label}`} value={reason} onChange={(e) => setReasons({ ...reasons, [id]: e.target.value })} placeholder="Reason (required)" />
          <Button size="sm" variant="outline" disabled={busy === id || reason.trim().length < 3} onClick={async () => {
            setBusy(id);
            try { await clear({ data: { key: b.key, trade: b.trade, kind: b.kind, reason } }); toast.success("Limit cleared and recorded"); setReasons({ ...reasons, [id]: "" }); }
            catch (e) { toast.error(e instanceof Error ? e.message : "Could not clear the limit"); }
            finally { setBusy(null); void blocks.refetch(); }
          }}>Clear limit</Button>
        </li>; })}
      </ul>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" disabled={busy === "sweep"} onClick={async () => {
          setBusy("sweep");
          try { const r = await cleanup(); setSwept(`${r.files} unused upload${r.files === 1 ? "" : "s"} removed (${(r.bytes / 1024).toFixed(0)} KB).`); }
          catch (e) { toast.error(e instanceof Error ? e.message : "Cleanup failed"); }
          finally { setBusy(null); }
        }}>Remove unused insurance uploads now</Button>
        <span className="text-xs text-muted-foreground">{swept ?? "Uploads never accepted are removed automatically after 24 hours; accepted certificates are never touched."}</span>
      </div>
    </section>
  );
}

function XeroConnectionCard() {
  const load = useServerFn(getXeroConnection);
  const { data, isPending } = useQuery({ queryKey: ["xero-connection"], queryFn: () => load() });
  const demo = data?.orgs.find((o) => o.test);
  return (
    <div className="mb-5 rounded-md border bg-card p-4 text-sm">
      <b>Xero</b>{" "}
      {isPending ? "checking…" : !data?.connected ? "not connected" : demo
        ? <>Connected to: {demo.name} (test). Test jobs use this organisation only.</>
        : <>Demo Company not connected — test jobs cannot reach Xero yet. Real books are never used for tests.</>}
      {data?.orgs.length ? <p className="mt-1 text-muted-foreground">Organisations on this connection: {data.orgs.map((o) => o.name + (o.test ? " (test)" : "")).join(", ")}. Real jobs: Xero switched off.</p> : null}
      {data?.error ? <p className="mt-1 text-danger">{data.error}</p> : null}
    </div>
  );
}
