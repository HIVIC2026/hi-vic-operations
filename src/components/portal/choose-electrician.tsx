// O2 PIESA card: "Choose electrician" (decisions 157/173). The installer's usual electrician (an approved REC) is
// pre-marked at the top; tapping one sends the PIESA offer to that electrician only. No multi-tick, no "Send to all",
// no office-picks switch (retired with the automatic dispatch). The 24-hour rule and acceptance stay server-side.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listChooseTrades, sendChosenOffers } from "@/lib/offer-dispatch.functions";
import { cn } from "@/lib/utils";

const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");

export function ChooseElectricianPanel({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listChooseTrades);
  const send = useServerFn(sendChosenOffers);
  const q = useQuery({ queryKey: ["choose-trades", jobId, "piesa"], queryFn: () => list({ data: { jobId, kind: "piesa" } }) });
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const d = q.data;
  if (q.error) return <p className="text-sm text-danger">{(q.error as Error).message}</p>;
  if (!d) return <p className="text-sm text-sub">Finding approved electricians…</p>;
  const pick = async (id: string, name: string) => {
    if (busy) return;
    setBusy(id);
    try { await send({ data: { jobId, kind: "piesa", businessIds: [id] } }); toast.success(`PIESA offer sent to ${name}`); void qc.invalidateQueries(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); }
    finally { setBusy(null); }
  };
  type T = (typeof d.matching)[number];
  const shown: T[] = showAll ? [...d.matching, ...d.others] : d.matching;
  return (
    <div id="choose-electrician" className="space-y-3 text-sm">
      <h4 className="font-semibold">Choose electrician</h4>
      {d.openOffer
        ? <p className="rounded-[10px] border border-line px-3 py-2">Offer sent to <span className="font-semibold">{d.openOffer.business ?? "the electrician"}</span>{d.openOffer.expiresAt ? ` · closes ${when(d.openOffer.expiresAt)}` : ""}. If they say Not for me or don't answer in 24 hours, the job comes back to Needs me.</p>
        : <p className="text-sub">Tap one electrician to send them the PIESA. Only they get it.{d.ownerPrice != null ? ` Owner pays ${money(d.ownerPrice)}.` : ""}</p>}
      {d.usualElectricianNote && <p className="rounded-[10px] bg-mint px-3 py-2 text-xs">{d.usualElectricianNote}</p>}
      {!d.openOffer && (
        <ul className="divide-y divide-line rounded-[12px] border border-line">
          {shown.length === 0 && <li className="px-3 py-3 text-sub">No approved electricians cover {d.suburb || "this area"}.</li>}
          {shown.map((t) => {
            const blocked = !!t.blocker || ["pending", "declined", "accepted"].includes(String(t.alreadyOffered));
            return (
              <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">{t.business}{t.usualElectrician && <span className="ml-2 rounded-full bg-mint px-2 py-0.5 text-[11px] font-semibold text-hiv-green">Usual electrician · pre-marked</span>}</p>
                  <p className="text-xs text-sub">{t.matching ? "Covers this area" : "Outside listed area"} · {t.distanceKm != null ? `${t.distanceKm} km` : t.areaNote} · {t.rate != null ? `PIESA ${money(t.rate)}` : "rate not recorded"}</p>
                  {t.alreadyOffered === "declined" && <p className="text-xs text-sub">Said Not for me on this job</p>}
                  {t.alreadyOffered === "expired" && <p className="text-xs text-sub">Didn't answer in 24 hours last time</p>}
                  {t.blocker && <p className="text-xs text-danger">Can't be offered: {t.blocker}</p>}
                  {t.warnings.length > 0 && <p className="text-xs text-danger">⚠ {t.warnings.join(" · ")}</p>}
                </div>
                <button type="button" disabled={blocked || !!busy} onClick={() => void pick(t.id, t.business)} className={cn("min-h-[38px] shrink-0 rounded-[10px] px-3.5 text-[13px] font-bold disabled:opacity-50", t.usualElectrician ? "bg-hiv-green text-white" : "border border-line bg-paper text-hiv-blue")}>{busy === t.id ? "Sending…" : "Send offer"}</button>
              </li>
            );
          })}
        </ul>
      )}
      {!d.openOffer && d.others.length > 0 && <button type="button" className="text-xs font-semibold text-hiv-blue" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show matching only" : `Show ${d.others.length} more electrician${d.others.length === 1 ? "" : "s"}`}</button>}
    </div>
  );
}
