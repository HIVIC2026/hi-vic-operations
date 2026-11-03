// Part 2 (Jo 3 Nov 2026): the electrician's no-login page for an installer's own job. Shows ONLY the next step: book the
// safety check (PIESA), then "do it in Mitti". Part 3 (Task 3): then the electrical upgrades day, the upgrades form in Mitti,
// and "Add your Certificate of Electrical Safety" (one photo/PDF + number + date). Logic in electrician-link.server.ts.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TradePublicShell, card, ghostBtn, greenBtn, inputCls } from "@/components/trade/TradeShell";
import { addCertificateByLink, bookPiesaByLink, cantDoByLink, enterUpgradesDayByLink, getElectricianLinkView, startCertificateUploadByLink } from "@/lib/electrician-link.functions";
import { supabase } from "@/integrations/supabase/client";
import { CERTIFICATE_TOO_BIG, CERTIFICATE_WRONG_TYPE, certificateFileExt, certificateProblem } from "@/lib/certificate-later.core";
import { melbourneToday } from "@/lib/melbourne-time.core";
import { readableError } from "@/lib/readable-error.core";
import { CANT_DO_REASONS, cantDoReasonLabel, type CantDoReason } from "@/lib/electrician-link.core";

const E_LINK_PROBLEM = "We couldn't open this link. Check you have the whole link from the text, or call the installer.";
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" });

export const Route = createFileRoute("/e/$token")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Safety check – Home Insulation Victoria" },
    { name: "description", content: "Book the safety check (PIESA) for your job." },
    { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" },
    { property: "og:title", content: "Safety check – Home Insulation Victoria" },
    { property: "og:description", content: "Book the safety check (PIESA) for your job." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: ElectricianLink,
});

function ElectricianLink() {
  const { token } = Route.useParams();
  const q = useQuery({ queryKey: ["electrician-link", token], queryFn: () => getElectricianLinkView({ data: { token } }), retry: false });
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [cant, setCant] = useState(false);
  const [reason, setReason] = useState<CantDoReason>("busy");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sentBack, setSentBack] = useState(false);
  // Part 3: the upgrades day and the certificate step.
  const [uDay, setUDay] = useState("");
  const [uTime, setUTime] = useState("");
  const [certNumber, setCertNumber] = useState("");
  const [certDate, setCertDate] = useState("");
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certAdded, setCertAdded] = useState(false);
  const d = q.data;
  const bad = (msg: string) => <TradePublicShell><section className="rounded-[18px] border border-rose bg-pink p-5 text-ink" data-electrician-link-invalid><h1 className="font-display text-2xl font-bold">This link isn't working.</h1><p className="mt-1 text-sm">{msg}</p></section></TradePublicShell>;
  if (q.error) return bad(readableError(q.error, E_LINK_PROBLEM));
  if (!d) return <TradePublicShell><p className="text-sm text-sub">Loading…</p></TradePublicShell>;
  if (!d.ok) return bad(d.reason);
  if (sentBack) return <TradePublicShell><section className={card} data-electrician-link-cant-done><h1 className="font-display text-2xl font-bold">Thanks, we've let the installer know.</h1><p className="mt-1 text-sm">They'll sort out another electrician.</p></section></TradePublicShell>;
  const run = async (fn: () => Promise<unknown>, fallback: string) => { setBusy(true); setErr(null); try { await fn(); await q.refetch(); } catch (e) { setErr(readableError(e, fallback)); } finally { setBusy(false); } };
  return (
    <TradePublicShell>
      <div>
        <p className="text-sm text-sub">Hi {d.electricianName}</p>
        <h1 className="font-display text-[26px] font-bold leading-tight">Safety check (PIESA){d.address ? ` — ${d.address}` : ""}</h1>
        {d.jobNumber && <p className="text-xs font-bold text-sub">{d.jobNumber}</p>}
      </div>
      {d.step === "book_piesa" && (
        <>
          <section className={`${card} space-y-1 text-sm`} data-electrician-link-owner>
            <p className="font-medium">Call the owner to book a time</p>
            <p>{d.ownerName ?? "Owner"}{d.ownerMobile ? <> · <a className="font-semibold underline" href={`tel:${d.ownerMobile}`}>{d.ownerMobile}</a></> : null}</p>
            {d.address && <p>{d.address}</p>}
          </section>
          <section className={`${card} space-y-3`} data-electrician-link-book>
            <h2 className="font-display text-xl font-bold">Book it</h2>
            {d.lastDay && <p className="text-xs text-sub">Book it on or before {d.lastDay} (30 days after the owner paid).</p>}
            <label className="block text-sm font-bold">Date<input type="date" className={inputCls} min={d.firstDay} {...(d.lastDay ? { max: d.lastDay } : {})} value={day} onChange={(e) => setDay(e.target.value)} /></label>
            <label className="block text-sm font-bold">Time<input type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} /></label>
            <button type="button" className={greenBtn} disabled={busy || !day || !time} onClick={() => run(() => bookPiesaByLink({ data: { token, day, time } }), "That wasn't booked. Check your connection and try again.")}>Book it</button>
          </section>
          <section className={`${card} space-y-3`} data-electrician-link-cant>
            {!cant ? <button type="button" className={ghostBtn} onClick={() => setCant(true)}>Can't do this one</button> : (
              <>
                <h2 className="font-display text-xl font-bold">Can't do this one</h2>
                {CANT_DO_REASONS.map((r) => <label key={r} className="flex items-center gap-3 text-sm"><input type="radio" name="reason" className="h-5 w-5" checked={reason === r} onChange={() => setReason(r)} />{cantDoReasonLabel(r)}</label>)}
                {reason === "other" && <input className={inputCls} placeholder="Tell us why" aria-label="Why you can't do this one" value={note} onChange={(e) => setNote(e.target.value)} />}
                <button type="button" className={greenBtn} disabled={busy || (reason === "other" && !note.trim())}
                  onClick={async () => { setBusy(true); setErr(null); try { await cantDoByLink({ data: { token, reason, ...(reason === "other" ? { note } : {}) } }); setSentBack(true); } catch (e) { setErr(readableError(e, "That wasn't sent. Check your connection and try again.")); } finally { setBusy(false); } }}>Send</button>
              </>
            )}
          </section>
        </>
      )}
      {d.step === "do_piesa_in_mitti" && <section className={card} data-electrician-link-booked><p className="font-display text-2xl font-bold">{d.bookedStart ? `Booked for ${when(d.bookedStart)}.` : "Booked."}</p><p className="mt-1 text-sm">Do the safety check in Mitti on the day.</p></section>}
      {d.step === "enter_upgrades_day" && (
        <section className={`${card} space-y-3`} data-electrician-link-upgrades-day>
          <h2 className="font-display text-xl font-bold">When are you doing the electrical upgrades?</h2>
          <p className="text-sm text-sub">Agree the day with the owner, then enter it here. The upgrades form is made for that day.</p>
          <label className="block text-sm font-bold">Date<input type="date" className={inputCls} min={d.firstDay} value={uDay} onChange={(e) => setUDay(e.target.value)} /></label>
          <label className="block text-sm font-bold">Time<input type="time" className={inputCls} value={uTime} onChange={(e) => setUTime(e.target.value)} /></label>
          <button type="button" className={greenBtn} disabled={busy || !uDay || !uTime} onClick={() => run(() => enterUpgradesDayByLink({ data: { token, day: uDay, time: uTime } }), "That wasn't saved. Check your connection and try again.")}>Save the day</button>
        </section>
      )}
      {d.step === "do_upgrades_in_mitti" && <section className={card} data-electrician-link-upgrades-booked><p className="font-display text-2xl font-bold">{d.upgradesStart ? `Electrical upgrades on ${when(d.upgradesStart)}.` : "Electrical upgrades today."}</p><p className="mt-1 text-sm">Do the upgrades form in Mitti on the day. No certificate yet? Say so on the form — this link comes back for it.</p></section>}
      {d.step === "add_certificate" && !certAdded && (
        <section className={`${card} space-y-3`} data-electrician-link-certificate>
          <h2 className="font-display text-xl font-bold">Add your Certificate of Electrical Safety</h2>
          <label className="block text-sm font-bold">Certificate number<input className={inputCls} inputMode="text" autoComplete="off" value={certNumber} onChange={(e) => setCertNumber(e.target.value)} /></label>
          <label className="block text-sm font-bold">Date on the certificate<input type="date" className={inputCls} max={melbourneToday()} value={certDate} onChange={(e) => setCertDate(e.target.value)} /></label>
          <label className="block text-sm font-bold">Photo or PDF of the certificate<input type="file" className={inputCls} accept="application/pdf,image/*" onChange={(e) => setCertFile(e.target.files?.[0] ?? null)} /></label>
          <button type="button" className={greenBtn} disabled={busy || !certNumber.trim() || !certDate || !certFile}
            onClick={() => run(async () => {
              const f = certFile!;
              const early = certificateProblem({ number: certNumber, date: certDate, hasFile: true, today: melbourneToday() });
              if (early) throw new Error(early);
              if (!certificateFileExt(f.type) && !/\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(f.name)) throw new Error(CERTIFICATE_WRONG_TYPE);
              if (f.size > d.certificateMaxBytes) throw new Error(CERTIFICATE_TOO_BIG);
              const u = await startCertificateUploadByLink({ data: { token, fileName: f.name, mime: f.type || "application/octet-stream", size: f.size } });
              const { error } = await supabase.storage.from("job-files").uploadToSignedUrl(u.path, u.token, f, { contentType: u.mime });
              if (error) throw new Error("The file didn't upload. Check your connection and try again.");
              await addCertificateByLink({ data: { token, number: certNumber.trim(), date: certDate, filePath: u.path, fileName: f.name } });
              setCertAdded(true);
            }, "That wasn't saved. Check your connection and try again.")}>Add the certificate</button>
        </section>
      )}
      {(d.step === "done" || (d.step === "add_certificate" && certAdded)) && <section className={card} data-electrician-link-done><p className="font-display text-2xl font-bold">All done. Thanks.</p>{certAdded && <p className="mt-1 text-sm">We've got the certificate.</p>}</section>}
      {err && <p role="alert" className="rounded-[18px] bg-owner-house-pink p-4 font-semibold">{err}</p>}
    </TradePublicShell>
  );
}
