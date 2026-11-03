// The electrician's no-login job page. The token in the address is the only credential (electrician-link.server.ts).
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { TradePublicShell } from "@/components/trade/TradeShell";
import { ElectricianLinkBody } from "@/components/trade/ElectricianLinkBody";
import { getElectricianLinkView } from "@/lib/electrician-link.functions";
import { readableError } from "@/lib/readable-error.core";

const E_LINK_PROBLEM = "We couldn't open this job. Check you have the whole link from the text, or ask your installer to send it again.";

export const Route = createFileRoute("/e/$token")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Your job – Home Insulation Victoria" },
    { name: "description", content: "Your safety check job." },
    { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" },
    { property: "og:title", content: "Your job – Home Insulation Victoria" },
    { property: "og:description", content: "Your safety check job." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: ElectricianLink,
});

function ElectricianLink() {
  const { token } = Route.useParams();
  const q = useQuery({ queryKey: ["electrician-link", token], queryFn: () => getElectricianLinkView({ data: { token } }), retry: false });
  if (q.error) return <TradePublicShell><section className="rounded-[18px] border border-rose bg-pink p-5 text-ink" data-electrician-link-invalid><h1 className="font-display text-2xl font-bold">This link can't be opened.</h1><p className="mt-1 text-sm">{readableError(q.error, E_LINK_PROBLEM)}</p></section></TradePublicShell>;
  if (!q.data) return <TradePublicShell><p className="text-sm text-sub">Loading your job…</p></TradePublicShell>;
  return <TradePublicShell><ElectricianLinkBody d={q.data} /></TradePublicShell>;
}
