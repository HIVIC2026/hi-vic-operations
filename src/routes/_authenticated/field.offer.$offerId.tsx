import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CalendarPlus, MapPin, Phone } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/portal/AppShell";
import { TradeTabs, timeLeft } from "@/components/portal/trade-work";
import { Button } from "@/components/ui/button";
import { getOfferView, takeOfferTime } from "@/lib/jo-tradie.functions";
import { formatPiesaWindow } from "@/lib/piesa-windows.core";

export const Route = createFileRoute("/_authenticated/field/offer/$offerId")({
  head: () => ({ meta: [{ title: "Job offer – Home Insulation Victoria" }, { name: "description", content: "A fresh job offer. First in, best dressed." }, { property: "og:title", content: "Job offer – Home Insulation Victoria" }, { property: "og:description", content: "A fresh job offer. First in, best dressed." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] }),
  component: OfferPage,
});

const ics = (title: string, start: string, end: string | null, where: string) => {
  const f = (d: string) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", `DTSTART:${f(start)}`, `DTEND:${f(end ?? start)}`, `SUMMARY:${title}`, `LOCATION:${where}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
};

function OfferPage() {
  const { offerId } = Route.useParams();
  const load = useServerFn(getOfferView);
  const take = useServerFn(takeOfferTime);
  const { data, error, refetch } = useQuery({ queryKey: ["offer", offerId], queryFn: () => load({ data: { offerId } }) });
  const [busy, setBusy] = useState<string | null>(null);
  const [justTook, setJustTook] = useState(false);
  const [tooSlow, setTooSlow] = useState(false);
  if (error) return <AppShell><p role="alert" className="rounded-[22px] border bg-card p-5 text-sm">{(error as Error).message}</p><TradeTabs installer={false} /></AppShell>;
  if (!data) return <AppShell><p className="text-muted-foreground">Loading the job…</p></AppShell>;
  const s = data.summary as { suburb?: string; postcode?: string; approx_area_m2?: number; access_summary?: string; electrician_rate_inc_gst?: number; distance_km?: number };
  const tap = async (pid: string) => {
    setBusy(pid);
    try {
      const r = await take({ data: { offerId, proposalId: pid } });
      if (r.tooSlow) setTooSlow(true); else setJustTook(true);
      await refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const taken = data.status === "accepted" && data.locked;
  return (
    <AppShell>
      <div className="mx-auto max-w-md pb-24">
        {taken ? (
          <>
            {justTook && <div className="mb-4 rounded-[22px] bg-success p-5 text-success-foreground shadow-sm"><div className="font-display text-2xl font-extrabold">It's yours!</div><p className="text-sm font-medium">Oooft, that was fast clicking.</p></div>}
            <div className="rounded-[22px] border bg-card p-5 shadow-sm">
              <div className="text-xs font-bold uppercase tracking-wide text-success">Locked in</div>
              <div className="mt-1 font-display text-xl font-extrabold">{formatPiesaWindow(data.locked!.start, data.locked!.end)}</div>
              <div className="mt-2 text-sm">Safety check · <span className="font-semibold">${s.electrician_rate_inc_gst ?? "—"}</span> in your pocket</div>
              <div className="mt-3 space-y-1 text-sm"><div className="font-semibold">{data.locked!.owner}</div><div className="text-muted-foreground">{data.locked!.address}</div></div>
              <div className="mt-4 grid gap-2">
                <Button asChild size="field" className="w-full"><a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(data.locked!.address)}`} target="_blank" rel="noreferrer"><MapPin className="mr-2 h-5 w-5" />Directions</a></Button>
                {data.locked!.phone && <Button asChild size="field" variant="outline" className="w-full"><a href={`tel:${data.locked!.phone}`}><Phone className="mr-2 h-5 w-5" />Call owner</a></Button>}
                <Button asChild size="field" variant="outline" className="w-full"><a href={ics("Safety check – Home Insulation Victoria", data.locked!.start, data.locked!.end, data.locked!.address)} download="safety-check.ics"><CalendarPlus className="mr-2 h-5 w-5" />Add to calendar</a></Button>
                <Button asChild size="field" variant="ghost" className="w-full"><Link to="/field/day/$jobId" params={{ jobId: data.jobId }}>Open day page</Link></Button>
              </div>
            </div>
          </>
        ) : tooSlow || data.status !== "pending" ? (
          <div className="rounded-[22px] border bg-card p-6 text-center shadow-sm"><div className="font-display text-xl font-extrabold">Too slow this time</div><p className="mt-2 text-sm text-muted-foreground">Someone else grabbed it. Keep your alerts on — the next one's yours.</p><Button asChild size="field" className="mt-4 w-full"><Link to="/field">Back to My work</Link></Button></div>
        ) : (
          <div className="overflow-hidden rounded-[22px] border bg-card shadow-sm">
            <div className="bg-[hsl(var(--navy,224_52%_28%))] bg-primary p-5 text-primary-foreground">
              <div className="flex items-center justify-between text-xs font-semibold opacity-90"><span>Fresh job</span>{data.expiresAt && <span>{timeLeft(data.expiresAt)}</span>}</div>
              <div className="mt-1 font-display text-2xl font-extrabold">{s.suburb} {s.postcode}</div>
              <div className="mt-1 text-lg font-bold">${s.electrician_rate_inc_gst ?? "—"} in your pocket</div>
            </div>
            <div className="grid grid-cols-3 gap-2 p-4 text-center text-xs">
              <div className="rounded-2xl bg-secondary p-2"><div className="font-bold">Safety check</div><div className="text-muted-foreground">PIESA</div></div>
              <div className="rounded-2xl bg-secondary p-2"><div className="font-bold">{s.approx_area_m2 ? `${s.approx_area_m2} m²` : "—"}</div><div className="text-muted-foreground">ceiling</div></div>
              <div className="rounded-2xl bg-secondary p-2"><div className="font-bold">{s.distance_km != null ? `${s.distance_km} km` : "Nearby"}</div><div className="text-muted-foreground">from base</div></div>
            </div>
            {s.access_summary && <p className="px-4 text-sm text-muted-foreground">{s.access_summary}</p>}
            <div className="space-y-2 p-4">
              <div className="text-sm font-semibold">Owner's times — first tap books it</div>
              {data.windows.filter((w) => w.status === "proposed").map((w) => <Button key={w.id} size="field" className="h-auto min-h-12 w-full whitespace-normal" disabled={!!busy} onClick={() => tap(w.id)}>{busy === w.id ? "Booking…" : formatPiesaWindow(w.starts_at, w.ends_at)}</Button>)}
              <p className="pt-1 text-xs text-muted-foreground">The owner's name, address and phone show once it's yours.</p>
            </div>
          </div>
        )}
      </div>
      <TradeTabs installer={false} />
    </AppShell>
  );
}
