// O5 application review (approved, decisions 232/249): checks list, then ONE of Ask for the missing items / Approve
// (anyway) / Decline. Approval runs through the existing activatePartnerApplication (CII mandatory, insurance override
// needs a reason, rate offers respected); ask/decline through decidePartnerApplication (emails the applicant).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { Btn, Panel, Pill } from "@/components/portal/kit";
import { Loading, LoadError, fmtDay } from "@/components/portal/office-tabs";
import { ApplicationDetail, ApprovePartner, OfficeEmailBox, ReviewDecision, SignedRecAgreement } from "@/components/portal/partner-application";
import { PartnerProfileCard } from "@/components/portal/partner-profile-card";
import { useAction } from "@/hooks/use-me";
import { getAdminPartnerEnquiries } from "@/lib/admin-records.functions";
import { getRecOnboardingRecord } from "@/lib/rec-onboarding-admin.functions";
import { decidePartnerApplication, getApplicationReview, getApprovalChecklist, listWorkerCertifications } from "@/lib/partner-activation.functions";
import { applicationChecks, missingItemsMessage, type ApplicationCheck } from "@/lib/office-partners.core";
import { melbourneToday } from "@/lib/melbourne-time.core";

export const Route = createFileRoute("/_authenticated/admin/partners_/application/$enquiryId")({
  head: () => ({ meta: [{ title: "Application review – Home Insulation Victoria" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Review,
});

const MARK: Record<ApplicationCheck["mark"], { sign: string; cls: string }> = { ok: { sign: "✓", cls: "bg-mint text-hiv-green" }, warn: { sign: "!", cls: "bg-warning-soft text-foreground" }, missing: { sign: "✕", cls: "bg-pink text-rose" } };

function Review() {
  const { enquiryId } = Route.useParams();
  const loadAll = useServerFn(getAdminPartnerEnquiries);
  const q = useQuery({ queryKey: ["partner_enquiries"], queryFn: () => loadAll(), retry: 3, staleTime: 30_000 });
  const row = q.data?.find((r) => r.id === enquiryId) ?? null;
  const appId = (row?.raw_payload as { rec_onboarding_id?: string } | null)?.rec_onboarding_id ?? null;
  return (
    <AppShell wide>
      <Link to="/admin/partners" className="mb-3 inline-block text-sm font-semibold text-hiv-blue hover:underline">‹ Partners · Applications</Link>
      {q.error ? <LoadError what="The application" error={q.error} retry={() => void q.refetch()} /> : q.isPending ? <Loading what="the application" /> : !row ? <p className="rounded-[18px] border border-line bg-paper p-6 text-sm text-sub">This application wasn't found.</p>
        : appId ? <SignedApplication row={row} appId={appId} /> : (
          <div className="space-y-5">
            <Panel title={row.company || row.name || "Website enquiry"}><p className="mb-3 text-sm text-sub">Website enquiry · no signed application yet. Send them the {row.enquiry_type === "installer" ? "installer" : "electrician"} application form; it comes back here to approve.</p><ApplicationDetail row={row} /></Panel>
          </div>
        )}
    </AppShell>
  );
}

type Row = NonNullable<Awaited<ReturnType<typeof getAdminPartnerEnquiries>>>[number];

function SignedApplication({ row, appId }: { row: Row; appId: string }) {
  const rec = useServerFn(getRecOnboardingRecord);
  const check = useServerFn(getApprovalChecklist);
  const certs = useServerFn(listWorkerCertifications);
  const review = useServerFn(getApplicationReview);
  const r = useQuery({ queryKey: ["rec-onboarding", appId], queryFn: () => rec({ data: { id: appId } }) });
  const c = useQuery({ queryKey: ["approval-checklist", appId], queryFn: () => check({ data: { applicationId: appId } }) });
  const v = useQuery({ queryKey: ["worker-certs", appId], queryFn: () => certs({ data: { applicationId: appId } }) });
  const decided = useQuery({ queryKey: ["application-review", appId], queryFn: () => review({ data: { applicationId: appId } }) });
  const decide = useAction(decidePartnerApplication);
  const [mode, setMode] = useState<null | "ask" | "decline">(null);
  const [msg, setMsg] = useState("");
  if (r.error) return <LoadError what="The signed application" error={r.error} retry={() => void r.refetch()} />;
  if (!r.data || !c.data) return <Loading what="the signed application" />;
  const type = row.enquiry_type === "installer" ? "installer" as const : "rec" as const;
  const data = (r.data.data ?? {}) as Parameters<typeof applicationChecks>[0]["data"] & { installers?: { full_legal_name?: string; email?: string; cii_holds?: string | null; cii_level?: string | null; cii_expiry?: string }[]; legal_entity_name?: string; trading_name?: string; business_address?: string; primary_contact_name?: string; business_phone?: string; business_email?: string; r6_rate?: number | null; r7_rate?: number | null; batts_removal_rate?: number | null; service_origin?: string; travel_radius_km?: number | null; excluded_areas?: string; electrician_choice?: string | null };
  const verified = (v.data ?? []).filter((x) => x.status === "verified").map((x) => x.worker_email);
  const checks = applicationChecks({ type, data, signedAt: r.data.signed_at, signerName: r.data.signer_name, agreementVersion: r.data.agreement_version, hasCertificate: !!r.data.certificateUrl, verifiedCiiEmails: verified, today: melbourneToday() });
  const outstanding = checks.filter((x) => x.mark !== "ok");
  const activated = c.data.activated;
  const people = data.installers ?? [];
  const startAsk = () => { setMode("ask"); setMsg(missingItemsMessage(checks)); };
  return (
    <div className="space-y-5">
      <section className="rounded-[19px] border border-mist-line bg-mist p-[23px]" data-why="decision 232: one decision per application">
        <div className="flex flex-wrap items-center gap-2 text-xs text-sub"><Pill>{type === "installer" ? "Installer" : "Electrician"}</Pill>Received {fmtDay(row.source_created_at ?? row.created_at)}</div>
        <h1 className="mt-2 font-display text-[26px] font-extrabold text-ink">{data.legal_entity_name || row.company || row.name}</h1>
        <p className="text-sm text-sub">{type === "installer" ? "Installer" : "Electrician"} application{row.service_areas?.length ? ` · ${row.service_areas.slice(0, 2).join(", ")}` : ""}{people.length ? ` · ${people.length} worker${people.length === 1 ? "" : "s"}` : ""}</p>
        {activated ? <p className="mt-3 font-semibold text-hiv-green">Approved {c.data.activatedAt ? fmtDay(c.data.activatedAt) : ""}. Login, CII and welcome steps are below.</p>
          : decided.data ? <div className="mt-3"><ReviewDecision applicationId={appId} /></div>
          : <>
            <p className="mt-3 font-semibold text-ink">{outstanding.length ? `${outstanding.length} check${outstanding.length === 1 ? "" : "s"} outstanding` : "Every check is done"}</p>
            {outstanding.length > 0 && <p className="text-sm text-ink/85">{outstanding.map((x) => x.text).join(" · ")} — ask for them, or approve now and chase under People.</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {outstanding.length > 0 && <Btn data-why="decision 232: ask for the missing items (emails the applicant)" onClick={startAsk}>Ask for the missing items</Btn>}
              <Btn tone={outstanding.length ? "secondary" : "primary"} data-why="decision 232: approve; guards stay in activatePartnerApplication" onClick={() => document.getElementById("approve")?.scrollIntoView({ behavior: "smooth" })}>{outstanding.length ? "Approve anyway" : "Approve"}</Btn>
              <Btn tone="secondary" data-why="decision 232: decline with a reason" onClick={() => { setMode("decline"); setMsg(""); }}>Decline</Btn>
            </div>
            {mode && <div className="mt-4 space-y-2 rounded-[13px] border border-line bg-paper p-4">
              <label className="block text-xs font-semibold text-ink">{mode === "ask" ? "What should they send? (emailed to the applicant)" : "Reason (shown in the email; leave blank for none)"}
                <textarea className="mt-1 w-full rounded-[9px] border border-field-line bg-paper px-3 py-2 text-sm" rows={5} value={msg} onChange={(e) => setMsg(e.target.value)} /></label>
              <p className="text-xs text-sub">Emails {data.business_email ?? row.email ?? "the applicant"}. Replies go to info@homeinsulationvictoria.com.au. Test-run applications email Jo's test inbox only.</p>
              <div className="flex gap-2">
                <Btn disabled={mode === "ask" && msg.trim().length < 3} onClick={async () => { const res = await decide({ applicationId: appId, decision: mode === "ask" ? "changes_requested" : "declined", message: msg.trim() || null }, mode === "ask" ? "Asked for the missing items" : "Application declined"); if (res) { setMode(null); await decided.refetch(); } }}>{mode === "ask" ? "Send" : "Decline application"}</Btn>
                <Btn tone="secondary" onClick={() => setMode(null)}>Cancel</Btn>
              </div>
            </div>}
          </>}
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Business"><dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-sub">Name</dt><dd>{data.legal_entity_name ?? row.company}{data.abn ? ` · ABN ${data.abn}` : ""}</dd>
          <dt className="text-sub">Type</dt><dd>{type === "installer" ? `Installer · ${people.length} worker${people.length === 1 ? "" : "s"}` : `Electrician · REC ${data.rec_registration_number ?? "—"}`}</dd>
          <dt className="text-sub">Based</dt><dd>{data.business_address ?? "—"}</dd>
          <dt className="text-sub">Contact</dt><dd>{[data.primary_contact_name, data.business_phone ?? row.phone, data.business_email ?? row.email].filter(Boolean).join(" · ")}</dd>
          <dt className="text-sub">Applied</dt><dd>{r.data.signed_at ? new Date(r.data.signed_at).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" }) : "not signed"} · {type} application form</dd>
        </dl></Panel>
        <Panel title="Checks before approval"><ul className="space-y-2 text-sm" data-why="decision 232 checks list">{checks.map((x, i) => <li key={i} className="flex gap-2"><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${MARK[x.mark].cls}`}>{MARK[x.mark].sign}</span><span>{x.text}</span></li>)}</ul></Panel>
        {type === "installer" && <Panel title={`People · ${people.length}`}><ul className="space-y-2 text-sm">{people.map((w, i) => <li key={i}><b>{w.full_legal_name}</b><span className="block text-xs text-sub">{w.cii_holds === "held" ? `CII ${w.cii_level === "provisional" ? "Provisional" : "Full"}${w.cii_expiry ? ` to ${w.cii_expiry}` : ""} · ${verified.includes((w.email ?? "").toLowerCase()) ? "verified" : "to verify"}` : w.cii_holds === "in_training" ? "CII training in progress" : "CII not held"}</span></li>)}</ul></Panel>}
        <Panel title="Rates proposed"><dl className="space-y-1 text-sm">{type === "installer" ? <>
          {data.r5_rate != null && <div className="flex justify-between"><dt>Ceiling batts R5.0</dt><dd>${data.r5_rate}/m² <span className="text-xs text-sub">proposed</span></dd></div>}
          {data.r6_rate != null && <div className="flex justify-between"><dt>Ceiling batts R6.0</dt><dd>${data.r6_rate}/m²</dd></div>}
          {data.r7_rate != null && <div className="flex justify-between"><dt>Ceiling batts R7.0</dt><dd>${data.r7_rate}/m²</dd></div>}
          {data.batts_removal_rate != null && <div className="flex justify-between"><dt>Batts removal</dt><dd>${data.batts_removal_rate}/m²</dd></div>}
          <div className="flex justify-between"><dt>Usual electrician</dt><dd>{data.electrician_choice ? String(data.electrician_choice).replace(/_/g, " ") : "none named · HIV electrician for PIESAs"}</dd></div>
        </> : <div className="flex justify-between"><dt>PIESA</dt><dd>{data.assessment_rate != null ? `$${data.assessment_rate}` : "—"}</dd></div>}</dl></Panel>
        <Panel title="Coverage requested"><dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-sub">Areas</dt><dd>{row.service_areas?.join(" · ") || "—"}</dd>
          <dt className="text-sub">From</dt><dd>{data.service_origin ?? "—"}{data.travel_radius_km ? ` · up to ${data.travel_radius_km} km` : ""}</dd>
          {data.excluded_areas && <><dt className="text-sub">Not</dt><dd>{data.excluded_areas}</dd></>}
        </dl></Panel>
        <Panel title="Documents sent"><div className="space-y-3"><SignedRecAgreement id={appId} /><PartnerProfileCard applicationId={appId} /></div></Panel>
      </div>
      <div id="approve" className="scroll-mt-24">{!decided.data && <ApprovePartner applicationId={appId} showReviewDecision={false} />}</div>
      <OfficeEmailBox enquiryId={row.id} to={row.email} />
      <details className="rounded-[18px] border border-line bg-paper p-5"><summary className="cursor-pointer text-sm font-semibold text-ink">Full record, status and notes</summary><div className="mt-3"><ApplicationDetail row={row} recordOnly /></div></details>
      <p className="text-xs text-sub" data-why="decisions 107, 130, 153, 22/188 after approval">On approval: welcome email and the 2-minute guide go out, the business appears under Approved, each person gets the ESC privacy notice link and a Mitti invite, and CII certificates are verified under People before anyone is cleared for crews.</p>
    </div>
  );
}
