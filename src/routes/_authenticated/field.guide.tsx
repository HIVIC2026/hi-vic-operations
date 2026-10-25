import { createFileRoute, Link } from "@tanstack/react-router";
import { TradeShell } from "@/components/trade/TradeShell";
import { GUIDE_STEPS, GUIDE_WORDS } from "@/lib/trade-view.core";
import { NoFormNoPay, outlineLinkClass, Screen } from "@/components/trade/installer-kit";

export const Route = createFileRoute("/_authenticated/field/guide")({
  head: () => ({ meta: [{ title: "Installer guide – Home Insulation Victoria" }, { name: "description", content: "What every job needs so the rebate can be claimed and you get paid." }, { property: "og:title", content: "Installer guide – Home Insulation Victoria" }, { property: "og:description", content: "What every job needs so the rebate can be claimed and you get paid." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Guide,
});

// Approved state M7-guide (Jo 24 Oct 2026, decisions 21/107/145/236): five steps, the 30 days, getting paid. Static
// wording only from pure GUIDE_STEPS / GUIDE_WORDS: no job data, no onboarding checklist (collected at onboarding).
function Guide() {
  return (
    <TradeShell installer>
      <Screen>
        <Link to="/field/business" className="inline-flex min-h-9 items-center text-sm font-medium text-hiv-blue">‹ My business</Link>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[1.3px] text-hiv-blue">{GUIDE_WORDS.eyebrow}</p>
          <h1 className="mt-1 font-display text-[22px] font-semibold leading-[1.2]">{GUIDE_WORDS.title}</h1>
          <p className="mt-1 text-sm text-sub">{GUIDE_WORDS.sub}</p>
        </div>
        <ol data-guide-steps>
          {GUIDE_STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3.5 border-b border-line py-3.5">
              <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-mist text-[13px] font-bold">{i + 1}</span>
              <div className="min-w-0 flex-1"><p className="text-base font-semibold">{s.title}</p><p className="mt-1 text-sm leading-[1.5] text-sub">{s.body}</p></div>
            </li>
          ))}
        </ol>
        <section className="rounded-[18px] bg-mist p-4">
          <p className="text-[17px] font-semibold">{GUIDE_WORDS.paidTitle}</p>
          <p className="mt-1 text-sm leading-[1.5] text-sub">{GUIDE_WORDS.paidBody}</p>
        </section>
        <p className="text-sm leading-[1.5] text-sub">{GUIDE_WORDS.photos}</p>
        <p className="text-sm leading-[1.5]">{GUIDE_WORDS.pay}</p>
        {/* Decision 318: appended after the approved M7-guide wording. */}
        <NoFormNoPay />
        <Link to="/field" className={outlineLinkClass}>{GUIDE_WORDS.back}</Link>
      </Screen>
    </TradeShell>
  );
}
