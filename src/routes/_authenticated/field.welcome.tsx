import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TradeShell, card, greenBtn } from "@/components/trade/TradeShell";
import { getTradeSetupView } from "@/lib/trade-view.functions";

export const Route = createFileRoute("/_authenticated/field/welcome")({
  head: () => ({ meta: [{ title: "You're approved – Home Insulation Victoria" }, { name: "description", content: "Your business is approved and ready for work." }, { property: "og:title", content: "You're approved – Home Insulation Victoria" }, { property: "og:description", content: "Your business is approved and ready for work." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Welcome,
});

// Jo's rule: never ask a partner to re-enter anything from onboarding. No setup checklist — approved, then straight to My work.
function Welcome() {
  const load = useServerFn(getTradeSetupView);
  const { data, error } = useQuery({ queryKey: ["trade-setup-v2"], queryFn: () => load() });
  if (error) return <TradeShell installer={false}><p role="alert" className={card}>{(error as Error).message}</p></TradeShell>;
  if (!data) return <TradeShell installer={false}><p className="text-sm">Loading…</p></TradeShell>;
  const installer = data.kind === "installer";
  return (
    <TradeShell installer={installer} boss>
      <section className="rounded-[18px] bg-estimate-green p-6 text-white"><p className="font-display text-[26px] font-bold leading-tight">You're approved</p><p className="mt-1 text-sm font-semibold">{data.business} is ready to take {installer ? "Ready Checks and installs" : "PIESAs"} from Home Insulation Victoria.</p></section>
      <section className={card}><p className="text-sm">Everything from your application — business details, rates, area, bank details, insurance, licences, team and agreement — is already loaded. You can see it any time under My business.</p></section>
      <Link to="/field" className={greenBtn}>Go to my work</Link>
    </TradeShell>
  );
}
