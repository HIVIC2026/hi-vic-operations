import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { clearSiteConditionsHold, getInstallerIntake, getInstallerQuoteDraft, officeIntakeAction, sendInstallerQuote, stopInstallerQuoteHold } from "@/lib/installer-quote.functions";
import { Button } from "@/components/ui/button";

const money = (n: number) => `$${n.toFixed(2)}`;

/** Admin: the owner quote auto-drafted from the installer's Ready Check. Nothing is sent until the office presses Send. */
export function InstallerQuoteDraftPanel({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallerQuoteDraft);
  const send = useServerFn(sendInstallerQuote);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["installer-quote-draft", jobId], queryFn: () => load({ data: { jobId } }) });
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading installer quote…</p>;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const d = q.data;
  if (!d?.applies) return null;
  const quote = d.quote;
  const brand = (quote?.cobrand ?? null) as { partner_name?: string; partnerName?: string } | null;
  const partner = brand?.partner_name ?? brand?.partnerName ?? null;

  const onSend = async () => {
    if (!quote) return;
    setBusy(true);
    try {
      const r = await send({ data: { jobId, quoteId: quote.id } });
      await qc.invalidateQueries({ queryKey: ["installer-quote-draft", jobId] });
      toast.success(r.delivery === "ready_to_send" ? "Quote sent to the owner." : "Quote is now in the owner's portal. No email went out — messages are switched off or the owner hasn't agreed to contact.");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <div>
        <h3 className="font-semibold">Owner quote from the installer's Ready Check</h3>
        <p className="text-xs text-muted-foreground">
          {partner ? `${partner} with ` : "Installer branding with "}Home Insulation Victoria as the Accredited Person. All prices inc GST. No lead fee, no margin.
        </p>
      </div>
      {d.heldBlockers.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">Not drafted — needs office review:</p>
          <ul className="list-disc pl-5 text-destructive">{d.heldBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
      {!quote ? (
        d.heldBlockers.length === 0 && <p className="text-sm text-muted-foreground">Waiting for the installer to finish the Ready Check in Mitti.</p>
      ) : (
        <>
          <dl className="divide-y text-sm">
            {quote.quote_items.map((i) => (
              <div key={i.sort} className="flex justify-between gap-4 py-1.5"><dt>{i.description}</dt><dd className="tabular-nums shrink-0">{money(Number(i.line_total_inc_gst))}</dd></div>
            ))}
            <div className="flex justify-between py-1.5"><dt>Estimated project total</dt><dd className="tabular-nums">{money(Number(quote.subtotal_inc_gst))}</dd></div>
            <div className="flex justify-between py-1.5"><dt>Estimated VEU / VEEC discount</dt><dd className="tabular-nums">−{money(Number(quote.veec_discount_inc_gst))}</dd></div>
            <div className="flex justify-between py-2 font-semibold"><dt>Estimated cost after discount</dt><dd className="tabular-nums">{money(Number(quote.customer_total_inc_gst))}</dd></div>
          </dl>
          {quote.status === "draft" ? (
            <Button disabled={busy} onClick={onSend}>Send quote to owner</Button>
          ) : (
            <p className="text-sm font-medium">{quote.status === "accepted" ? "Accepted by the owner." : "Sent to the owner."}</p>
          )}
        </>
      )}
    </section>
  );
}

/** Admin: review the installer's short intake — owner eligibility, insulation, quote inputs, fee awareness, prepare quote. */
export function InstallerIntakeReviewPanel({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallerIntake);
  const act = useServerFn(officeIntakeAction);
  const clearHold = useServerFn(clearSiteConditionsHold);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["installer-intake", jobId], queryFn: () => load({ data: { jobId } }) });
  const [reason, setReason] = useState("");
  const [ins, setIns] = useState<"" | "none" | "below_r2" | "unknown">("");
  const [amount, setAmount] = useState("");
  const [area, setArea] = useState("");
  const [incl, setIncl] = useState("");
  const [prop, setProp] = useState("");
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return null;
  // A failed read never hides as "nothing to review" or "ready".
  if (q.error) return <section className="rounded-lg border p-4 text-sm" role="alert" data-installer-intake-error>Installer intake couldn't load — quote readiness is unknown. <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Retry</Button></section>;
  if (!q.data || q.data.channel !== "installer_sourced") return null;
  const s = q.data;
  const run = async (data: Record<string, unknown>) => {
    setBusy(true);
    try { await act({ data: data as never }); await qc.invalidateQueries({ queryKey: ["installer-intake", jobId] }); await qc.invalidateQueries({ queryKey: ["installer-quote-draft", jobId] }); toast.success("Saved"); setReason(""); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const label = { none: "None", below_r2: "Confirmed below R2", unknown: "Not yet confirmed" } as const;
  return (
    <section className="space-y-3 rounded-lg border p-4" data-installer-intake-review>
      <h3 className="font-semibold">Installer intake</h3>
      <ul className="text-sm space-y-0.5">
        <li>Who organises: <b>{s.coordination === "self_managed" ? "Installer organises the job" : s.coordination === "hivic_managed" ? "Home Insulation Victoria manages" : "Not recorded"}</b> — {s.coordinationNext}</li>
        <li>Owner eligibility (office): <b>{s.officeEligibility === "eligible" ? "Checked — eligible" : s.officeEligibility === "declined" ? "Not eligible" : "Not checked yet"}</b></li>
        <li>Ceiling area: <b>{s.areaM2 ? `${s.areaM2} m²` : "Missing"}</b>{s.areaProvenance === "installer_provisional" ? " (installer-supplied, provisional)" : s.areaProvenance ? ` (${s.areaProvenance})` : ""}</li>
        <li>Proposed product: <b>{s.proposedR ? `R${s.proposedR}` : "Not given"}</b> (not existing insulation)</li>
        {s.reconfirmationRequired && <li className="font-medium text-destructive">Accepted quote facts changed — owner must reconfirm</li>}
        <li>Existing insulation: <b>{s.insulation ? label[s.insulation] : "Not recorded"}</b>{s.insulationSource === "installer_intake_corrected" ? " (office corrected)" : " (installer declaration, unverified)"}</li>
        <li>Ceiling area: {s.areaM2 ?? "—"} m² · Installer quote: {s.quoteIncGst != null ? money(s.quoteIncGst) + " inc GST" : "not entered (check uploaded file)"}</li>
        <li>Includes: {s.includes ?? "—"}</li>
        <li data-office-commercial>Installer price basis: <b>{!s.commercial ? "Not recorded — clarify" : `${s.commercial.basis === "before_discount" ? "before VEU discount" : s.commercial.basis === "after_discount" ? "already discounted (review)" : "unsure (review)"} · ${s.commercial.gst === "inc_gst" ? "inc GST" : s.commercial.gst === "ex_gst" ? "ex GST (review)" : "GST unsure (review)"}`}</b>{s.commercial?.exclusions ? ` · Excludes: ${s.commercial.exclusions}` : ""} · {s.removalText}</li>
        {s.siteHold.open && <li className="font-medium text-destructive" data-office-site-hold>Site conditions differ (installer): {s.siteHold.note ?? "no note"} — quote and works on hold</li>}
        <li>Electrician: <b>{s.electricianPayer === "own" ? "Installer's own electrician — invoices the owner directly (no $349 PIESA on our quote)" : s.electricianPayer === "hivic" ? "Home Insulation Victoria arranges — $349 PIESA on the quote" : "To be arranged"}</b></li>
        <li data-office-fee-record>Owner fee declaration: {s.feeRecord ? <>
          <b>{s.feeRecord.current && s.feeRecord.coversCurrentPayer ? "Recorded" : "Out of date — record again"}</b> · by {s.feeRecord.by === "installer" ? "installer" : s.feeRecord.by === "office" ? "office" : s.feeRecord.by}{s.feeRecord.actorName ? ` (${s.feeRecord.actorName})` : ""} · {new Date(s.feeRecord.at).toLocaleString("en-AU")} · for {s.feeRecord.payer === "own" ? "own electrician" : s.feeRecord.payer === "hivic" ? "Home Insulation Victoria electrician" : "earlier office record (PIESA + AP wording)"}
          <span className="block text-xs text-muted-foreground">“{s.feeRecord.wording ?? "Wording not stored on this older record"}”{s.feeRecord.version ? ` · ${s.feeRecord.version}` : ""}{s.feeRecord.source ? ` · ${s.feeRecord.source}` : ""}{s.feeRecord.note ? ` · Note: ${s.feeRecord.note}` : ""}</span></> : <b>Not recorded</b>}</li>
        <li>Ready Check: {s.readyCheck.outstandingCount} item{s.readyCheck.outstandingCount === 1 ? "" : "s"} outstanding (not needed for the quote; needed before the rebate)</li>
      </ul>
      {s.readiness.blockers.length > 0 && <div className="text-sm"><p className="font-medium">Quote not ready:</p><ul className="list-disc pl-5">{s.readiness.blockers.map((b) => <li key={b}>{b}</li>)}</ul></div>}
      {s.releaseBlockers.length > 0 && <div className="text-sm"><p className="font-medium">Before sending:</p><ul className="list-disc pl-5">{s.releaseBlockers.map((b) => <li key={b}>{b}</li>)}</ul></div>}
      <label className="block text-sm">Note / reason (required)<textarea className="mt-1 w-full rounded border p-2 text-sm" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !reason.trim()} onClick={() => run({ action: "eligibility", jobId, outcome: "eligible", reason })}>Owner eligible</Button>
        <Button size="sm" variant="outline" disabled={busy || !reason.trim()} onClick={() => run({ action: "eligibility", jobId, outcome: "not_eligible", reason })}>Not eligible</Button>
        <Button size="sm" variant="outline" disabled={busy || !reason.trim()} onClick={() => run({ action: "fee_awareness", jobId, note: reason })}>Owner told about fees</Button>
        {s.siteHold.open && <Button size="sm" variant="outline" disabled={busy || reason.trim().length < 5} onClick={async () => { setBusy(true); try { await clearHold({ data: { jobId, reason: reason.trim() } }); await qc.invalidateQueries({ queryKey: ["installer-intake", jobId] }); toast.success("Site review recorded"); setReason(""); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }}>Site conditions reviewed</Button>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Insulation<select className="ml-1 h-9 rounded border px-2" value={ins} onChange={(e) => setIns(e.target.value as typeof ins)}><option value="">No change</option><option value="none">None</option><option value="below_r2">Confirmed below R2</option><option value="unknown">Not yet confirmed</option></select></label>
        <label className="text-sm">Quote inc GST<input className="ml-1 h-9 w-28 rounded border px-2" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="text-sm">Area m²<input className="ml-1 h-9 w-20 rounded border px-2" inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} /></label>
        <label className="text-sm">Proposed R<input className="ml-1 h-9 w-16 rounded border px-2" inputMode="decimal" value={prop} onChange={(e) => setProp(e.target.value)} /></label>
        <label className="text-sm">Includes<input className="ml-1 h-9 w-48 rounded border px-2" value={incl} onChange={(e) => setIncl(e.target.value)} /></label>
        <Button size="sm" variant="outline" disabled={busy || !reason.trim() || (!ins && !amount && !area && !incl.trim() && !prop)} onClick={() => { const n = (v: string) => Number(v.replace(/[$,Rr\s]/g, "")); run({ action: "correct", jobId, reason, ...(ins ? { insulation: ins } : {}), ...(amount && n(amount) > 0 ? { quoteIncGst: n(amount) } : {}), ...(area && n(area) > 0 ? { areaM2: n(area) } : {}), ...(incl.trim() ? { includes: incl.trim() } : {}), ...(prop && n(prop) > 0 ? { proposedR: n(prop) } : {}) }); }}>Save correction</Button>
      </div>
      <p className="text-xs text-muted-foreground">A correction withdraws draft and sent quotes, needs the eligibility check again, and flags an accepted quote for owner reconfirmation (its price is never changed).</p>
      <Button size="sm" disabled={busy || !s.readiness.ready} onClick={() => run({ action: "draft_quote", jobId })}>Prepare owner quote (draft, not sent)</Button>
    </section>
  );
}
