import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPartnerProfilePreview, markApplicationTest } from "@/lib/partner-profile.functions";
import { getPartnerMittiInvited, setPartnerMittiInvited } from "@/lib/trade-view.functions";
import { TradeTextsCard } from "@/components/portal/trade-texts";
import { useAction } from "@/hooks/use-me";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { collectionNoticeLabel } from "@/lib/esc-collection-notice.core";

const money = (n: number | null, unit = "") => (n == null ? "—" : `$${n.toLocaleString("en-AU")}${unit}`);
const yn = (b: boolean | null) => (b == null ? "—" : b ? "Yes" : "No");
const d = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-AU") : "—");
const TYPE = { installer: "Installer", electrician: "Electrician / REC", both: "Installer and electrician" } as const;

function Section({ title, rows }: { title: string; rows: [string, React.ReactNode][] }) {
  return (
    <div className="border-t pt-2">
      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">{rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd>{v ?? "—"}</dd></Fragment>)}</dl>
    </div>
  );
}

/** Office-only: partners see Mitti instructions only once this is ticked. */
function MittiInvitedToggle({ businessId }: { businessId: string }) {
  const load = useServerFn(getPartnerMittiInvited);
  const set = useAction(setPartnerMittiInvited);
  const q = useQuery({ queryKey: ["mitti-invited-admin", businessId], queryFn: () => load({ data: { businessId } }) });
  const on = q.data?.invited === true;
  return (
    <label className="flex items-center gap-2 border-t pt-2 text-sm">
      <input type="checkbox" className="h-4 w-4" checked={on} disabled={q.isPending} onChange={async (e) => { await set({ businessId, invited: e.target.checked }, e.target.checked ? "Mitti account invited — partner will see Mitti instructions" : "Mitti hidden from this partner"); await q.refetch(); }} />
      <span><span className="font-semibold">Mitti account invited</span> <span className="text-muted-foreground">(office only — until ticked, this partner never sees Mitti{on && q.data?.at ? `; ticked ${d(q.data.at)}` : ""})</span></span>
    </label>
  );
}

/** The one tidy business profile this application creates or updates on approval, with review flags (never blocking). */
export function PartnerProfileCard({ applicationId }: { applicationId: string }) {
  const load = useServerFn(getPartnerProfilePreview);
  const mark = useAction(markApplicationTest);
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const q = useQuery({ queryKey: ["partner-profile", applicationId], queryFn: () => load({ data: { applicationId } }) });
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading partner profile…</p>;
  if (q.error) return <p role="alert" className="text-sm text-danger">{(q.error as Error).message}</p>;
  const { profile: p, flags, isTest, existingBusinessId, activatedBusinessId, approvalMessage } = q.data;
  return (
    <section aria-label="Partner profile" className="space-y-2 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg font-extrabold">Partner profile</h3>
        <div className="flex gap-1">
          {isTest && <Badge variant="outline">TEST — approves as a TEST partner only</Badge>}
          {activatedBusinessId ? <Badge>Approved</Badge> : existingBusinessId ? <Badge variant="outline">Updates existing business (same ABN)</Badge> : <Badge variant="outline">New business on approval</Badge>}
        </div>
      </div>
      {(activatedBusinessId ?? existingBusinessId) && <MittiInvitedToggle businessId={(activatedBusinessId ?? existingBusinessId) as string} />}
      {(activatedBusinessId ?? existingBusinessId) && <TradeTextsCard businessId={(activatedBusinessId ?? existingBusinessId) as string} />}
      {flags.length > 0 && (
        <div className="rounded-lg border border-warning/50 bg-warning-soft p-3">
          <div className="mb-1 text-sm font-semibold">Check before approving (doesn't block)</div>
          <ul className="list-inside list-disc text-sm">{flags.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      )}
      <Section title="Business" rows={[["Legal name", p.business.legal_name], ["Trading name", p.business.trading_name], ["ABN", p.business.abn], ["Type", TYPE[p.business.type]], ["Address", p.business.address], ["Base suburb", p.business.base_suburb], ["Email", p.business.email], ["Phone", p.business.phone], ["GST registered", yn(p.business.gst_registered)]]} />
      <Section title="People" rows={[["Business owner / signer", [p.signer.name, p.signer.position].filter(Boolean).join(", ")], ["Mobile", p.signer.mobile], ["Email", p.signer.email], ...p.workers.map((w, i) => [`Worker ${i + 1}`, <span key={w.email ?? i}>{[w.name, w.mobile, w.email].filter(Boolean).join(" · ")}{w.collection_notice && <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${w.collection_notice.state === "acknowledged" ? "bg-success/10 text-success" : "bg-warning-soft"}`} data-esc-notice-state={w.collection_notice.state}>{collectionNoticeLabel(w.collection_notice)}</span>}</span>] as [string, React.ReactNode])]} />
      <Section title="Licences and certificates" rows={p.licences.map((l) => [l.holder ? `${l.label} (${l.holder})` : l.label, <span key={l.kind}>{l.kind === "piisa_training" ? <>{l.number === "done" ? "Done" : l.number === "not_done" ? "Not done" : "Not recorded"}{l.expires_at ? ` · completed ${d(l.expires_at)}` : ""}</> : <>{l.number ?? "Not recorded"}{l.issuer ? ` · issued by ${l.issuer}` : ""}{l.issued_at ? ` · issued ${d(l.issued_at)}` : ""}{l.expires_at ? ` · expires ${d(l.expires_at)}` : l.number ? " · no expiry" : ""}</>} · {l.file_url ? <a className="font-semibold text-primary underline" href={l.file_url} target="_blank" rel="noreferrer">Open uploaded file</a> : l.kind === "cii_certification" ? "no file upload in the form — office verifies the certificate" : `file ${l.has_file ? "yes" : "no"}`} · <b>{l.verified ? "Verified" : "Not verified"}</b></span>] as [string, React.ReactNode])} />
      <Section title="Insurance" rows={[["Public liability", money(p.insurance.amount)], ["Insurer", p.insurance.insurer], ["Policy", p.insurance.policy], ["Expiry", p.insurance.expires_at ? `${d(p.insurance.expires_at)} (typed by applicant)` : null], ["Certificate", p.insurance.file_url ? <a className="font-semibold text-primary underline" href={p.insurance.file_url} target="_blank" rel="noreferrer">Open uploaded certificate</a> : p.insurance.has_file ? "Uploaded" : "Missing"], ["Verified", yn(p.insurance.verified)]]} />
      <Section title="Agreement" rows={[["Version", p.agreement.version], ["Signed by", p.agreement.signed_by], ["Signed at", d(p.agreement.signed_at)], ["Copy", p.agreement.has_copy ? "Stored with the signed record" : "Missing"]]} />
      <Section title="Rates (inc GST)" rows={p.business.type === "electrician" ? [["PIESA", money(p.rates.piesa)], ["Return visit", money(p.rates.return_visit)]] : [["R5 per m²", money(p.rates.r5_per_m2, "/m²")], ["R6 per m²", money(p.rates.r6_per_m2, "/m²")], ["R7 per m²", money(p.rates.r7_per_m2, "/m²")], ["Top-up R5 per m²", money(p.rates.topup_r5_per_m2, "/m²")], ["Vacuum only per m²", money(p.rates.vacuum_only_per_m2, "/m²")], ["Batts removal", money(p.rates.batts_removal_per_m2, "/m²")], ["Loose-fill removal", money(p.rates.loose_fill_removal_per_m2, "/m²")], ["Free quotes for our leads", yn(p.rates.free_quotes)], ["Free Ready Checks", yn(p.rates.free_measure_ups)]]} />
      <Section title="Coverage and capacity" rows={[["Base", p.coverage.base], ["Map point", p.coverage.lat != null ? `${p.coverage.lat.toFixed(4)}, ${p.coverage.lng?.toFixed(4)}` : null], ["Area", p.coverage.anywhere_in_victoria ? "Anywhere in Victoria" : p.coverage.radius_km ? `${p.coverage.radius_km} km radius` : null], ["Jobs per week", p.capacity.jobs_per_week]]} />
      <Section title="Bank details" rows={[["Supplied", p.bank.supplied ? "Yes — checked through the bank details review" : "No"]]} />
      <p className="border-t pt-2 text-xs text-muted-foreground">Approval message: {approvalMessage === "sent" ? "sent (welcome email with the login link)" : approvalMessage === "queued" ? "queued — goes as the welcome email when you send the login link" : activatedBusinessId ? "not queued" : "queued on approval; sent as the welcome email with the login link"}.</p>
      {!isTest && !activatedBusinessId && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          <input aria-label="Why is this a test?" className="h-9 flex-1 rounded border px-2 text-sm" placeholder="Why is this a test? (e.g. Jo practice run)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" variant="outline" disabled={reason.trim().length < 3} onClick={async () => { await mark({ applicationId, reason }, "Marked as test"); await Promise.all([q.refetch(), qc.invalidateQueries({ queryKey: ["partner_enquiries"] })]); }}>Mark as test</Button>
        </div>
      )}
    </section>
  );
}
