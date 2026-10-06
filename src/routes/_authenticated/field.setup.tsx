import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { getTradeSetup } from "@/lib/jo-tradie.functions";

export const Route = createFileRoute("/_authenticated/field/setup")({
  head: () => ({ meta: [{ title: "Quick setup – Home Insulation Victoria" }, { name: "description", content: "Get ready for job alerts in a couple of minutes." }, { property: "og:title", content: "Quick setup – Home Insulation Victoria" }, { property: "og:description", content: "Get ready for job alerts in a couple of minutes." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: Setup,
});

type Item = { key: string; title: string; detail: string; optional?: boolean; to?: string };

function Setup() {
  const load = useServerFn(getTradeSetup);
  const { data } = useQuery({ queryKey: ["trade-setup"], queryFn: () => load() });
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [finished, setFinished] = useState(false);
  useEffect(() => { try { setDone(JSON.parse(localStorage.getItem("hiv-setup") ?? "{}")); } catch { /* ignore */ } }, []);
  const mark = (k: string) => { const n = { ...done, [k]: !done[k] }; setDone(n); localStorage.setItem("hiv-setup", JSON.stringify(n)); };
  if (data === undefined) return <AppShell><p className="text-muted-foreground">Loading…</p></AppShell>;
  if (data === null) return <AppShell><p className="rounded-[22px] border bg-card p-5 text-sm">Your sign-in isn't linked to an approved business yet.</p></AppShell>;
  const items: Item[] = [
    { key: "details", title: "Check your details", detail: `${data.name ?? "—"} · ${data.mobile ?? "no mobile"} · ${data.email ?? ""}` },
    { key: "rates", title: "Rates and area", detail: `Safety check $${data.rate ?? "to confirm"} · ${data.area}` },
    { key: "bank", title: "Bank details", detail: data.bankDone ? "Saved" : "Add where we pay you", to: "/partner/profile" },
    { key: "alerts", title: "Job alerts", detail: "Texts go to your mobile. Keep them on — first in, best dressed." },
    { key: "mitti", title: "Mitti setup", detail: "Download Mitti and sign in with this email. Your safety check form opens from the day page." },
    { key: "team", title: "Add your team", detail: "Optional — invite your sparkies so they see their jobs.", optional: true, to: "/partner/workers" },
  ];
  const required = items.filter((i) => !i.optional);
  const allDone = required.every((i) => done[i.key] || (i.key === "bank" && data.bankDone));
  if (finished) return (
    <AppShell>
      <div className="mx-auto max-w-md space-y-4 pb-10">
        <div className="rounded-[22px] bg-success p-6 text-success-foreground"><div className="font-display text-2xl font-extrabold">You're all set</div><p className="text-sm">Job alerts are on for {data.business}.</p></div>
        <div className="rounded-[22px] border bg-card p-5 shadow-sm">
          <h2 className="font-display text-lg font-extrabold">How it works</h2>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
            <li>We text you a fresh job near you, with your pay.</li>
            <li>Tap one of the owner's times. First tap books it.</li>
            <li>We remind you the day before.</li>
            <li>On the day: phone check, then Start check.</li>
            <li>All clear? Your pay shows in Money once the office signs it off.</li>
          </ol>
        </div>
        <Button asChild size="field" className="w-full"><Link to="/field">Go to My work</Link></Button>
      </div>
    </AppShell>
  );
  return (
    <AppShell>
      <div className="mx-auto max-w-md pb-10">
        <h1 className="font-display text-2xl font-extrabold">Welcome, {data.name?.split(" ")[0] ?? "mate"}</h1>
        <p className="mb-4 text-sm text-muted-foreground">A couple of minutes and you're ready for job alerts.</p>
        <div className="space-y-2">
          {items.map((i) => {
            const on = done[i.key] || (i.key === "bank" && data.bankDone);
            return (
              <div key={i.key} className="flex items-start gap-3 rounded-[22px] border bg-card p-4 shadow-sm">
                <button aria-label={`Mark ${i.title} done`} onClick={() => mark(i.key)} className="mt-0.5">{on ? <CheckCircle2 className="h-7 w-7 text-success" /> : <Circle className="h-7 w-7 text-muted-foreground" />}</button>
                <div className="min-w-0 flex-1"><div className="font-semibold">{i.title}{i.optional ? " (optional)" : ""}</div><div className="text-sm text-muted-foreground">{i.detail}</div>{i.to && <Link to={i.to as never} className="text-sm font-semibold text-primary">Open</Link>}</div>
              </div>
            );
          })}
        </div>
        <Button size="field" className="mt-4 w-full" disabled={!allDone} onClick={() => setFinished(true)}>{allDone ? "Finish" : "Tick each step to finish"}</Button>
      </div>
    </AppShell>
  );
}
