// O5 Partners (approved, decisions 229/232/249): Applications · Approved · People · Rates · Coverage. "Who we work with."
// Every element carries data-why (decision 241). Approve / CII / notice / Mitti / rates / coverage writes all go through the
// existing guarded server functions. Removed per the office audit: Partners overview cards, Electrician team-ups.
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Btn, PageHeader, Pill, Segmented } from "@/components/portal/kit";
import { OfficeTabs, OfficeTable, Loading, LoadError, TabCaption, fmtDay, type OfficeTabDef } from "@/components/portal/office-tabs";
import { PeopleTable } from "@/components/portal/partner-people";
import { OfficeMittiInvites } from "@/components/portal/mitti-invites";
import { OnboardingDrafts } from "@/components/portal/onboarding-drafts";
import { CoverageDialog } from "@/components/portal/partner-coverage";
import { useAction } from "@/hooks/use-me";
import { useReasonDialog } from "@/components/portal/reason-dialog";
import { getPartnersBoard, resolvePartnerChangeRequest } from "@/lib/office-partners.functions";
import { reviewHigherRates } from "@/lib/rate-requests.functions";
import { runPartnerExpirySweep } from "@/lib/pilot.functions";

type Tab = "applications" | "approved" | "people" | "rates" | "coverage";
const TAB_KEYS: Tab[] = ["applications", "approved", "people", "rates", "coverage"];

export const Route = createFileRoute("/_authenticated/admin/partners")({
  // Legacy bookmark: /admin/partners?enquiry=<id> opens that application's review page.
  validateSearch: (s: Record<string, unknown>): { tab?: Tab; enquiry?: string | undefined } => ({
    ...(TAB_KEYS.includes(s["tab"] as Tab) && s["tab"] !== "applications" ? { tab: s["tab"] as Tab } : {}),
    ...(typeof s["enquiry"] === "string" ? { enquiry: s["enquiry"] } : {}),
  }),
  beforeLoad: ({ search }) => {
    if (search.enquiry) throw redirectToReview(search.enquiry);
  },
  head: () => ({ meta: [{ title: "Partners – Home Insulation Victoria" }, { name: "description", content: "Who we work with: applications, approved businesses, people, rates and coverage." }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Partners,
});

function redirectToReview(enquiryId: string) {
  return redirect({ to: "/admin/partners/application/$enquiryId", params: { enquiryId }, replace: true });
}

function Partners() {
  const { tab = "applications" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const load = useServerFn(getPartnersBoard);
  const q = useQuery({ queryKey: ["partners-board"], queryFn: () => load(), retry: 3, staleTime: 30_000 });
  const d = q.data;
  const tabs: OfficeTabDef<Tab>[] = [
    { key: "applications", label: "Applications", count: d?.applications.length ?? null, why: "application queue rule; 107 welcome on approval" },
    { key: "approved", label: "Approved", count: d?.approved.length ?? null, why: "audit §5 business file; 153 CII, 193 insurance re-check, 157 usual electrician" },
    { key: "people", label: "People", count: d?.people.length ?? null, why: "153 CII, 130 privacy notice, 22/188 Mitti invite per person" },
    { key: "rates", label: "Rates", count: d?.rates.length ?? null, why: "approved partner rates rule; 142 electrician rate card" },
    { key: "coverage", label: "Coverage", count: d?.coverage.length ?? null, why: "decision 229: Coverage kept; Choose installer filters by coverage" },
  ];
  return (
    <AppShell wide>
      <PageHeader title="Partners" sub="Who we work with." />
      <OfficeTabs wrapOnPhone label="Partners" tabs={tabs} value={tab} onChange={(t) => void navigate({ search: t === "applications" ? {} : { tab: t } })} />
      {q.error ? <LoadError what="Partners" error={q.error} retry={() => void q.refetch()} /> : !d ? <Loading what="partners" /> : <>
        {tab === "applications" && <Applications d={d} />}
        {tab === "approved" && <Approved d={d} />}
        {tab === "people" && <section data-why="153 CII, 130 privacy notice, 22/188 Mitti invite per person"><TabCaption>{d.people.length} people · a person without a verified CII or an acknowledged notice cannot be listed on an installation</TabCaption><OfficeMittiInvites /><PeopleTable phoneCards people={d.people} invalidate={["partners-board"]} /></section>}
        {tab === "rates" && <Rates d={d} />}
        {tab === "coverage" && <Coverage d={d} />}
      </>}
    </AppShell>
  );
}

type Board = Awaited<ReturnType<typeof getPartnersBoard>>;

function Applications({ d }: { d: Board }) {
  const [view, setView] = useState<"waiting" | "earlier" | "unfinished" | "tests">("waiting");
  const [kind, setKind] = useState<"installer" | "electrician_rec">("installer");
  const rows = view === "waiting" ? d.applications : view === "earlier" ? d.history : view === "tests" ? d.tests : [];
  return (
    <section data-why="application queue rule; 107 welcome on approval">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <TabCaption>{d.applications.length} waiting · approve → welcome email + guide, CII, privacy notice, Mitti invite</TabCaption>
        <Segmented label="Which applications" value={view} onChange={setView} options={[{ value: "waiting", label: "Waiting" }, { value: "earlier", label: "Approved / closed" }, { value: "unfinished", label: "Started, not finished" }, { value: "tests", label: "Test applications" }]} />
      </div>
      {view === "unfinished" ? (
        <div data-why="started-not-finished drafts kept for follow-up">
          <Segmented label="Partner type" value={kind} onChange={setKind} options={[{ value: "installer", label: "Installers" }, { value: "electrician_rec", label: "Electricians" }]} />
          <div className="mt-3"><OnboardingDrafts partnerType={kind} /></div>
        </div>
      ) : (
        <OfficeTable phoneCards why="one review queue; row opens the application review" isEmpty={!rows.length} empty="Nothing waiting." head={["Business", "Type", "Area", "What they sent", "Received", ""]}>
          {(view === "waiting" ? [["Pending approval · signed applications", rows.filter((r) => r.signed)], ["Website enquiries · no signed application yet", rows.filter((r) => !r.signed)]] as const : [["", rows]] as const).flatMap(([heading, list]) => [
            ...(heading && list.length ? [<tr key={heading}><td colSpan={6} className="bg-table-head text-xs font-semibold text-sub">{heading} ({list.length})</td></tr>] : []),
            ...list.map((r) => (
            <tr key={r.id}>
              <td className="font-semibold">{r.name}{view !== "waiting" && <span className="block text-xs font-normal capitalize text-sub">{r.status}</span>}</td>
              <td>{r.type}</td><td>{r.area}</td><td className="text-xs">{r.sent}</td><td>{fmtDay(r.received)}</td>
              <td><Link to="/admin/partners/application/$enquiryId" params={{ enquiryId: r.id }} className="text-sm font-semibold text-hiv-blue hover:underline" data-why="opens the application review (checks, ask / approve / decline)">Review</Link></td>
            </tr>
          ))])}
        </OfficeTable>
      )}
    </section>
  );
}

function Approved({ d }: { d: Board }) {
  const sweep = useAction(runPartnerExpirySweep);
  const installers = d.approved.filter((b) => b.kind === "Installer").length;
  return (
    <section data-why="audit §5 business file; 153 CII, 193 insurance re-check, 157 usual electrician">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <TabCaption>{d.approved.length} businesses · {installers} installer{installers === 1 ? "" : "s"}, {d.approved.length - installers} electrician{d.approved.length - installers === 1 ? "" : "s"}</TabCaption>
        <Btn tone="secondary" data-why="decision 193: PL insurance and licences re-checked" onClick={() => void sweep(undefined as never, "Expiry check complete")}>Check expiries</Btn>
      </div>
      <OfficeTable phoneCards why="approved businesses; row opens the business file" isEmpty={!d.approved.length} empty="No approved partners yet." head={["Business", "Area", "CII cleared", "PL insurance", "Usual electrician", "Taking new jobs"]}>
        {d.approved.map((b) => (
          <tr key={b.id}>
            <td><Link to="/admin/partners/business/$businessId" params={{ businessId: b.id }} data-partner-record-name className="font-semibold text-hiv-blue hover:underline">{b.name}</Link><span className="block text-xs text-sub">{b.kind}</span></td>
            <td>{b.area}</td>
            <td>{b.ciiCleared ?? "—"}</td>
            <td>{b.plExpires ? (b.plState === "valid" ? `to ${fmtDay(b.plExpires)}` : <Pill tone="rose">{b.plState === "expired" ? "expired" : "to"} {fmtDay(b.plExpires)}</Pill>) : <Pill tone="rose">Not on file</Pill>}</td>
            <td>{b.kind === "Electrician" ? "—" : b.usualElectrician ? <span data-partner-record-name>{b.usualElectrician}</span> : <span className="text-sub">HIV electrician</span>}</td>
            <td>{b.takingJobs ? <Pill tone="green">On</Pill> : <Pill>Paused by them</Pill>}</td>
          </tr>
        ))}
      </OfficeTable>
    </section>
  );
}

function Rates({ d }: { d: Board }) {
  const review = useAction(reviewHigherRates);
  const resolve = useAction(resolvePartnerChangeRequest);
  const reason = useReasonDialog();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["partners-board"] });
  return (
    <section data-why="approved partner rates rule; 142 electrician rate card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <TabCaption>Agreed rate cards · {d.changes.length} change request{d.changes.length === 1 ? "" : "s"} waiting</TabCaption>
        <Link to="/admin/electrician-rates" className="text-sm font-semibold text-hiv-blue hover:underline" data-why="decision 157: the electrician (PIESA) rate card is versioned there">Electrician rate cards ›</Link>
      </div>
      <OfficeTable phoneCards why="approved partner rates (installer price lists ex GST, electrician rates inc GST)" isEmpty={!d.rates.length && !d.changes.length} empty="No agreed rate cards yet." head={["Rate card", "Business", "What it says", "Effective", ""]}>
        {d.rates.map((r) => (
          <tr key={r.id}><td className="font-semibold">{r.card}</td><td><Link to="/admin/partners/business/$businessId" params={{ businessId: r.businessId }} className="text-hiv-blue hover:underline">{r.business}</Link></td><td className="text-xs">{r.says}</td><td>{fmtDay(r.effective)}</td><td /></tr>
        ))}
        {d.changes.map((c) => (
          <tr key={c.id} className="bg-mist/40">
            <td><Pill tone="amber">Change request</Pill></td><td>{c.business}</td><td className="text-xs">{c.says}</td><td className="text-xs">Asked {fmtDay(c.requestedAt)}</td>
            <td data-why="approved partner rates: changes apply only when the office approves (new rate card version)"><span className="flex gap-2">
              {c.source === "rates" ? <>
                <Btn onClick={async () => { if (await review({ requestId: c.id, approve: true }, "Rates approved — new rate card version")) await refresh(); }}>Approve</Btn>
                <Btn tone="secondary" onClick={async () => { const note = await reason.ask({ title: "Decline this rate request?", placeholder: "Reason (shown to the installer)", minLength: 3 }); if (note && await review({ requestId: c.id, approve: false, note }, "Declined")) await refresh(); }}>Decline</Btn>
              </> : <>
                <Btn onClick={async () => { const note = await reason.ask({ title: "Mark this change done?", description: "Free-text requests are applied by hand (e.g. a new rate card); record what you did.", placeholder: "What was changed", minLength: 3 }); if (note && await resolve({ id: c.id, status: "done", note }, "Marked done")) await refresh(); }}>Mark done</Btn>
                <Btn tone="secondary" onClick={async () => { const note = await reason.ask({ title: "Decline this change?", placeholder: "Reason", minLength: 3 }); if (note && await resolve({ id: c.id, status: "declined", note }, "Declined")) await refresh(); }}>Decline</Btn>
              </>}
            </span></td>
          </tr>
        ))}
      </OfficeTable>
      {reason.dialog}
    </section>
  );
}

function Coverage({ d }: { d: Board }) {
  const [edit, setEdit] = useState<Board["coverage"][number] | null>(null);
  return (
    <section data-why="decision 229: Coverage kept; Choose installer filters by coverage">
      <TabCaption>Suburbs and postcodes each business takes · only verified postcodes are used when choosing a trade</TabCaption>
      <OfficeTable phoneCards why="decision 229" isEmpty={!d.coverage.length} empty="No approved partners yet." head={["Business", "Suburbs covered", "Postcodes", ""]}>
        {d.coverage.map((c) => (
          <tr key={c.id}>
            <td className="font-semibold">{c.name}{c.electrician && <span className="block text-xs font-normal text-sub">Electrician</span>}</td>
            <td className="text-xs">{c.suburbs}</td>
            <td>{c.postcodes}{!c.verifiedAt && c.postcodeList.length > 0 && <span className="block text-xs text-rose">Not verified yet</span>}</td>
            <td><Btn tone="secondary" onClick={() => setEdit(c)}>Edit</Btn></td>
          </tr>
        ))}
      </OfficeTable>
      {edit && <CoverageDialog row={edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

