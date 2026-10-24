import { createFileRoute, Link } from "@tanstack/react-router";
import { TradeShell, card, ghostBtn } from "@/components/trade/TradeShell";

export const Route = createFileRoute("/_authenticated/field/guide")({
  head: () => ({ meta: [{ title: "Installer guide – Home Insulation Victoria" }, { name: "description", content: "What every job needs so the rebate can be claimed and you get paid." }, { property: "og:title", content: "Installer guide – Home Insulation Victoria" }, { property: "og:description", content: "What every job needs so the rebate can be claimed and you get paid." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Guide,
});

// Jo approved 24 Oct 2026 (decision 145; docs/templates/approved/G55-installer-guide.html). Static wording only: no job data,
// no onboarding checklist (collected at onboarding).
const STEPS: { title: string; who: string; body: React.ReactNode; photos?: string[] }[] = [
  { title: "The job starts", who: "You · installer portal", body: <><p><b>Your own customer:</b> tap <b>Add a job</b> and enter their details exactly and in full.</p><p className="mt-1.5"><b>Our lead:</b> we text and email you the job. Offer the owner three Ready Check times within 24 hours.</p></> },
  { title: "Ready Check", who: "You · Mitti", body: <p>Fill in as much as you can. Press <b>Complete</b> only when it's finished: that sends the owner their quote.</p> },
  { title: "Electrical safety check", who: "Electrician", body: <p>We arrange it once the owner accepts. You get the PIESA at least 24 hours before install.</p> },
  { title: "Install day", who: "You · Mitti", body: <p>Follow the install form from the 6:30am text, top to bottom: SWMS, PIISA, then the photos.</p>, photos: ["Crew with photo ID", "Switchboard locked out", "Product label", "Before video", "New depth, with ruler", "360° finished video", "Floor plan"] },
  { title: "Sign off", who: "You · installer portal", body: <p>Press <b>Complete</b> in Mitti, then sign your part of the rebate form on the job.</p> },
];

function Guide() {
  return (
    <TradeShell installer>
      <section className={card}>
        <p className="text-xs font-bold tracking-[0.08em] text-estimate-green">INSTALLER GUIDE</p>
        <h1 className="mt-1 font-display text-[26px] font-bold leading-tight text-ink">Getting every job paid</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-sub">We check every form and photo before we claim the rebate. If anything's missing, we can't claim it, and the job can't be paid.</p>
      </section>
      <section className={card}>
        <h2 className="text-lg font-bold text-ink">Every job</h2>
        <ol className="mt-2">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3.5 border-t border-line py-4 first:border-t-0">
              <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-ink text-[13px] font-bold text-paper">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-ink">{s.title}</p>
                <p className="text-xs text-sub">{s.who}</p>
                <div className="mt-1.5 text-[15px] leading-relaxed text-ink">{s.body}</div>
                {s.photos ? <div className="mt-2 flex flex-wrap gap-1">{s.photos.map((p) => <span key={p} className="rounded-md bg-mist px-2 py-0.5 text-xs text-ink">{p}</span>)}</div> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="rounded-[18px] bg-amber-50 p-[19px]">
        <p className="font-bold text-amber-800">30-day rule</p>
        <p className="mt-1 text-sm leading-relaxed text-amber-900">Install within 30 days of the electrical safety check, or a new one is needed. Book install days promptly.</p>
      </section>
      <p className="px-1 text-sm leading-relaxed text-sub">Photos must be taken live at the property on the day (geotagged and timed). The lead installer signs personally.</p>
      <section className="rounded-[18px] bg-emerald-50 p-[19px] text-sm leading-relaxed text-emerald-900"><b>Getting paid:</b> your customers when the owner pays the balance; our leads 7 days after we approve the job. We never mark up your price.</section>
      <Link to="/field" className={ghostBtn}>Back to my work</Link>
    </TradeShell>
  );
}
