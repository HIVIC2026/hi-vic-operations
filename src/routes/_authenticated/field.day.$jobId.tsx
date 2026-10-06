import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { CheckCircle2, MapPin, Phone } from "lucide-react";
import { AppShell } from "@/components/portal/AppShell";
import { TradeTabs } from "@/components/portal/trade-work";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { getTradeDay } from "@/lib/jo-tradie.functions";
import { formatPiesaWindow } from "@/lib/piesa-windows.core";

export const Route = createFileRoute("/_authenticated/field/day/$jobId")({
  head: () => ({ meta: [{ title: "On the day – Home Insulation Victoria" }, { name: "description", content: "Get ready and start your safety check." }, { property: "og:title", content: "On the day – Home Insulation Victoria" }, { property: "og:description", content: "Get ready and start your safety check." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: DayPage,
});

const CHECKS = ["Phone charged (50% or more)", "Camera lens wiped clean", "Location turned on for the camera"];

function DayPage() {
  const { jobId } = Route.useParams();
  const load = useServerFn(getTradeDay);
  const { data, error } = useQuery({ queryKey: ["trade-day", jobId], queryFn: () => load({ data: { jobId } }), refetchInterval: 30_000 });
  const key = `hiv-day-checks-${jobId}`;
  const [ticks, setTicks] = useState<boolean[]>([false, false, false]);
  const [started, setStarted] = useState(false);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(key) ?? "null"); if (Array.isArray(v)) setTicks(v); } catch { /* ignore */ } }, [key]);
  const tick = (i: number, v: boolean) => { const n = ticks.map((t, j) => (j === i ? v : t)); setTicks(n); localStorage.setItem(key, JSON.stringify(n)); };
  if (error) return <AppShell><p role="alert" className="rounded-[22px] border bg-card p-5 text-sm">{(error as Error).message}</p><TradeTabs installer={false} /></AppShell>;
  if (!data) return <AppShell><p className="text-muted-foreground">Loading your day…</p></AppShell>;
  const ready = ticks.every(Boolean);
  return (
    <AppShell>
      <div className="mx-auto max-w-md space-y-4 pb-24">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-primary">On the day · {data.jobNumber}</div>
          <h1 className="font-display text-2xl font-extrabold">Safety check</h1>
          {data.start && <p className="text-sm font-semibold">{formatPiesaWindow(data.start, data.end)}</p>}
          <p className="text-sm text-muted-foreground">{data.owner} · {data.address}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button asChild size="field" variant="outline"><a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(data.address)}`} target="_blank" rel="noreferrer"><MapPin className="mr-1 h-5 w-5" />Directions</a></Button>
            {data.phone && <Button asChild size="field" variant="outline"><a href={`tel:${data.phone}`}><Phone className="mr-1 h-5 w-5" />Call owner</a></Button>}
          </div>
        </div>

        {data.outcome === "all_clear" ? (
          <div className="rounded-[22px] bg-success p-5 text-success-foreground shadow-sm">
            <CheckCircle2 className="h-8 w-8" />
            <div className="mt-2 font-display text-2xl font-extrabold">All clear</div>
            <p className="text-sm">No fixes needed. Nice work. Your pay is on its way once the office signs it off.</p>
            <Button asChild size="field" variant="secondary" className="mt-4 w-full"><Link to="/partner/payments">See Money</Link></Button>
          </div>
        ) : data.outcome === "fixes" ? (
          <div className="rounded-[22px] border bg-card p-5 shadow-sm"><div className="font-display text-xl font-extrabold">Fixes needed</div><p className="text-sm text-muted-foreground">The office is pricing the fixes from your agreed rates. We'll let you know.</p></div>
        ) : (
          <>
            <section className="rounded-[22px] border bg-card p-5 shadow-sm">
              <h2 className="font-display text-lg font-extrabold">Phone check</h2>
              <div className="mt-3 space-y-3">{CHECKS.map((c, i) => <label key={c} className="flex min-h-12 items-center gap-3 rounded-2xl bg-secondary px-3 text-sm font-medium"><Checkbox className="h-6 w-6" checked={ticks[i]} onCheckedChange={(v) => tick(i, v === true)} />{c}</label>)}</div>
            </section>
            <section className="rounded-[22px] border bg-secondary p-5">
              <h2 className="font-display text-lg font-extrabold">Sharp photos, first time</h2>
              <p className="mt-1 text-sm text-danger font-medium">Blurry or dark photos get sent back — that means a return trip.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                <li>Use your torch in the roof space.</li>
                <li>Hold still for a second after you tap.</li>
                <li>Get the whole switchboard in one shot.</li>
                <li>Video: slow, steady sweep — no zooming.</li>
              </ul>
            </section>
            <section className="rounded-[22px] border bg-card p-5 text-sm shadow-sm">
              <h2 className="font-display text-lg font-extrabold">Turn on photo location</h2>
              <p className="mt-2 font-semibold">iPhone</p><p className="text-muted-foreground">Settings → Privacy & Security → Location Services → Camera → While Using the App, and turn on Precise Location.</p>
              <p className="mt-2 font-semibold">Android</p><p className="text-muted-foreground">Open Camera → Settings (cog) → turn on Location tags (or Save location).</p>
            </section>
            {!started ? (
              <Button size="field" className="w-full" disabled={!ready} onClick={() => setStarted(true)}>{ready ? "Start check" : "Tick all three to start"}</Button>
            ) : data.mittiId ? (
              <Button asChild size="field" className="w-full"><a href={`https://app.au.mitti.com/inspections/${data.mittiId}`} target="_blank" rel="noreferrer">Open safety check in Mitti</a></Button>
            ) : (
              <div role="status" className="rounded-[22px] border border-warning/40 bg-warning-soft p-5 text-sm"><div className="font-semibold">The Mitti form isn't set up yet</div><p className="mt-1 text-muted-foreground">Home Insulation Victoria is finishing the safety check form. Your result will show here as soon as it's in.</p></div>
            )}
          </>
        )}
      </div>
      <TradeTabs installer={false} />
    </AppShell>
  );
}
