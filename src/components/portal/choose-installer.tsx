// Office job page: "Choose installer" for an our-lead Ready Check (Jo 24 Oct 2026, decisions 49–51).
// Nearby approved installers with their area and rates. Decision 389 (Jo 25 Oct 2026): tapping Release records the
// installer as a PENDING release and sends the OWNER "It's your turn"; the installer is offered the job (open 24 hours)
// only once the owner confirms. A confirmed owner whose installer said Not for me / didn't answer is not asked again:
// Release goes straight to the installer. Installers' own customers never show this.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/portal/panels";
import { listChooseTrades } from "@/lib/offer-dispatch.functions";
import { getSpotRelease, releaseSpotFn } from "@/lib/spot-release.functions";
import { btnClass } from "@/components/portal/kit";
import { CHOOSE_LOAD_FAILED, choosePanelState } from "@/lib/installer-waiting-columns.core";

const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

/** `reportLoad`: the Choose installer pop-up (the job is known to be waiting) says when the list is loading or failed,
 *  instead of a blank box. The job page leaves it off: there the panel only appears for jobs at this step. */
export function ChooseInstallerPanel({ jobId, reportLoad = false }: { jobId: string; reportLoad?: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listChooseTrades);
  const release = useServerFn(releaseSpotFn);
  const loadRelease = useServerFn(getSpotRelease);
  const q = useQuery({ queryKey: ["choose-trades", jobId, "ready_check"], queryFn: () => list({ data: { jobId, kind: "ready_check" } }) });
  const rq = useQuery({ queryKey: ["spot-release", jobId], queryFn: () => loadRelease({ data: { jobId } }) });
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
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
  return (
    <div id="choose-installer">
      <Section title="Choose installer">
        <div className="space-y-3 text-sm">
          {d.openOffer
            ? <p className="rounded-md border px-3 py-2">Offer sent to <span className="font-semibold">{d.openOffer.business ?? "the installer"}</span>. Waiting for them to offer the owner 3 times{d.openOffer.expiresAt ? ` (closes ${when(d.openOffer.expiresAt)})` : ""}.</p>
            : pending ? <p className="rounded-md border px-3 py-2" data-release="pending">{rel?.line}. The installer is offered the job only once the owner confirms.</p>
            : confirmed ? <p className="rounded-md border px-3 py-2" data-release="confirmed"><span className="font-semibold">{rel?.line}.</span> Release sends the offer straight to the installer (the owner isn't asked again).</p>
            : <p className="text-muted-foreground">{rel?.state === "lapsed" ? `${rel.line}. ` : ""}Tap Release next to an installer: the owner gets "It's your turn" and confirms first. Only then does that installer get the offer (24 hours to offer the owner 3 times).</p>}
          {!d.openOffer && !pending && (
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
                    <Button size="sm" variant={blocked ? "outline" : "default"} disabled={blocked || !!busy} onClick={() => void pick(t.id, t.business)}>{busy === t.id ? "Releasing…" : "Release"}</Button>
                  </li>
                );
              })}
            </ul>
          )}
          {!d.openOffer && !pending && d.others.length > 0 && <button type="button" className="text-xs font-semibold text-primary" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show nearby only" : `Show ${d.others.length} more installer${d.others.length === 1 ? "" : "s"}`}</button>}
          {q.error && <p className="text-destructive">{(q.error as Error).message}</p>}
        </div>
      </Section>
    </div>
  );
}
