// Office job page: "Choose installer" for an our-lead Ready Check (Jo 24 Oct 2026, decisions 49–51).
// Nearby approved installers with their area and rates. Decision 389 (Jo 25 Oct 2026): tapping Release recorded the
// installer as a PENDING release and sent the OWNER "It's your turn". A48 batch 2 (Jo 30 Oct 2026): website owners are
// sent through area batches (including a batch of one) — so Release now shows only for an owner
// who already confirmed (it goes straight to the installer); old releases stay readable. Installers' own customers never
// show this.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/portal/panels";
import { listChooseTrades } from "@/lib/offer-dispatch.functions";
import { getSpotRelease, releaseSpotFn } from "@/lib/spot-release.functions";
import { getAreaBatchSuggestions, getBatchesReadyToSend, sendAreaBatchFn } from "@/lib/area-batch.functions";
import { offerRunFn, returnBatchFn } from "@/lib/installer-run.functions";
import { Pill, btnClass } from "@/components/portal/kit";
import { CHOOSE_LOAD_FAILED, choosePanelState } from "@/lib/installer-waiting-columns.core";
import { useJobFile } from "@/components/portal/jobfile";
import { AREA_BATCH_SENT_EVENT, openBatchId } from "@/lib/area-batch.core";

const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

/** `reportLoad`: the Choose installer pop-up (the job is known to be waiting) says when the list is loading or failed,
 *  instead of a blank box. The job page leaves it off: there the panel only appears for jobs at this step. */
export function ChooseInstallerPanel({ jobId, reportLoad = false }: { jobId: string; reportLoad?: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listChooseTrades);
  const release = useServerFn(releaseSpotFn);
  const send = useServerFn(sendAreaBatchFn);
  const loadRelease = useServerFn(getSpotRelease);
  const file = useJobFile(jobId);
  const q = useQuery({ queryKey: ["choose-trades", jobId, "ready_check"], queryFn: () => list({ data: { jobId, kind: "ready_check" } }) });
  const rq = useQuery({ queryKey: ["spot-release", jobId], queryFn: () => loadRelease({ data: { jobId } }) });
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const d = q.data;
  const state = choosePanelState({ isError: q.isError, hasData: !!d });
  if (reportLoad && state === "error") return (
    <div id="choose-installer" role="alert" className="space-y-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-3 text-sm">
      <p className="font-semibold text-danger">{CHOOSE_LOAD_FAILED}</p>
      <p className="text-sub">This does not mean no installer can take the job.{q.error instanceof Error && q.error.message ? ` ${q.error.message}` : ""}</p>
      <button type="button" className={btnClass("secondary")} disabled={q.isFetching} onClick={() => void q.refetch()}>{q.isFetching ? "Trying again…" : "Try again"}</button>
    </div>
  );
  if (reportLoad && state === "loading") return <p className="text-sm text-sub">Loading installers…</p>;
  if (!d ||d.channel !== "hivic_sourced" || d.stage !== "ready_check_ready_to_schedule" || d.hasInstaller) return null;
  const pick = async (id: string, name: string) => {
    if (busy) return;
    setBusy(id);
    try {
      const r = await release({ data: { jobId, businessId: id } });
      toast.success(r.mode === "released" ? `Released to ${name} — the owner has been asked to confirm` : `Owner already confirmed — offer sent to ${name}`);
      void qc.invalidateQueries();
    }
    catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); }
    finally { setBusy(null); }
  };
  type T = (typeof d.matching)[number];
  const shown: T[] = showAll ? [...d.matching, ...d.others] : d.matching;
  const rel = rq.data;
  const pending = rel?.state === "pending";
  const confirmed = rel?.state === "confirmed";
  const batchEvents = (file.data?.timeline ?? []).map((t) => ({ event_type: String(t.detail?.["event_type"] ?? ""), created_at: t.at, details: t.detail }));
  const batchId = openBatchId(batchEvents);
  const batch = batchEvents.find((e) => e.event_type === AREA_BATCH_SENT_EVENT && e.details?.["batch_id"] === batchId);
  const batchSent = !!batchId || !!sentTo;
  const waiting = !pending && !confirmed && !batchSent && !rq.isPending && !rq.isError && !file.isPending && !file.isError;
  const sendOne = async (businessId: string, name: string) => {
    if (busy) return;
    setBusy(businessId);
    try {
      const r = await send({ data: { jobIds: [jobId], businessId } });
      toast.success(`Sent to ${r.homes} ${r.homes === 1 ? "owner" : "owners"} for ${name}${r.held ? ` · ${r.held} text${r.held === 1 ? "" : "s"} held (see the job)` : ""}`);
      setSentTo(name);
      void qc.invalidateQueries();
    } catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); }
    finally { setBusy(null); }
  };
  return (
    <div id="choose-installer">
      <Section title="Choose installer">
        <div className="space-y-3 text-sm">
          {d.openOffer
            ? <p className="rounded-md border px-3 py-2">Offer sent to <span className="font-semibold">{d.openOffer.business ?? "the installer"}</span>. Waiting for them to offer the owner 3 times{d.openOffer.expiresAt ? ` (closes ${when(d.openOffer.expiresAt)})` : ""}.</p>
            : pending ? <p className="rounded-md border px-3 py-2" data-release="pending">{rel?.line}. The installer is offered the job only once the owner confirms.</p>
            : confirmed ? <p className="rounded-md border px-3 py-2" data-release="confirmed"><span className="font-semibold">{rel?.line}.</span> Release sends the offer straight to the installer (the owner isn't asked again).</p>
            : batchSent ? <p className="rounded-md border px-3 py-2" data-release="batch-sent">Sent to the owner for <span className="font-semibold">{sentTo ?? batch?.details?.["installer_name"] ?? "the installer"}</span>. Waiting for the owner to confirm a few quick details.</p>
            : rel?.state === "lapsed" ? <p className="text-muted-foreground">{rel.line}.</p> : null}
          {!d.openOffer && (confirmed || waiting) && (
            <ul className="divide-y rounded-md border">
              {shown.length === 0 && <li className="px-3 py-3 text-muted-foreground">No installer can be offered {d.suburb || "this area"} right now{d.others.length ? " — show the others to see why" : ""}.</li>}
              {shown.map((t) => {
                const blocked = !!t.blocker || t.alreadyOffered === "pending" || t.alreadyOffered === "declined" || t.alreadyOffered === "accepted";
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{t.business}</p>
                      <p className="text-xs text-muted-foreground">{t.inArea ? "Services this area" : "Outside listed area"} · {t.distanceKm != null ? `${t.distanceKm} km` : t.areaNote} · {t.rate != null ? `R5 ${money(t.rate)} ${t.rateUnit}` : "No agreed rates"}</p>
                      {t.alreadyOffered === "declined" && <p className="text-xs text-muted-foreground">Said Not for me on this job</p>}
                      {t.alreadyOffered === "expired" && <p className="text-xs text-muted-foreground">Didn't answer in 24 hours last time</p>}
                      {t.blocker && <p className="text-xs text-destructive">Can't be offered: {t.blocker}</p>}
                    </div>
                    <Button size="sm" variant={blocked ? "outline" : "default"} disabled={blocked || !!busy} onClick={() => void (confirmed ? pick(t.id, t.business) : sendOne(t.id, t.business))}>{busy === t.id ? confirmed ? "Releasing…" : "Sending…" : confirmed ? "Release" : "Send"}</Button>
                  </li>
                );
              })}
            </ul>
          )}
          {!d.openOffer && (confirmed || waiting) && d.others.length > 0 && <button type="button" className="text-xs font-semibold text-primary" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show nearby only" : `Show ${d.others.length} more installer${d.others.length === 1 ? "" : "s"}`}</button>}
          {q.error && <p className="text-destructive">{(q.error as Error).message}</p>}
        </div>
      </Section>
    </div>
  );
}

/** A48 batch 2 (Jo 29–30 Oct 2026): suggested batches of nearby homes that look likely to qualify. Jo picks an installer
 *  who covers every home and taps Send; each owner gets a text to confirm a few quick details. Nothing is ever sent automatically. */
export function AreaBatchSuggestions({ includeTest = false }: { includeTest?: boolean }) {
  const qc = useQueryClient();
  const load = useServerFn(getAreaBatchSuggestions);
  const send = useServerFn(sendAreaBatchFn);
  const q = useQuery({ queryKey: ["area-batches", includeTest], queryFn: () => load({ data: { includeTest } }), staleTime: 30_000 });
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const d = q.data;
  const go = async (key: string, jobIds: string[], businessId: string, name: string) => {
    if (busy) return;
    setBusy(key);
    try {
      const r = await send({ data: { jobIds, businessId } });
      toast.success(`Sent to ${r.homes} ${r.homes === 1 ? "owner" : "owners"} for ${name}${r.held ? ` · ${r.held} text${r.held === 1 ? "" : "s"} held (see the job)` : ""}`);
      void qc.invalidateQueries({ queryKey: ["area-batches"] });
      void qc.invalidateQueries({ queryKey: ["installer-waiting"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); }
    finally { setBusy(null); }
  };
  return (
    <section aria-label="Suggested batches" className="mb-4 rounded-[18px] border border-line bg-paper p-4">
      <h2 className="font-display text-[17px] font-bold text-ink">Suggested batches</h2>
      <p className="mt-1 text-[13px] text-sub">Nearby homes that look likely to qualify. Pick an installer and tap Send — each owner gets a text to confirm a few quick details.</p>
      {q.isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">Couldn't load the batches. {(q.error as Error).message} <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Try again</button></p>
      ) : !d ? <p className="mt-3 text-sm text-sub">Loading…</p> : d.batches.length === 0 ? (
        <p className="mt-3 text-sm text-sub">No batch ready yet.{d.unlocated ? ` Still finding the location of ${d.unlocated} ${d.unlocated === 1 ? "home" : "homes"}.` : ""}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {d.batches.map((b) => {
            const key = b.homes[0]?.jobId ?? "";
            const choice = picked[key] ?? (b.installers.length === 1 ? b.installers[0]!.id : "");
            const chosen = b.installers.find((i) => i.id === choice);
            return (
              <li key={key} className="rounded-[14px] border border-line p-3" data-batch={key}>
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {b.homes.length} {b.homes.length === 1 ? "home" : "homes"} · within {b.spanKm} km
                  {b.isTest && <Pill tone="amber">TEST</Pill>}
                </p>
                <p className="text-[13px] text-sub">{b.suburbs.join(", ")}</p>
                <ul className="mt-2 text-[13px] text-sub">
                  {b.homes.map((h) => <li key={h.jobId}>{h.jobNumber} · {h.ownerName || "Owner"} · {h.suburb || h.postcode}</li>)}
                </ul>
                {b.installers.length === 0 ? <p className="mt-2 text-[13px] text-rose">No installer covers every home in this batch.</p> : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select aria-label="Installer" className="h-10 min-w-0 flex-1 rounded-[10px] border border-line bg-paper px-2 text-sm" value={choice} onChange={(e) => setPicked({ ...picked, [key]: e.target.value })}>
                      {b.installers.length > 1 && <option value="">Pick an installer</option>}
                      {b.installers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    <button type="button" className={btnClass("primary")} disabled={!chosen || !!busy} onClick={() => chosen && void go(key, b.homes.map((h) => h.jobId), chosen.id, chosen.name)}>{busy === key ? "Sending…" : "Send"}</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** A48 batch 2 (Jo 30 Oct 2026): closed batches whose owners said yes. Runs never go to an installer automatically — Jo
 *  checks the homes, picks the installer (default the one picked at Send; any installer who covers every home) and taps
 *  "Send to installer". A run whose installer text didn't go shows "Text didn't go — Send again" (same run, same installer).
 *  "Back to suggestions" puts the owners back in the suggested batches (not asked again). Nothing in Needs me. */
export function BatchesReadyToSend({ includeTest = false }: { includeTest?: boolean }) {
  const load = useServerFn(getBatchesReadyToSend);
  const offer = useServerFn(offerRunFn);
  const giveBack = useServerFn(returnBatchFn);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["area-batches", "ready", includeTest], queryFn: () => load({ data: { includeTest } }), staleTime: 30_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const d = q.data;
  // Jo's one tap: the run goes to the installer she picked. One tap at a time.
  const send = async (batchId: string, businessId: string | null) => {
    if (busy) return;
    setBusy(batchId);
    try {
      const r = await offer({ data: { batchId, businessId } });
      if (r.text.status === "sent" || r.text.status === "already") toast.success(`Sent to ${r.installer || "the installer"} — ${r.homes} ${r.homes === 1 ? "home" : "homes"}`);
      else toast.warning(`Run sent to ${r.installer || "the installer"}, but the text didn't go: ${r.text.detail}`);
      void qc.invalidateQueries();
    } catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); }
    finally { setBusy(null); }
  };
  const back = async (batchId: string) => {
    if (busy) return;
    setBusy(`back:${batchId}`);
    try {
      const r = await giveBack({ data: { batchId } });
      toast.success(`Back in the suggestions — ${r.homes} ${r.homes === 1 ? "home" : "homes"}`);
      void qc.invalidateQueries();
    } catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); }
    finally { setBusy(null); }
  };
  if (q.isError) return <p role="alert" className="mb-4 text-sm text-danger">Couldn't load the batches ready to send. {(q.error as Error).message} <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Try again</button></p>;
  if (!d || d.length === 0) return null;
  return (
    <section aria-label="Ready to send to the installer" className="mb-4 rounded-[18px] border border-line bg-paper p-4">
      <h2 className="font-display text-[17px] font-bold text-ink">Ready to send to the installer</h2>
      <p className="mt-1 text-[13px] text-sub">These owners said yes. Check the homes, then tap Send to installer.</p>
      <ul className="mt-3 space-y-3">
        {d.map((b) => {
          const unsent = b.state === "text_not_sent";
          const original = b.installers.find((i) => i.id === b.installer.id);
          const choice = unsent ? b.installer.id : picked[b.batchId] ?? (original ? original.id : b.installers.length === 1 ? b.installers[0]!.id : "");
          const chosen = unsent ? b.installer : b.installers.find((i) => i.id === choice);
          return (
            <li key={b.batchId} className="rounded-[14px] border border-line p-3" data-ready-batch={b.batchId}>
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                {b.homes.length} {b.homes.length === 1 ? "home" : "homes"} · {b.installer.name || "Installer"}
                {b.isTest && <Pill tone="amber">TEST</Pill>}
                {unsent && <Pill tone="amber">Text didn't go — Send again</Pill>}
              </p>
              <p className="text-[13px] text-sub">{[...new Set(b.homes.map((h) => [h.suburb, h.postcode].filter(Boolean).join(" ")).filter(Boolean))].sort().join(", ")}</p>
              <ul className="mt-2 text-[13px] text-sub">
                {b.homes.map((h) => <li key={h.jobId}>{h.jobNumber} · {h.ownerName || "Owner"} · {h.suburb || h.postcode}</li>)}
              </ul>
              {!unsent && !original && <p className="mt-2 text-[13px] text-rose">{b.installers.length ? `${b.installer.name || "That installer"} can't take every home now — pick another installer.` : "No installer covers every home now."}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!unsent && b.installers.length > 0 && (
                  <select aria-label="Installer" className="h-10 min-w-0 flex-1 rounded-[10px] border border-line bg-paper px-2 text-sm" value={choice} onChange={(e) => setPicked({ ...picked, [b.batchId]: e.target.value })}>
                    {!original && b.installers.length > 1 && <option value="">Pick an installer</option>}
                    {b.installers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                )}
                <button type="button" className={btnClass("primary")} disabled={!!busy || !chosen?.id} onClick={() => chosen?.id && void send(b.batchId, chosen.id)}>{busy === b.batchId ? "Sending…" : unsent ? "Send again" : "Send to installer"}</button>
                <button type="button" className={btnClass("secondary")} disabled={!!busy} onClick={() => void back(b.batchId)}>{busy === `back:${b.batchId}` ? "Saving…" : "Back to suggestions"}</button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
