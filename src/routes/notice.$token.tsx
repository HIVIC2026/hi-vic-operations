import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";
import { Button } from "@/components/trade/trade-ui";
import { Input } from "@/components/ui/input";
import { acknowledgeCollectionNoticeLink, getCollectionNoticeLink } from "@/lib/esc-collection-notice.functions";
import { COLLECTION_NOTICE_ACK_TEXT, COLLECTION_NOTICE_PARAGRAPHS } from "@/lib/esc-collection-notice.core";
import { NoticeBody, NoticeTickRow } from "@/components/portal/esc-notice-page";
import { P5 } from "@/lib/owner-pages.core";
import { readableError } from "@/lib/readable-error.core";

const NOTICE_LINK_PROBLEM = "We couldn't open this notice. Check you have the whole link from the text, or ask your business owner or the office to send a new one.";

// Decision 130: each installer person's own secure link (no login) to read the ESC notice verbatim and acknowledge it.
export const Route = createFileRoute("/notice/$token")({
  headers: () => ({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [
    { title: "ESC privacy collection notice – Home Insulation Victoria" },
    { name: "description", content: "Read and acknowledge the Essential Services Commission's VEU Scheme Participant Privacy Collection Notice." },
    { property: "og:title", content: "ESC privacy collection notice – Home Insulation Victoria" },
    { property: "og:description", content: "Read and acknowledge the Essential Services Commission's VEU Scheme Participant Privacy Collection Notice." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: NoticePage,
});

function NoticePage() {
  const { token } = Route.useParams();
  const get = useServerFn(getCollectionNoticeLink);
  const ack = useServerFn(acknowledgeCollectionNoticeLink);
  const q = useQuery({ queryKey: ["esc-notice-link", token], queryFn: () => get({ data: { token } }), retry: false });
  const [ticked, setTicked] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null); // ISO time of the acknowledgement made on this page
  const [doneNote, setDoneNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const d = q.data;
  return (
    // Approved P5 look (decision 130) on the person's own secure link: notice verbatim, their one tick row, typed name.
    <main className="estimate-brand portal-theme min-h-screen bg-paper px-4 py-6 text-ink">
      <div className="mx-auto max-w-[560px]">
        <img src={logo.url} alt="Home Insulation Victoria" className="h-9 w-auto" />
        <h1 className="mt-4 font-display text-[22px] font-semibold leading-tight">{P5.title}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-sub">{P5.sub}</p>
        {q.error && <p role="alert" className="mt-4 rounded-[12px] border border-line bg-paper p-4 text-sm">{readableError(q.error, NOTICE_LINK_PROBLEM)}</p>}
        {!q.error && !d && <p className="mt-4 text-sm">Loading…</p>}
        {d && <>
          <p className="mt-4 text-sm leading-relaxed">Hi {d.name.split(/\s+/)[0]}, before Home Insulation Victoria can register you as a VEU installer for {d.business}, the Essential Services Commission requires you to be given this notice. Please read it and tick below.</p>
          <div className="mt-[18px]"><NoticeBody paragraphs={COLLECTION_NOTICE_PARAGRAPHS} /></div>
          {d.state === "expired" && !done && <p role="alert" className="mt-4 rounded-[12px] bg-pink p-4 text-sm font-bold">This link has expired. Ask your business owner or the office to send a new one.</p>}
          {d.state !== "expired" && <section className="mt-[22px]" data-esc-ack>
            <h2 className="font-display text-[15px] font-semibold">{P5.yourInstallers}</h2>
            <ul><NoticeTickRow name={d.name} text={COLLECTION_NOTICE_ACK_TEXT} on={d.state === "acknowledged" || !!done || ticked} canTick={d.state === "open" && !done} disabled={busy} onChange={setTicked} acknowledgedAt={d.state === "acknowledged" ? d.acknowledgedAt ?? null : done} /></ul>
            {(d.state === "acknowledged" || done) && <p role="status" className="mt-3 text-sm font-bold text-hiv-green">Thank you — acknowledged{doneNote}. Nothing more to do.</p>}
            {d.state === "open" && !done && <>
              <label className="mt-3 block text-sm font-semibold">Type your full name<Input className="mt-1 h-12" value={name} onChange={(e) => setName(e.target.value)} placeholder={d.name} autoComplete="name" disabled={busy} /></label>
              <p className="mt-3 text-[13px] leading-relaxed text-sub">{P5.note}<b>{P5.noteTeam}</b>{P5.noteEnd}</p>
              <Button className="mt-[18px] h-12 w-full" disabled={!ticked || name.trim().length < 2 || busy} onClick={async () => {
                setBusy(true); setErr(null);
                try { const r = await ack({ data: { token, ticked, typedName: name } }); setDone(r.at); setDoneNote(r.email.status === "sent" ? ". A copy has been emailed to you" : ""); }
                catch (e) { setErr(readableError(e, "Your acknowledgement wasn't saved. Check your connection and try again.")); } finally { setBusy(false); }
              }}>{busy ? P5.saving : P5.button}</Button>
              {err && <p role="alert" className="mt-2 text-sm font-bold text-rose">{err}</p>}
            </>}
          </section>}
        </>}
        <p className="mt-6 text-xs text-sub">Questions? Email info@homeinsulationvictoria.com.au. The commission's own contact for privacy questions is in the notice above.</p>
      </div>
    </main>
  );
}
