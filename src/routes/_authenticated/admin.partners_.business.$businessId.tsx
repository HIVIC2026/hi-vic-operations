// O5b business file (approved, decisions 232/249): agreement, rates + change requests, insurance & licences (+ upload),
// people, usual electrician, masked bank details with a LOGGED reveal, jobs, coverage (edit) and documents.
// Writes reuse the existing guarded functions (verifyCredential/addCredential, reviewHigherRates, setPartnerRelationship,
// saveBusiness for coverage, officeVerifyEec / notice link / Mitti check for people).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/portal/AppShell";
import { Btn, Panel, Pill } from "@/components/portal/kit";
import { Loading, LoadError, fmtDay } from "@/components/portal/office-tabs";
import { PeopleTable } from "@/components/portal/partner-people";
import { CoverageDialog } from "@/components/portal/partner-coverage";
import { Credentials, Electricians } from "@/components/portal/business";
import { openFileViewer } from "@/components/portal/file-viewer";
import { useReasonDialog } from "@/components/portal/reason-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAction } from "@/hooks/use-me";
import { getBusinessFile, resolvePartnerChangeRequest, revealPartnerBank } from "@/lib/office-partners.functions";
import { getPartnerProfile, partnerFileUrl, saveBusiness } from "@/lib/pilot.functions";
import { reviewHigherRates } from "@/lib/rate-requests.functions";
import { inHouseEnableBlockers, type InHouseFacts } from "@/lib/in-house.core";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export const Route = createFileRoute("/_authenticated/admin/partners_/business/$businessId")({
  head: () => ({ meta: [{ title: "Business file – Home Insulation Victoria" }, { name: "description", content: "Office partner business details, approved rates and in-house configuration." }, { property: "og:title", content: "Business file – Home Insulation Victoria" }, { property: "og:description", content: "Office partner business details, approved rates and in-house configuration." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: BusinessFile,
});

function Row({ k, children }: { k: string; children: ReactNode }) {
  return <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-t border-line py-2 text-sm first:border-t-0"><dt className="text-sub">{k}</dt><dd className="min-w-0 break-words">{children}</dd></div>;
}

function BusinessFile() {
  const { businessId } = Route.useParams();
  const load = useServerFn(getBusinessFile);
  const loadProfile = useServerFn(getPartnerProfile);
  const q = useQuery({ queryKey: ["business-file", businessId], queryFn: () => load({ data: { businessId } }), retry: 3 });
  const p = useQuery({ queryKey: ["partner-profile", businessId], queryFn: () => loadProfile({ data: { businessId } }) });
  const qc = useQueryClient();
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ["business-file", businessId] }); await p.refetch(); };
  const [coverage, setCoverage] = useState(false);
  const [agreementOpen, setAgreementOpen] = useState(false);
  if (q.error) return <AppShell wide><LoadError what="The business file" error={q.error} retry={() => void q.refetch()} /></AppShell>;
  if (q.isPending) return <AppShell wide><Loading what="the business file" /></AppShell>;
  const f = q.data;
  if (!f) return <AppShell wide><p className="text-sm text-sub">This business wasn't found.</p></AppShell>;
  const b = f.business;
  const latest = f.agreements[0] ?? null;
  const acknowledged = f.notices.filter((n) => n.state === "acknowledged").length;
  return (
    <AppShell wide>
      <Link to="/admin/partners" search={{ tab: "approved" }} className="mb-3 inline-block text-sm font-semibold text-hiv-blue hover:underline">‹ Partners · Approved</Link>
      <section className="mb-5 rounded-[19px] border border-mist-line bg-mist p-[23px]" data-why="business file header: who, status, how to reach them">
        <div className="flex flex-wrap gap-2"><Pill>{b.kind}</Pill><Pill tone={b.takingJobs ? "green" : "plain"}>Taking new jobs · {b.takingJobs ? "On" : "Paused by them"}</Pill>{b.status !== "approved" && <Pill tone="rose">{b.status.replace(/_/g, " ")}</Pill>}</div>
        <h1 className="mt-2 font-display text-[28px] font-extrabold text-ink">{b.name}</h1>
        <p className="text-sm text-sub">{b.legalName} · {b.area}{b.approvedAt ? ` · approved since ${fmtDay(b.approvedAt)}` : ""}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-ink">{b.owner.name ?? "Business contact"}{b.owner.phone ? ` · ${b.owner.phone}` : ""}</span>
          {b.owner.phone && <a className="font-semibold text-hiv-blue hover:underline" href={`tel:${b.owner.phone.replace(/\s/g, "")}`}>Call</a>}
          {b.owner.phone && <a className="font-semibold text-hiv-blue hover:underline" href={`sms:${b.owner.phone.replace(/\s/g, "")}`}>Text</a>}
          {b.owner.email && <a className="font-semibold text-hiv-blue hover:underline" href={`mailto:${b.owner.email}`}>Email {b.owner.email}</a>}
        </div>
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Agreement" action={latest ? <Btn tone="secondary" onClick={() => setAgreementOpen(true)}>View agreement</Btn> : undefined}>
          <dl data-why="installer agreement rule; 121 ESC collection notice">
            {latest ? <>
              <Row k="Version">{b.kind === "Installer" ? "Installer" : "Electrician"} agreement {latest.version}</Row>
              <Row k="Signed">{latest.signer_name} · {new Date(latest.signed_at).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })}</Row>
              {f.agreements.length > 1 && <Row k="Earlier">{f.agreements.slice(1).map((a) => `${a.version} signed ${fmtDay(a.signed_at)}`).join(" · ")} · kept in Documents</Row>}
            </> : <Row k="Agreement"><span className="text-rose">No signed agreement on file</span></Row>}
            {b.kind === "Installer" && <Row k="ESC notice">{f.notices.length ? `${acknowledged} of ${f.notices.length} people acknowledged the scheme-participant collection notice` : "No installers listed"}</Row>}
          </dl>
        </Panel>
        <RatesPanel f={f} onDone={refresh} />
        {p.data?.myRole === "hivic_admin" && p.data.inHouseFacts && <InHousePanel key={JSON.stringify(p.data.business)} businessId={businessId} business={p.data.business as unknown as { name: string; in_house?: boolean; rectification_billed_by?: "partner" | "hivic" }} facts={p.data.inHouseFacts} onDone={refresh} />}
        <Panel title="Insurance & licences">
          <dl data-why="193 PL insurance re-checked yearly; ESC scheme participant requirement">
            {f.credentials.filter((c) => ["public_liability_insurance", "workers_comp_insurance", "electrical_licence", "rec_registration", "installer_certification"].includes(c.kind)).map((c) => (
              <Row key={c.id} k={c.label}>{[c.issuer, c.number, c.expires_at && `to ${fmtDay(c.expires_at)}`].filter(Boolean).join(" · ")} {c.state === "expired" ? <Pill tone="rose">Expired</Pill> : c.state === "expiring" ? <Pill tone="amber">Expiring soon</Pill> : null} <span className="text-xs text-sub">· {c.verification}{c.document_path ? " · certificate on file" : ""}</span></Row>
            ))}
            <Row k="ABN">{b.abn ?? "—"}</Row>
            <Row k="Licences">{b.kind === "Electrician" ? `REC ${b.rec ?? "—"}${b.licence ? ` · licence ${b.licence}` : ""}` : "No electrical work · usual electrician holds the REC"}</Row>
          </dl>
          {p.data && <details className="mt-3" id="upload"><summary className="cursor-pointer text-sm font-semibold text-hiv-blue">Upload a new certificate › / verify</summary><div className="mt-2"><Credentials businessId={businessId} creds={p.data.credentials as never} isHivicAdmin canAdd onDone={() => void refresh()} /></div></details>}
        </Panel>
        <Panel className="lg:col-span-2" title={`People · ${f.people.length}`}><div data-why="153 CII, 130 privacy notice, 22/188 Mitti"><PeopleTable people={f.people} showBusiness={false} invalidate={["business-file"]} /></div></Panel>
        {f.canBeUsualElectrician && <Panel title="Usual electrician" action={f.usual ? <Link to="/admin/partners/business/$businessId" params={{ businessId: f.usual.id }} className="text-sm font-semibold text-hiv-blue hover:underline">Open {f.usual.name} ›</Link> : undefined}>
          <dl data-why="289/374: the usual electrician is an option on the installer's own customers (A1); on our leads we always choose the electrician">
            {f.usual ? <>
              <Row k="Business">{f.usual.name} · {f.usual.approved ? "approved REC" : <Pill tone="rose">not approved yet</Pill>}</Row>
              <Row k="REC">{f.usual.rec ?? "—"}</Row>
              <Row k="PIESA rate">{f.usual.piesaRate != null ? `$${f.usual.piesaRate} agreed · fixes by item (owner pays fixes + $100)` : "Rate to agree"}</Row>
              <Row k="Used on">{f.usual.usedThisMonth} of {f.usual.jobsThisMonth} jobs this month</Row>
            </> : <Row k="Usual electrician">None named · HIV electrician does the PIESAs</Row>}
          </dl>
          {p.data && <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-hiv-blue">Change usual electrician</summary><div className="mt-2"><Electricians businessId={businessId} rels={p.data.relationships as never} options={(p.data.electricianBusinesses as { id: string; name: string; onboarding_status: string }[]).filter((e) => e.id !== businessId)} canEdit onDone={() => void refresh()} /></div></details>}
        </Panel>}
        <BankPanel businessId={businessId} f={f} />
        <Panel title="Jobs" action={<Link to="/admin/jobs/active" search={{ q: b.name } as never} className="text-sm font-semibold text-hiv-blue hover:underline">Open Jobs ›</Link>}>
          <dl data-why="daily office action: see this partner's work">
            <Row k="This month">{f.jobs.thisMonth} jobs · {f.jobs.installsThisMonth} installs done</Row>
            <Row k="All time">{f.jobs.all} jobs · {f.jobs.complete} complete · {f.jobs.cancelled} cancelled · {f.jobs.active} active</Row>
            {b.kind === "Installer" && <Row k="Own jobs">{f.jobs.ownActive} active installer's own jobs</Row>}
          </dl>
        </Panel>
        <Panel title="Coverage" action={<Btn tone="secondary" onClick={() => setCoverage(true)}>Edit</Btn>}>
          <dl data-why="49 choose installer by area; decision 229">
            <Row k="Areas">{b.coverage.regions.join(", ") || "—"}</Row>
            <Row k="Postcodes">{b.coverage.summary}{!b.coverage.verifiedAt && b.coverage.postcodes.length > 0 ? <span className="block text-xs text-rose">Not verified yet</span> : null}</Row>
            {(b.coverage.origin || b.coverage.radiusKm) && <Row k="Radius">{b.coverage.radiusKm ? `Up to ${b.coverage.radiusKm} km` : ""}{b.coverage.origin ? ` from ${b.coverage.origin}` : ""}</Row>}
          </dl>
        </Panel>
        <DocumentsPanel businessId={businessId} f={f} />
      </div>
      {coverage && <CoverageDialog row={{ id: businessId, name: b.name, rawName: (p.data?.business as { name?: string } | undefined)?.name ?? b.legalName, regions: b.coverage.regions, postcodeList: b.coverage.postcodes }} onClose={() => setCoverage(false)} />}
      {agreementOpen && latest && <Dialog open onOpenChange={(o) => !o && setAgreementOpen(false)}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Agreement {latest.version} · signed by {latest.signer_name}</DialogTitle></DialogHeader><p className="break-all text-xs text-sub">Fingerprint SHA-256 {latest.snapshot_sha256}</p><pre className="whitespace-pre-wrap text-xs">{latest.body}</pre></DialogContent></Dialog>}
    </AppShell>
  );
}

type FileData = NonNullable<Awaited<ReturnType<typeof getBusinessFile>>>;

function InHousePanel({ businessId, business, facts, onDone }: { businessId: string; business: { name: string; in_house?: boolean; rectification_billed_by?: "partner" | "hivic" }; facts: InHouseFacts; onDone: () => Promise<void> }) {
  const save = useServerFn(saveBusiness);
  const [enabled, setEnabled] = useState(business.in_house ?? false);
  const [billing, setBilling] = useState<"partner" | "hivic">(business.rectification_billed_by ?? "hivic");
  const [busy, setBusy] = useState(false);
  const blockers = inHouseEnableBlockers(facts);
  return <Panel title="In-house partner">
    <label className="flex items-center justify-between gap-3 text-sm font-semibold">In-house partner<Switch checked={enabled} onCheckedChange={setEnabled} disabled={busy || (!enabled && blockers.length > 0)} aria-label="In-house partner" /></label>
    {blockers.length > 0 && <ul className="mt-3 text-sm text-rose">{blockers.map(b => <li key={b}>{b}</li>)}</ul>}
    <RadioGroup className="my-4" value={billing} onValueChange={v => { if (v === "partner" || v === "hivic") setBilling(v); }} disabled={busy} aria-label="Rectification billing">
      <label className="flex items-center gap-3 text-sm"><RadioGroupItem value="partner" />Partner's electrician bills the owner</label>
      <label className="flex items-center gap-3 text-sm"><RadioGroupItem value="hivic" />HIV bills the owner</label>
    </RadioGroup>
    <Btn disabled={busy || (enabled === (business.in_house ?? false) && billing === (business.rectification_billed_by ?? "hivic"))} onClick={async () => {
      setBusy(true);
      try { await save({ data: { id: businessId, name: business.name, in_house: enabled, rectification_billed_by: billing } }); await onDone(); toast.success("In-house partner saved"); }
      catch (e) { toast.error(e instanceof Error ? e.message : "Could not save in-house partner"); }
      finally { setBusy(false); }
    }}>Save</Btn>
  </Panel>;
}

function RatesPanel({ f, onDone }: { f: FileData; onDone: () => Promise<void> }) {
  const review = useAction(reviewHigherRates);
  const resolve = useAction(resolvePartnerChangeRequest);
  const reason = useReasonDialog();
  return (
    <Panel title="Rates">
      <dl data-why="approved partner rates; change requests approved by office">
        {f.rates ? f.rates.items.map((i) => <Row key={i.code} k={i.description}>${Number(i.unit_price_ex_gst).toFixed(2)}{i.unit === "m2" ? "/m²" : ""} ex GST <span className="text-xs text-sub">· from {fmtDay(f.rates!.effective)}</span></Row>)
          : f.electricianRates.length ? f.electricianRates.map((r) => <Row key={r.service_type} k={r.service_type === "piesa" ? "PIESA" : r.service_type.replace(/_/g, " ")}>${Number(r.rate_inc_gst).toFixed(2)} inc GST <span className="text-xs text-sub">· from {fmtDay(r.effective_from)}</span></Row>)
          : <Row k="Rates">No agreed rate card yet</Row>}
        {f.changes.map((c) => (
          <Row key={c.id} k="Change request"><span className="block">{c.says} <span className="text-xs text-sub">· asked {fmtDay(c.at)}</span></span>
            <span className="mt-1 flex gap-2">{c.source === "rates"
              ? <><Btn onClick={async () => { if (await review({ requestId: c.id, approve: true }, "Rates approved — new rate card version")) await onDone(); }}>Approve</Btn><Btn tone="secondary" onClick={async () => { const note = await reason.ask({ title: "Decline this rate request?", placeholder: "Reason (shown to the installer)", minLength: 3 }); if (note && await review({ requestId: c.id, approve: false, note }, "Declined")) await onDone(); }}>Decline</Btn></>
              : <><Btn onClick={async () => { const note = await reason.ask({ title: "Mark this change done?", description: "Free-text requests are applied by hand; record what you did.", placeholder: "What was changed", minLength: 3 }); if (note && await resolve({ id: c.id, status: "done", note }, "Marked done")) await onDone(); }}>Mark done</Btn><Btn tone="secondary" onClick={async () => { const note = await reason.ask({ title: "Decline this change?", placeholder: "Reason", minLength: 3 }); if (note && await resolve({ id: c.id, status: "declined", note }, "Declined")) await onDone(); }}>Decline</Btn></>}
            </span></Row>
        ))}
        {f.earlierCards > 0 && <Row k="History">{f.earlierCards} earlier rate card{f.earlierCards === 1 ? "" : "s"} kept</Row>}
      </dl>
      {reason.dialog}
    </Panel>
  );
}

function BankPanel({ businessId, f }: { businessId: string; f: FileData }) {
  const reveal = useServerFn(revealPartnerBank);
  const [full, setFull] = useState<{ accountName: string; bsb: string; account: string } | null>(null);
  const m = f.bank.masked;
  return (
    <Panel title="Bank details" action={m && !full ? <Btn tone="secondary" data-why="full details only behind a logged reveal" onClick={async () => { try { const r = await reveal({ data: { businessId } }); setFull(r); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't show the details"); } }}>Show full details (logged)</Btn> : undefined}>
      <dl data-why="payout rule 30/109; Xero supplier">
        {m ? <>
          <Row k="Account name">{full?.accountName ?? m.accountName}</Row>
          <Row k="BSB · account">{full ? `${full.bsb} · ${full.account}` : `${m.bsb} · ${m.account}`}</Row>
          <Row k="Changed">{f.bank.changedAt ? fmtDay(f.bank.changedAt) : "—"}{f.bank.changedHow ? ` · ${f.bank.changedHow}` : ""}{f.bank.review ? ` · ${f.bank.review}` : ""}</Row>
        </> : <Row k="Bank">Not given yet (collected after approval on My business)</Row>}
        <Row k="Xero supplier">{f.business.xero.status === "synced" ? "Linked" : f.business.xero.status ? f.business.xero.status.replace(/_/g, " ") : "Not set up"}{f.business.xero.error ? <span className="block text-xs text-rose">{f.business.xero.error}</span> : null}</Row>
      </dl>
    </Panel>
  );
}

function DocumentsPanel({ businessId, f }: { businessId: string; f: FileData }) {
  const open = useServerFn(partnerFileUrl);
  const docs = f.credentials.filter((c) => c.document_path);
  return (
    <Panel title={`Documents · ${docs.length + f.agreements.length}`} action={<a href="#upload" className="text-sm font-semibold text-hiv-blue hover:underline">Upload a document ›</a>}>
      <ul className="divide-y divide-line text-sm" data-why="6-year record">
        {f.agreements.map((a) => <li key={a.id} className="py-2">{a.version.startsWith("v") ? "" : "Agreement "}{a.version} · signed<span className="block text-xs text-sub">{fmtDay(a.signed_at)} · signed record</span></li>)}
        {docs.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0">{c.label}<span className="block text-xs text-sub">{fmtDay(c.created_at)}{c.expires_at ? ` · to ${fmtDay(c.expires_at)}` : ""}</span></span>
            <Btn tone="secondary" onClick={async () => { try { const r = await open({ data: { businessId, path: c.document_path! } }); openFileViewer(r.url); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't open"); } }}>View</Btn>
          </li>
        ))}
        {!docs.length && !f.agreements.length && <li className="py-2 text-sub">No documents yet.</li>}
      </ul>
    </Panel>
  );
}
