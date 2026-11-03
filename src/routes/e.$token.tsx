// The electrician's no-login job page. The token in the address is the only credential (electrician-link.server.ts).
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TradePublicShell } from "@/components/trade/TradeShell";
import { ElectricianLinkBody } from "@/components/trade/ElectricianLinkBody";
import { bookElectricianLinkVisit, electricianCantDoByLink, getElectricianLinkView, uploadCoesByLink } from "@/lib/electrician-link.functions";
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
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["electrician-link", token], queryFn: () => getElectricianLinkView({ data: { token } }), retry: false });
  if (q.error) return <TradePublicShell><section className="rounded-[18px] border border-rose bg-pink p-5 text-ink" data-electrician-link-invalid><h1 className="font-display text-2xl font-bold">This link can't be opened.</h1><p className="mt-1 text-sm">{readableError(q.error, E_LINK_PROBLEM)}</p></section></TradePublicShell>;
  if (!q.data) return <TradePublicShell><p className="text-sm text-sub">Loading your job…</p></TradePublicShell>;
  // Which visit the Book button makes comes from the step the server returned; the server re-checks everything.
  const kind = q.data.view.step === "set_upgrades_day" || q.data.view.step === "upgrades_day" ? "rectification" : "assessment";
  const onBook = async (start: string) => {
    const r = await bookElectricianLinkVisit({ data: { token, kind, start } });
    if (r.ok) await qc.invalidateQueries({ queryKey: ["electrician-link", token] });
    return r;
  };
  // The file goes up as text; the token alone names the job. The server checks the type, size and link again.
  const onUpload = async (file: File) => {
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
      r.onerror = () => reject(new Error("read"));
      r.readAsDataURL(file);
    });
    const res = await uploadCoesByLink({ data: { token, name: file.name, type: file.type, data } });
    if (res.ok) await qc.invalidateQueries({ queryKey: ["electrician-link", token] });
    return res;
  };
  // "Can't do this one": the server cancels their booking, takes them off the job and switches this link off; the reload then shows that.
  const onCantDo = async (reason: string) => {
    const r = await electricianCantDoByLink({ data: { token, reason } });
    if (r.ok) await qc.invalidateQueries({ queryKey: ["electrician-link", token] });
    return r;
  };
  return <TradePublicShell><ElectricianLinkBody d={q.data} {...(q.data.view.canBook || q.data.view.canChange ? { onBook } : {})} onUpload={onUpload} onCantDo={onCantDo} /></TradePublicShell>;
}
