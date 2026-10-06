import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { CUSTOMER_BRAND } from "@/lib/customer-quote-system";
import { acceptRateOffer, declineRateOffer, loadRateOffer } from "@/lib/rate-offer.functions";

export const Route = createFileRoute("/rate-offer/$token")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Review our rate offer – Home Insulation Victoria" },
    { name: "description", content: "Review and respond to the rate offer from Home Insulation Victoria." },
    { property: "og:title", content: "Review our rate offer – Home Insulation Victoria" },
    { property: "og:description", content: "Review and respond to the rate offer from Home Insulation Victoria." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" },
  ] }),
  component: RateOfferPage,
});

const money = (n: number) => `$${n.toFixed(2)}`;

function RateOfferPage() {
  const { token } = Route.useParams();
  const q = useQuery({ queryKey: ["rate-offer", token], queryFn: () => loadRateOffer({ data: { token } }), retry: false });
  const [mode, setMode] = useState<"view" | "accept" | "decline">("view");
  const [name, setName] = useState(""); const [position, setPosition] = useState(""); const [tick, setTick] = useState(false);
  const [proposed, setProposed] = useState<Record<string, string>>({}); const [message, setMessage] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const o = q.data;
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await fn(); await q.refetch(); setMode("view"); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <main className="mx-auto max-w-xl space-y-5 bg-background px-4 py-8">
      <img src={CUSTOMER_BRAND.logoUrl} alt={CUSTOMER_BRAND.name} className="h-10 w-auto" />
      <h1 className="font-display text-3xl font-extrabold text-foreground">Review our rate offer</h1>
      {q.isLoading && <p className="text-muted-foreground">Loading…</p>}
      {q.error && <p className="text-destructive">{(q.error as Error).message}</p>}
      {o && <>
        <p className="text-foreground">Thanks for your application, {o.partner}. Here are your rates next to ours. All figures include GST.</p>
        {o.note && <div className="rounded-2xl bg-secondary p-4 text-sm"><b>Note from our office:</b> {o.note}</div>}
        <div className="rounded-2xl border bg-card p-4">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-2 text-sm">
            <span className="text-xs text-muted-foreground">Rate</span><span className="text-xs text-muted-foreground">Yours</span><span className="text-xs text-muted-foreground">Our offer</span>
            {o.items.map((i) => (
              <div key={i.code} className="contents">
                <span>{i.description}<span className="text-xs text-muted-foreground"> / {i.display_unit ?? i.unit}</span></span>
                <span>{money(i.partner_inc_gst)}</span>
                <span className={i.offer_inc_gst !== i.partner_inc_gst ? "font-bold text-primary" : "font-semibold"}>{money(i.offer_inc_gst)}</span>
              </div>
            ))}
          </div>
        </div>
        {o.status === "accepted" && <p className="rounded-2xl bg-success-soft p-4 font-semibold text-success">You accepted these rates. Our office will finish setting you up.</p>}
        {o.status === "declined" && <p className="rounded-2xl bg-muted p-4 font-semibold">You sent this back to us. Our office will be in touch.</p>}
        {o.status === "superseded" && <p className="rounded-2xl bg-muted p-4">This offer has been replaced.</p>}
        {o.status === "sent" && mode === "view" && (
          <div className="flex flex-col gap-3">
            <Button className="h-12" onClick={() => setMode("accept")}>Accept these rates</Button>
            <Button className="h-12" variant="outline" onClick={() => setMode("decline")}>Decline or propose new rates</Button>
          </div>
        )}
        {o.status === "sent" && mode === "accept" && (
          <div className="space-y-3 rounded-2xl border bg-card p-4">
            <h2 className="font-display text-xl font-extrabold">Sign to accept</h2>
            <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{o.text}</pre>
            <label className="flex items-start gap-2 text-sm"><Checkbox checked={tick} onCheckedChange={(v) => setTick(v === true)} aria-label="I agree to these rates" /> <span>I agree that these rates replace the rates in our signed partner agreement, and all other terms stay the same.</span></label>
            <Input className="h-12" placeholder="Your full name" aria-label="Your full name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input className="h-12" placeholder="Your position (e.g. Director)" aria-label="Your position" value={position} onChange={(e) => setPosition(e.target.value)} />
            <Button className="h-12 w-full" disabled={busy || !tick || name.trim().length < 2 || position.trim().length < 2}
              onClick={() => act(() => acceptRateOffer({ data: { token, signer_name: name.trim(), signer_position: position.trim(), agreed: true, terms_sha256: o.sha256 } }))}>Sign and accept</Button>
            <Button variant="ghost" className="w-full" onClick={() => setMode("view")}>Back</Button>
          </div>
        )}
        {o.status === "sent" && mode === "decline" && (
          <div className="space-y-3 rounded-2xl border bg-card p-4">
            <h2 className="font-display text-xl font-extrabold">Propose new rates</h2>
            <p className="text-sm text-muted-foreground">Leave a rate blank to keep your original figure. Our office will review and reply.</p>
            {o.items.map((i) => (
              <label key={i.code} className="flex items-center justify-between gap-3 text-sm"><span>{i.description}</span>
                <Input className="h-12 w-28" type="number" min={0} step="0.01" aria-label={`Your new rate for ${i.description}`} value={proposed[i.code] ?? ""} onChange={(e) => setProposed((p) => ({ ...p, [i.code]: e.target.value }))} /></label>
            ))}
            <Textarea rows={3} placeholder="Message to our office (optional)" aria-label="Message to our office" value={message} onChange={(e) => setMessage(e.target.value)} />
            <Button className="h-12 w-full" disabled={busy} onClick={() => act(() => declineRateOffer({ data: { token, proposed: Object.fromEntries(Object.entries(proposed).filter(([, v]) => v.trim() !== "" && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])), message: message.trim() || undefined } }))}>Send back to the office</Button>
            <Button variant="ghost" className="w-full" onClick={() => setMode("view")}>Back</Button>
          </div>
        )}
        {err && <p className="text-destructive">{err}</p>}
      </>}
    </main>
  );
}
