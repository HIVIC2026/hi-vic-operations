import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/portal/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getLaunchCampaignOffice, saveDesktopInsulationCheck } from "@/lib/launch-campaign.functions";
import { renderLaunchGroupEmail } from "@/lib/estimate-email";

export const Route = createFileRoute("/_authenticated/admin/launch-campaign")({
  beforeLoad: () => { throw redirect({ to: "/admin/enquiry-groups", replace: true }); },
  component: LaunchCampaignOffice,
  head: () => ({ meta: [{ title: "Existing leads campaign – Home Insulation Victoria Operations" }, { name: "description", content: "Review saved spots and desktop insulation checks." }, { property: "og:title", content: "Existing leads campaign – Home Insulation Victoria Operations" }, { property: "og:description", content: "Review saved spots and desktop insulation checks." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
});

const LABEL: Record<string, string> = { pending: "Needs desk check", looks_eligible: "Looks eligible", not_eligible: "Not eligible", needs_onsite_check: "Needs onsite check", not_needed: "No desk check" };

function LaunchCampaignOffice() {
  const load = useServerFn(getLaunchCampaignOffice);
  const save = useServerFn(saveDesktopInsulationCheck);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["launch_campaign_office"], queryFn: () => load() });
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const previewToken = "PREVIEW_ONLY_campaign_link_not_sent".padEnd(43, "X");
  const campaignUrl = `https://estimate.homeinsulationvictoria.com.au/estimate/${previewToken}/campaign`;
  const unsubscribeUrl = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`;
  const previews = [
    renderLaunchGroupEmail({ group: "likely", campaignUrl, unsubscribeUrl, firstName: "Sarah", estimatedTotal: 3379, veuDiscount: 1470, grossTotal: 4849, areaM2: 150, address: "14 Example Street, Ballarat VIC 3350", reference: "PREVIEW-A" }),
    renderLaunchGroupEmail({ group: "onsite", campaignUrl, unsubscribeUrl, firstName: "Michael", estimatedTotal: 3379, veuDiscount: 1470, grossTotal: 4849, areaM2: 150, address: "28 Sample Road, Bendigo VIC 3550", reference: "PREVIEW-B" }),
  ];
  const decide = async (id: string, outcome: "looks_eligible" | "not_eligible" | "needs_onsite_check") => {
    setBusy(id);
    try { await save({ data: { responseId: id, outcome, reason: reason[id] ?? "" } }); toast.success("Desktop check saved"); await refetch(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
    finally { setBusy(null); }
  };
  return <AppShell wide><header className="mb-5"><div className="flex items-center justify-between gap-4"><div><h1 className="font-display text-2xl font-bold">Existing leads campaign</h1><p className="mt-1 text-sm text-muted-foreground">Review saved spots and desktop insulation checks. Campaign sending stays locked until Jo approves the wording.</p></div><Link to="/admin/enquiry-groups" className="text-sm font-semibold text-primary underline">Email groups</Link></div></header>
    {isLoading ? <p role="status">Loading…</p> : isError || !data ? <p role="alert">Could not load the campaign.</p> : <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">{Object.entries(data.counts).map(([k, v]) => <div key={k} className="rounded-xl border bg-card p-3"><div className="text-2xl font-bold">{v}</div><div className="text-xs text-muted-foreground">{{ sent: "Sent", opened: "Opened", spotSaved: "Spots saved (total)", optedOut: "Opted out", videosUploaded: "Videos uploaded", looksEligible: "Looks eligible", notEligible: "Not eligible", needsOnsite: "Needs onsite" }[k as keyof typeof data.counts]}</div></div>)}</div>
      <p className="mt-3 text-xs text-muted-foreground">“Spots saved (total)” counts every enquiry that has saved a spot, including any that have since moved to an active job or been closed. The Office overview “Spot saved” tile counts only spots still waiting for an installer.</p>
      <div className="mt-4 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm"><strong>Sending is off.</strong> Final wording is still a placeholder. When approved, each run will be limited to {data.batchSize} people.</div>
      <section className="mt-6"><h2 className="font-display text-xl font-bold">Spot saved</h2><p className="text-sm text-muted-foreground">Video priority first, then oldest saved spot. Saving a spot does not book a visit.</p><div className="mt-3 overflow-x-auto rounded-xl border bg-card"><table className="w-full min-w-[680px] text-sm"><thead className="bg-muted/40 text-left"><tr><th className="p-3">Owner</th><th className="p-3">Property</th><th className="p-3">Saved</th><th className="p-3">Saved price</th><th className="p-3">Status</th></tr></thead><tbody className="divide-y">{data.rows.filter((r) => r.spotSavedAt && !r.optedOutAt).map((r) => <tr key={r.id}><td className="p-3 font-semibold"><Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} className="hover:underline">{r.owner ?? r.jobNumber ?? "Enquiry"}</Link></td><td className="p-3">{r.property || "—"}</td><td className="p-3">{r.spotSavedAt ? new Date(r.spotSavedAt).toLocaleString("en-AU") : "—"}</td><td className="p-3">{r.savedPrice ?? "—"}{r.priceChanged && <span className="block text-xs font-semibold text-destructive">{r.priceChanged}</span>}</td><td className="p-3">{r.queuePriority === "video" ? "Spot saved · video sent" : "Spot saved, needs an installer"}</td></tr>)}</tbody></table></div></section>
      <section className="mt-7"><h2 className="font-display text-xl font-bold">Desktop insulation checks</h2><p className="text-sm text-muted-foreground">The owner's answer stays declared. This is a desk check, not final verification.</p><div className="mt-3 space-y-3">{data.rows.filter((r) => r.mediaReceivedAt || r.deskCheckStatus === "pending").map((r) => <article key={r.id} className="rounded-xl border bg-card p-4"><div className="flex flex-wrap justify-between gap-2"><div><Link to="/admin/jobs/$jobId" params={{ jobId: r.jobId }} className="font-bold hover:underline">{r.owner ?? r.jobNumber ?? "Enquiry"}</Link><p className="text-sm text-muted-foreground">{r.property}</p></div><span className="text-sm font-semibold">{LABEL[r.deskCheckStatus] ?? r.deskCheckStatus}</span></div>{r.deskCheckStatus === "pending" && <div className="mt-4 space-y-3"><Input value={reason[r.id] ?? ""} onChange={(e) => setReason((x) => ({ ...x, [r.id]: e.target.value }))} placeholder="Reason (required if not eligible)" /><div className="flex flex-wrap gap-2"><Button disabled={busy === r.id} onClick={() => void decide(r.id, "looks_eligible")}>Looks eligible (under R2.0)</Button><Button variant="outline" disabled={busy === r.id} onClick={() => void decide(r.id, "needs_onsite_check")}>Needs onsite check</Button><Button variant="destructive" disabled={busy === r.id} onClick={() => void decide(r.id, "not_eligible")}>Not eligible</Button></div></div>}</article>)}</div></section>
      <section className="mt-8"><h2 className="font-display text-xl font-bold">Campaign email previews</h2><p className="mt-1 text-sm text-muted-foreground">Draft only. Sending remains off until Jo approves the wording.</p><div className="mt-4 grid gap-6 xl:grid-cols-2">{previews.map((preview, index) => <article key={preview.subject} className="min-w-0"><p className="mb-2 text-sm font-semibold">Group {index === 0 ? "A" : "B"} · {preview.subject}</p><div className="overflow-x-auto rounded-xl border bg-muted/20 p-2"><iframe title={`Group ${index === 0 ? "A" : "B"} campaign email`} sandbox="" srcDoc={preview.html} className="mx-auto h-[760px] w-[390px] max-w-full bg-card" /></div></article>)}</div></section>
    </>}
  </AppShell>;
}
