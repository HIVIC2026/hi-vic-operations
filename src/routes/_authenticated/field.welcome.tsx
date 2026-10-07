import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Check } from "lucide-react";
import { TradeShell, card, greenBtn } from "@/components/trade/TradeShell";
import { getTradeSetupView, markTradeSetup } from "@/lib/trade-view.functions";
import { SETUP_STEPS, setupComplete, type SetupKey } from "@/lib/trade-view.core";

export const Route = createFileRoute("/_authenticated/field/welcome")({
  head: () => ({ meta: [{ title: "You're approved – Home Insulation Victoria" }, { name: "description", content: "A couple of minutes and you're ready for job alerts." }, { property: "og:title", content: "You're approved – Home Insulation Victoria" }, { property: "og:description", content: "A couple of minutes and you're ready for job alerts." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Welcome,
});

function Welcome() {
  const load = useServerFn(getTradeSetupView);
  const mark = useServerFn(markTradeSetup);
  const { data, error, refetch } = useQuery({ queryKey: ["trade-setup-v2"], queryFn: () => load() });
  const [stage, setStage] = useState<"approved" | "list" | "done">("approved");
  if (error) return <TradeShell installer={false}><p role="alert" className={card}>{(error as Error).message}</p></TradeShell>;
  if (!data) return <TradeShell installer={false}><p className="text-sm">Loading…</p></TradeShell>;
  const installer = data.kind === "installer";
  const detail: Record<SetupKey, string> = {
    details: `${data.firstName ?? "—"} · ${data.mobile ?? "no mobile yet"} · ${data.email ?? ""}`,
    rates: installer ? `Your install rates · ${data.area}` : `Safety check ${data.rate != null ? `$${data.rate}` : "rate to confirm"} · ${data.area}`,
    bank: data.bankSaved ? "Saved" : "Add where we pay you",
    alerts: "Texts go to your mobile. Keep them on, first in, best dressed.",
    mitti: "Download Mitti and sign in with this email. Your forms open from each job page.",
    team: installer ? "Optional. Invite your installers so they see their jobs." : "Optional. Invite your sparkies so they see their jobs.",
  };
  const link: Partial<Record<SetupKey, string>> = { bank: "/field/business/bank", team: "/field/business/team" };
  if (stage === "approved") return (
    <TradeShell installer={installer} boss>
      <section className="rounded-[22px] bg-estimate-green p-6 text-white"><p className="font-display text-3xl font-extrabold">You're approved</p><p className="mt-1 text-sm font-semibold">{data.business} is ready to take {installer ? "Ready Checks and installs" : "safety checks"} from Home Insulation Victoria.</p></section>
      <section className={card}><p className="text-sm">A couple of minutes and you're ready for job alerts.</p></section>
      <button type="button" className={greenBtn} onClick={() => setStage("list")}>Let's set you up</button>
    </TradeShell>
  );
  if (stage === "done") return (
    <TradeShell installer={installer} boss>
      <section className="rounded-[22px] bg-estimate-green p-6 text-white"><p className="font-display text-3xl font-extrabold">You're all set</p><p className="text-sm">Job alerts are on for {data.business}.</p></section>
      <section className={card}>
        <h2 className="font-display text-lg font-extrabold">How it works</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">{(installer
          ? ["We text you a fresh Ready Check near you.", "Tap one of the owner's times. First tap books it.", "Measure and quote in Mitti on the day.", "Owner says yes? The install comes straight back to you.", "Your pay shows in Money once the office signs it off."]
          : ["We text you a fresh job near you, with your pay.", "Tap one of the owner's times. First tap books it.", "We remind you the day before.", "On the day: phone check, then Start check in Mitti.", "All clear? Your pay shows in Money once the office signs it off."]).map((s) => <li key={s}>{s}</li>)}</ol>
      </section>
      <Link to="/field" className={greenBtn}>Go to my work</Link>
    </TradeShell>
  );
  const done = data.done as Partial<Record<SetupKey, boolean>>;
  return (
    <TradeShell installer={installer} boss>
      <div><h1 className="font-display text-2xl font-extrabold">Quick setup</h1><p className="text-sm">Tick each one as you go.</p></div>
      <div className="space-y-2">{SETUP_STEPS.map((s) => { const on = !!done[s.key]; return (
        <div key={s.key} className="flex items-start gap-3 rounded-[22px] bg-card p-4 shadow-sm">
          <button type="button" aria-label={`Mark ${s.title} done`} aria-pressed={on} onClick={async () => { await mark({ data: { key: s.key, done: !on } }); await refetch(); }} className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-estimate-green bg-estimate-green text-white" : "border-estimate-line"}`}>{on && <Check className="h-5 w-5" />}</button>
          <div className="min-w-0 flex-1"><p className="font-bold">{s.title}{"optional" in s && s.optional ? " (optional)" : ""}</p><p className="text-sm text-estimate-navy/70">{detail[s.key]}</p>{link[s.key] && <Link to={link[s.key] as never} className="text-sm font-bold text-estimate-blue">Open</Link>}</div>
        </div>); })}</div>
      <button type="button" className={greenBtn} disabled={!setupComplete(done)} onClick={() => setStage("done")}>{setupComplete(done) ? "Finish" : "Tick each step to finish"}</button>
    </TradeShell>
  );
}
