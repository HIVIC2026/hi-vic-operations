import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useServerFn } from "@tanstack/react-start";
import { answerInstallerQuoted, getInstallerJobFacts, getMyInstallerJobFacts } from "@/lib/portal.functions";
import { bookOwnReadyCheckFn, getInstallerRcState } from "@/lib/installer-ready-check.functions";
import { Section } from "./panels";
import { QUOTED_QUESTION, installerFactLabels, type InstallerJobFacts } from "@/lib/bulk-import.core";

/** Installer-sourced jobs: site check done? and the installer's own price (or "Quote needed from installer"). */
export function InstallerFactsLine({ facts }: { facts: InstallerJobFacts | null | undefined }) {
  if (!facts) return null;
  const l = installerFactLabels(facts);
  return (
    <div className="flex flex-wrap gap-1 text-[11px] font-semibold" data-installer-facts>
      <span className={`rounded-[18px] px-2 py-0.5 ${facts.site_check === "yes" ? "bg-mint text-hiv-green" : facts.site_check === "no" ? "bg-mist text-hiv-blue" : "bg-pink text-rose"}`}>{l.siteCheck}</span>
      <span className={`rounded-[18px] px-2 py-0.5 ${facts.quoted_price_inc_gst ? "bg-mist text-hiv-blue" : "bg-pink text-rose"}`}>{l.price}</span>
    </div>
  );
}

/** Office job page card (installer-sourced jobs only). */
export function OfficeInstallerFactsCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getInstallerJobFacts);
  const q = useQuery({ queryKey: ["installer-facts", jobId], queryFn: () => load({ data: { jobId } }) });
  if (q.error) return <Section title="Installer's job"><p className="text-sm text-destructive">{(q.error as Error).message}</p></Section>;
  if (!q.data) return null;
  const f = q.data; const l = installerFactLabels(f);
  return (
    <Section title="Installer's job">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm" data-installer-facts-card>
        <dt className="text-muted-foreground">Site check / Ready Check</dt><dd className="font-semibold">{l.siteCheck.replace(/^Site check( done)?: /, "")}</dd>
        <dt className="text-muted-foreground">Installer's quoted price</dt><dd className={f.quoted_price_inc_gst ? "font-semibold" : "font-semibold text-destructive"}>{f.quoted_price_inc_gst ? `$${f.quoted_price_inc_gst.toLocaleString("en-AU")} inc GST` : l.price}</dd>
        <dt className="text-muted-foreground">Price includes</dt><dd>{f.price_includes ?? "—"}</dd>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">This is the installer's own price, exactly as supplied. Yes skips the Ready Check; No goes to it.</p>
    </Section>
  );
}

/** Partner job page card: what he told us when he uploaded the job. */
export function PartnerInstallerFactsCard({ jobId }: { jobId: string }) {
  const load = useServerFn(getMyInstallerJobFacts);
  const q = useQuery({ queryKey: ["my-installer-facts", jobId], queryFn: () => load({ data: { jobId } }) });
  const f = q.data;
  if (!f) return null;
  const l = installerFactLabels(f);
  return (
    <>
    {f.quoted === null && <QuotedQuestion jobId={jobId} />}
    {f.quoted === "no" && <InstallerReadyCheckCard jobId={jobId} />}
    <section className="rounded-[18px] border border-line bg-paper p-[19px] shadow-card" data-partner-installer-facts>
      <h2 className="font-display text-lg font-bold">What you told us</h2>
      <dl className="mt-2 divide-y divide-line">
        <div className="py-2"><dt className="text-xs font-bold uppercase tracking-wide text-sub">Site check done</dt><dd className="font-semibold">{l.siteCheck.replace(/^Site check( done)?: /, "")}</dd></div>
        <div className="py-2"><dt className="text-xs font-bold uppercase tracking-wide text-sub">Your quoted price</dt><dd className="font-semibold">{f.quoted_price_inc_gst ? `$${f.quoted_price_inc_gst.toLocaleString("en-AU")} inc GST` : l.price}</dd></div>
        <div className="py-2"><dt className="text-xs font-bold uppercase tracking-wide text-sub">What the price includes</dt><dd className="font-semibold">{f.price_includes ?? "—"}</dd></div>
      </dl>
    </section>
    </>
  );
}

/** Next action for the installer when "Quoted?" was left blank at upload (Jo, 5:46pm). */
function QuotedQuestion({ jobId, priceOnly = false }: { jobId: string; priceOnly?: boolean }) {
  const qc = useQueryClient();
  const answer = useServerFn(answerInstallerQuoted);
  const [yes, setYes] = useState(false);
  const [price, setPrice] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const n = Number(price.replace(/[$,\s]/g, ""));
  const send = async (a: "yes" | "no") => {
    setBusy(true); setErr("");
    try { await answer({ data: { jobId, answer: a, price: a === "yes" ? n : null } }); await qc.invalidateQueries(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="rounded-[19px] border border-rose/25 bg-pink p-5 md:p-[23px]" data-quoted-question>
      <p className="text-xs font-bold uppercase tracking-wide text-sub">Next for you</p>
      <h2 className="font-display text-lg font-bold">{QUOTED_QUESTION}</h2>
      <div className="mt-3 inline-flex gap-1 rounded-[11px] bg-paper p-1">
        <Button size="sm" className="min-w-16" variant={yes ? "default" : "outline"} disabled={busy} onClick={() => setYes(true)}>Yes</Button>
        {!priceOnly && <Button size="sm" className="min-w-16" variant="outline" disabled={busy} onClick={() => send("no")}>No</Button>}
      </div>
      {yes && <div className="mt-3 space-y-2">
        <label className="block text-sm font-bold">Your quoted price inc GST<Input className="mt-1 h-12" inputMode="decimal" placeholder="e.g. 3,450" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <Button size="field" className="w-full" disabled={busy || !(Number.isFinite(n) && n > 0)} onClick={() => send("yes")}>Save price</Button>
      </div>}
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
    </section>
  );
}

/** Quoted = No: "Book a Ready Check" (Jo, 7 Oct 6pm). Only this installer ever gets the job. */
function InstallerReadyCheckCard({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const get = useServerFn(getInstallerRcState);
  const book = useServerFn(bookOwnReadyCheckFn);
  const q = useQuery({ queryKey: ["installer-rc", jobId], queryFn: () => get({ data: { jobId } }) });
  const [mine, setMine] = useState(false);
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const s = q.data;
  if (q.isError) return <section role="alert" className="rounded-[19px] border border-line bg-paper p-5 text-sm" data-installer-ready-check="error">The Ready Check status could not load. <Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button></section>;
  if (!s) return null;
  if (s.action === "confirm_attendance") return <section className="rounded-[19px] border border-rose/25 bg-pink p-5 md:p-[23px]" data-installer-ready-check="confirm_attendance"><p className="text-xs font-bold uppercase tracking-wide text-sub">Next for you</p><h2 className="font-display text-lg font-bold">Have you attended and assessed this property?</h2><p className="text-sm">Not recorded yet. Answer it in this job's details below — we don't assume either way.</p></section>;
  if (s.action === "none") return <QuotedQuestion jobId={jobId} priceOnly />;
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(""); try { await fn(); await qc.invalidateQueries(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <section className="rounded-[19px] border border-rose/25 bg-pink p-5 md:p-[23px]" data-installer-ready-check={s.action}>
      <p className="text-xs font-bold uppercase tracking-wide text-sub">Next for you</p>
      {s.action === "booked" ? <><h2 className="font-display text-lg font-bold">Ready Check booked</h2>{s.bookedAt && <p className="text-sm">{new Date(s.bookedAt).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>}</>
      : <><h2 className="font-display text-lg font-bold">Book a Ready Check</h2>
          <p className="mt-1 text-sm">Arrange the visit with the owner directly, then enter the time here.</p>
          <div className="mt-3 grid gap-2">
            <Button size="field" variant={mine ? "default" : "outline"} disabled={busy} onClick={() => setMine(true)}>I'll book it with the owner</Button>
          </div>
          {mine && <div className="mt-3 space-y-2">
            <label className="block text-sm font-bold">Date and time you agreed<Input type="datetime-local" className="mt-1 h-12" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
            <p className="text-xs text-sub">Nothing is sent to the owner.</p>
            <Button size="field" className="w-full" disabled={busy || !when} onClick={() => run(() => book({ data: { jobId, startsAt: new Date(when).toISOString() } }))}>Book Ready Check</Button>
          </div>}</>}
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
    </section>
  );
}
