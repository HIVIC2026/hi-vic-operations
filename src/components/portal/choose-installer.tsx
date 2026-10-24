// Office job page: "Choose installer" for an our-lead Ready Check (Jo 24 Oct 2026, decisions 49–51).
// Nearby approved installers with their area and rates; tapping one sends the offer to that installer only. The offer is
// open 24 hours; "Not for me" or no times in 24 hours brings the job back here. Installers' own customers never show this.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/portal/panels";
import { listChooseTrades, sendChosenOffers } from "@/lib/offer-dispatch.functions";

const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

export function ChooseInstallerPanel({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listChooseTrades);
  const send = useServerFn(sendChosenOffers);
  const q = useQuery({ queryKey: ["choose-trades", jobId, "ready_check"], queryFn: () => list({ data: { jobId, kind: "ready_check" } }) });
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const d = q.data;
  if (!d || d.channel !== "hivic_sourced" || d.stage !== "ready_check_ready_to_schedule" || d.hasInstaller) return null;
  const pick = async (id: string, name: string) => {
    if (busy) return;
    setBusy(id);
    try { await send({ data: { jobId, kind: "ready_check", businessIds: [id] } }); toast.success(`Offer sent to ${name}`); void qc.invalidateQueries(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); }
    finally { setBusy(null); }
  };
  type T = (typeof d.matching)[number];
  const shown: T[] = showAll ? [...d.matching, ...d.others] : d.matching;
  return (
    <div id="choose-installer">
      <Section title="Choose installer">
        <div className="space-y-3 text-sm">
          {d.openOffer
            ? <p className="rounded-md border px-3 py-2">Offer sent to <span className="font-semibold">{d.openOffer.business ?? "the installer"}</span>. Waiting for them to offer the owner 3 times{d.openOffer.expiresAt ? ` (closes ${when(d.openOffer.expiresAt)})` : ""}.</p>
            : <p className="text-muted-foreground">Tap an installer to send them this Ready Check. Only they get it. They have 24 hours to offer the owner 3 times.</p>}
          {!d.openOffer && (
            <ul className="divide-y rounded-md border">
              {shown.length === 0 && <li className="px-3 py-3 text-muted-foreground">No approved installers cover {d.suburb || "this area"}.</li>}
              {shown.map((t) => {
                const blocked = !!t.blocker || t.alreadyOffered === "pending" || t.alreadyOffered === "declined" || t.alreadyOffered === "accepted";
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{t.business}</p>
                      <p className="text-xs text-muted-foreground">{t.matching ? "Services this area" : "Outside listed area"} · {t.distanceKm != null ? `${t.distanceKm} km` : t.areaNote} · {t.rate != null ? `R5 ${money(t.rate)} ${t.rateUnit}` : "No agreed rates"}</p>
                      {t.alreadyOffered === "declined" && <p className="text-xs text-muted-foreground">Said Not for me on this job</p>}
                      {t.alreadyOffered === "expired" && <p className="text-xs text-muted-foreground">Didn't answer in 24 hours last time</p>}
                      {t.blocker && <p className="text-xs text-destructive">Can't be offered: {t.blocker}</p>}
                    </div>
                    <Button size="sm" variant={blocked ? "outline" : "default"} disabled={blocked || !!busy} onClick={() => void pick(t.id, t.business)}>{busy === t.id ? "Sending…" : "Send offer"}</Button>
                  </li>
                );
              })}
            </ul>
          )}
          {!d.openOffer && d.others.length > 0 && <button type="button" className="text-xs font-semibold text-primary" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show nearby only" : `Show ${d.others.length} more installer${d.others.length === 1 ? "" : "s"}`}</button>}
          {q.error && <p className="text-destructive">{(q.error as Error).message}</p>}
        </div>
      </Section>
    </div>
  );
}
