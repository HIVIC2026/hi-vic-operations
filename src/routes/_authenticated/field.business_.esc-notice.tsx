import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { TradeShell, card, greenBtn } from "@/components/trade/TradeShell";
import { acknowledgeTradeCollectionNotice, getTradeCollectionNotice } from "@/lib/trade-view.functions";
import { COLLECTION_NOTICE_ACK_TEXT, COLLECTION_NOTICE_PARAGRAPHS } from "@/lib/esc-collection-notice.core";
import { SendNoticeLinkInline } from "@/components/portal/worker-compliance";
import { NoticeBody, NoticeTickRow } from "@/components/portal/esc-notice-page";
import { P5 } from "@/lib/owner-pages.core";

export const Route = createFileRoute("/_authenticated/field/business_/esc-notice")({
  head: () => ({ meta: [{ title: "ESC privacy notice – Home Insulation Victoria" }, { name: "description", content: "The Essential Services Commission's VEU Scheme Participant Privacy Collection Notice." }, { property: "og:title", content: "ESC privacy notice – Home Insulation Victoria" }, { property: "og:description", content: "The Essential Services Commission's VEU Scheme Participant Privacy Collection Notice." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: EscNotice,
});

/** Every installer person reads the notice and ticks for themself; the boss sees who still has to. Office sees the same states. */
function EscNotice() {
  const load = useServerFn(getTradeCollectionNotice);
  const ack = useServerFn(acknowledgeTradeCollectionNotice);
  const { data, error, refetch } = useQuery({ queryKey: ["trade-esc-notice"], queryFn: () => load() });
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const installer = data?.kind !== "electrician";
  const mine = data?.statuses.find((s) => s.workerId === data.selfWorkerId) ?? null;
  // Approved P5 page (decision 130): the notice verbatim, then one row per installer person. Only the signed-in person's
  // own row can be ticked (nobody ticks for someone else); "Save acknowledgements" records that one tick.
  const mineOpen = !!mine && mine.state !== "acknowledged";
  return (
    <TradeShell installer={installer} boss={data?.boss}>
      <Link to="/field/business" className="inline-flex min-h-11 items-center text-sm text-hiv-blue"><ChevronLeft className="h-4 w-4" />My business</Link>
      <div><h1 className="font-display text-[22px] font-semibold leading-tight">{P5.title}</h1><p className="mt-1.5 text-sm leading-relaxed text-sub">{P5.sub}</p></div>
      {error ? <p role="alert" className={card}>{(error as Error).message}</p> : !data ? <p className="text-sm">Loading…</p> : (<>
        <NoticeBody paragraphs={COLLECTION_NOTICE_PARAGRAPHS} />
        {(data.boss || mine) && <section data-esc-ack>
          <h2 className="font-display text-[15px] font-semibold">{P5.yourInstallers}</h2>
          <ul>
            {data.statuses.map((s, i) => {
              const self = !!s.workerId && s.workerId === data.selfWorkerId;
              return <NoticeTickRow key={s.email} name={`${s.name}${i === 0 && data.boss ? P5.leadSuffix : ""}`} text={COLLECTION_NOTICE_ACK_TEXT}
                on={s.state === "acknowledged" || (self && ticked)} canTick={self && s.state !== "acknowledged"} disabled={busy} onChange={setTicked}
                acknowledgedAt={s.state === "acknowledged" ? s.at : null}
                action={s.state !== "acknowledged" && !self && s.workerId && data.boss ? <SendNoticeLinkInline workerId={s.workerId} /> : null} />;
            })}
            {!data.statuses.length && <li className={`${card} mt-2 text-sm text-sub`}>No installers listed yet.</li>}
          </ul>
          <p className="mt-3 text-[13px] leading-relaxed text-sub">{P5.note}<b>{P5.noteTeam}</b>{P5.noteEnd}</p>
          {mineOpen && <button type="button" className={`${greenBtn} mt-[18px] md:w-full`} disabled={!ticked || busy} onClick={async () => { setBusy(true); setMsg(null); try { const r = await ack(); setMsg(r.email.status === "sent" ? "Acknowledged. A copy has been emailed to you." : "Acknowledged and recorded."); await refetch(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } }}>{busy ? P5.saving : P5.button}</button>}
          {msg && <p role="status" className="mt-2 text-sm font-bold text-estimate-green">{msg}</p>}
        </section>}
        {!mine && !data.boss && <p className="text-sm text-sub">You're not listed as an installer for this business, so there's nothing to acknowledge.</p>}
      </>)}
    </TradeShell>
  );
}
