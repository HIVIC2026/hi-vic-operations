import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import logo from "@/assets/home-insulation-victoria-logo.png.asset.json";
import { Button } from "@/components/trade/trade-ui";
import { Input } from "@/components/ui/input";
import { acknowledgeCollectionNoticeLink, getCollectionNoticeLink } from "@/lib/esc-collection-notice.functions";
import { COLLECTION_NOTICE_ACK_TEXT, COLLECTION_NOTICE_PARAGRAPHS } from "@/lib/esc-collection-notice.core";

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
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const d = q.data;
  return (
    <main className="estimate-brand min-h-screen bg-[#FBFCFA] px-4 py-8 text-[#22376B]">
      <div className="mx-auto max-w-[560px] space-y-5">
        <img src={logo.url} alt="Home Insulation Victoria" className="h-10 w-auto" />
        <h1 className="font-display text-[26px] font-bold leading-tight">ESC privacy collection notice</h1>
        {q.error && <p role="alert" className="rounded-[18px] border border-[#E4E9F5] bg-white p-5 text-sm">{(q.error as Error).message}</p>}
        {!q.error && !d && <p className="text-sm">Loading…</p>}
        {d && <>
          <p className="text-sm">Hi {d.name.split(/\s+/)[0]}, before Home Insulation Victoria can register you as a VEU installer for {d.business}, the Essential Services Commission requires you to be given this notice. Please read it and tick below.</p>
          <section className="max-h-[420px] overflow-y-auto rounded-[18px] border border-[#E4E9F5] bg-white p-5 text-[14px] leading-relaxed shadow-sm" data-esc-notice>
            {COLLECTION_NOTICE_PARAGRAPHS.map((p, i) => p.kind === "heading" ? <h2 key={i} className="font-display text-lg font-bold">{p.text}</h2>
              : p.kind === "version" ? <p key={i} className="mb-3 text-sm text-[#5B6B8C]">{p.text}</p>
              : p.kind === "li" || p.kind === "li2" ? <p key={i} className={`mb-1.5 ${p.kind === "li2" ? "pl-9" : "pl-4"}`}>• {p.text}</p>
              : <p key={i} className="mb-3">{p.text}</p>)}
          </section>
          {(d.state === "acknowledged" || done) && <p role="status" className="rounded-[18px] bg-[#EDFAF2] p-5 text-sm font-bold text-[#07864B]">Thank you — acknowledged{done ?? (d.acknowledgedAt ? ` on ${new Date(d.acknowledgedAt).toLocaleDateString("en-AU")}` : "")}. Nothing more to do.</p>}
          {d.state === "expired" && !done && <p role="alert" className="rounded-[18px] bg-[#FCE7F0] p-5 text-sm font-bold">This link has expired. Ask your business owner or the office to send a new one.</p>}
          {d.state === "open" && !done && <section className="space-y-3 rounded-[18px] border border-[#E4E9F5] bg-white p-5 shadow-sm" data-esc-ack>
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={ticked} disabled={busy} onChange={(e) => setTicked(e.target.checked)} /><span>{COLLECTION_NOTICE_ACK_TEXT}</span></label>
            <label className="block text-sm font-semibold">Type your full name<Input className="mt-1 h-12" value={name} onChange={(e) => setName(e.target.value)} placeholder={d.name} autoComplete="name" disabled={busy} /></label>
            <Button className="h-12 w-full" disabled={!ticked || name.trim().length < 2 || busy} onClick={async () => {
              setBusy(true); setErr(null);
              try { const r = await ack({ data: { token, ticked, typedName: name } }); setDone(` on ${new Date(r.at).toLocaleDateString("en-AU")}${r.email.status === "sent" ? ". A copy has been emailed to you" : ""}`); }
              catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
            }}>{busy ? "Saving…" : "Acknowledge"}</Button>
            {err && <p role="alert" className="text-sm font-bold text-[#B3261E]">{err}</p>}
          </section>}
        </>}
        <p className="text-xs text-[#5B6B8C]">Questions? Email info@homeinsulationvictoria.com.au. The commission's own contact for privacy questions is in the notice above.</p>
      </div>
    </main>
  );
}
