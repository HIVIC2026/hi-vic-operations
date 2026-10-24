import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { TradeShell, card, greenBtn } from "@/components/trade/TradeShell";
import { acknowledgeTradeCollectionNotice, getTradeCollectionNotice } from "@/lib/trade-view.functions";
import { COLLECTION_NOTICE_ACK_TEXT, COLLECTION_NOTICE_PARAGRAPHS, collectionNoticeLabel } from "@/lib/esc-collection-notice.core";
import { SendNoticeLinkInline } from "@/components/portal/worker-compliance";

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
  const pill = (state: string) => <span className={`rounded-[18px] px-2.5 py-0.5 text-[11px] font-semibold ${state === "acknowledged" ? "bg-estimate-green-soft text-estimate-green" : "bg-owner-house-pink"}`}>{state === "acknowledged" ? "Acknowledged" : "To do"}</span>;
  return (
    <TradeShell installer={installer} boss={data?.boss}>
      <Link to="/field/business" className="inline-flex items-center gap-1 text-sm font-bold text-estimate-blue"><ChevronLeft className="h-4 w-4" />My business</Link>
      <div><h1 className="font-display text-[26px] font-bold leading-tight">ESC privacy notice</h1><p className="mt-1 text-sm text-sub">The Essential Services Commission requires every installer to be given this notice before we register them in the VEU Registry. Please read and acknowledge it.</p></div>
      {error ? <p role="alert" className={card}>{(error as Error).message}</p> : !data ? <p className="text-sm">Loading…</p> : (<>
        <section className={`${card} max-h-[420px] overflow-y-auto text-[14px] leading-relaxed`} data-esc-notice>
          {COLLECTION_NOTICE_PARAGRAPHS.map((p, i) => p.kind === "heading" ? <h2 key={i} className="font-display text-lg font-bold">{p.text}</h2>
            : p.kind === "version" ? <p key={i} className="mb-3 text-sm text-sub">{p.text}</p>
            : p.kind === "li" || p.kind === "li2" ? <p key={i} className={`mb-1.5 ${p.kind === "li2" ? "pl-9" : "pl-4"}`}>• {p.text}</p>
            : <p key={i} className="mb-3">{p.text}</p>)}
        </section>
        {mine && mine.state !== "acknowledged" && <section className={`${card} space-y-3`} data-esc-ack>
          <p className="font-bold">Please read and acknowledge</p>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={ticked} disabled={busy} onChange={(e) => setTicked(e.target.checked)} /><span>{COLLECTION_NOTICE_ACK_TEXT}</span></label>
          <button type="button" className={greenBtn} disabled={!ticked || busy} onClick={async () => { setBusy(true); setMsg(null); try { const r = await ack(); setMsg(r.email.status === "sent" ? "Acknowledged. A copy has been emailed to you." : "Acknowledged and recorded."); await refetch(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } }}>{busy ? "Saving…" : "Acknowledge"}</button>
          {msg && <p role="status" className="text-sm font-bold text-estimate-green">{msg}</p>}
        </section>}
        {mine?.state === "acknowledged" && <p className="text-sm font-bold text-estimate-green">{collectionNoticeLabel(mine)} — thank you.</p>}
        {!mine && !data.boss && <p className="text-sm text-sub">You're not listed as an installer for this business, so there's nothing to acknowledge.</p>}
        {data.boss && <section>
          <h2 className="mb-2 font-bold">Your installers</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-[18px] border border-line bg-paper shadow-card">
            {data.statuses.map((s) => <li key={s.email} className="flex flex-wrap items-center justify-between gap-3 p-4"><span><span className="block font-bold">{s.name}</span><span className="block text-sm text-sub">{collectionNoticeLabel(s)}{s.state !== "acknowledged" && s.workerId !== data.selfWorkerId ? " · they get their own link by text and email; only they can tick it" : ""}</span></span><span className="flex items-center gap-2">{pill(s.state)}{s.state !== "acknowledged" && s.workerId && s.workerId !== data.selfWorkerId && <SendNoticeLinkInline workerId={s.workerId} />}</span></li>)}
            {!data.statuses.length && <li className="p-4 text-sm text-sub">No installers listed yet.</li>}
          </ul>
        </section>}
      </>)}
    </TradeShell>
  );
}
