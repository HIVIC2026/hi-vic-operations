import { INSULATION_REVIEW_INVITATION } from "@/lib/insulation-review.core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CUSTOMER_BRAND } from "@/lib/customer-quote-system";
import { OwnerHouse } from "@/components/owner/OwnerHouse";
import { Button } from "@/components/ui/button";
import { getLaunchCampaignPage, saveMySpot, takeMeOffList } from "@/lib/launch-campaign.functions";
import type { InsulationDeclared } from "@/lib/estimate.core";

export const Route = createFileRoute("/estimate_/$token/campaign")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [{ title: "Your insulation savings — Home Insulation Victoria" }, { name: "description", content: "Review your preliminary ceiling insulation savings and save your place for a free onsite Ready Check." }, { property: "og:title", content: "Your insulation savings — Home Insulation Victoria" }, { property: "og:description", content: "Review your preliminary ceiling insulation savings." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  component: CampaignPage,
});

function CampaignPage() {
  const { token } = Route.useParams();
  const getPage = useServerFn(getLaunchCampaignPage);
  const save = useServerFn(saveMySpot);
  const optOut = useServerFn(takeMeOffList);
  type CampaignData = { group: "likely" | "onsite"; estimate: unknown; pricing: Pricing | null; response: { spot_saved_at: string | null; opted_out_at: string | null; queue_priority: string; media_received_at?: string | null; desk_check_status?: string; saved_total?: number | null; saved_veu_discount?: number | null } | null; referralUrl?: string | null; home?: { suburb: string | null; short: string | null }; bookingAvailable: boolean; owner: { firstName: string | null }; initialValues: { address: string; areaM2: number | null; insulation: InsulationDeclared } } | null;
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["launch_campaign", token], queryFn: async () => {
    const json = await getPage({ data: { token } });
    return json ? JSON.parse(json) as CampaignData : null;
  }, retry: false, refetchOnWindowFocus: false });
  const [busy, setBusy] = useState<"save" | "optout" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (kind: "save" | "optout") => {
    setBusy(kind); setError(null);
    try { await (kind === "save" ? save({ data: { token } }) : optOut({ data: { token } })); await refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : "That didn't work. Please try again."); }
    finally { setBusy(null); }
  };
  return <div className="estimate-brand min-h-screen bg-estimate-canvas">
    <main className="pb-14">
      {isLoading ? <p role="status" className="py-16 text-center text-sm text-muted-foreground">Loading your estimate…</p>
      : isError || !data ? <section className="estimate-offset rounded-2xl border bg-white p-8 text-center"><h1 className="font-display text-2xl font-bold">This link isn't available</h1><p className="mt-2 text-sm">Please contact Home Insulation Victoria and we'll help.</p></section>
      : data.response?.opted_out_at ? <div className="mx-auto max-w-[760px] px-4 sm:px-8"><section className="estimate-offset rounded-[22px] border border-estimate-blue-soft bg-white p-8 text-center"><h1 className="font-display text-3xl font-extrabold text-estimate-navy">You're off the list</h1><p className="mt-3 text-estimate-navy/75">We won't send any more campaign messages about this enquiry.</p></section></div>
      : data.response?.spot_saved_at ? <div className="mx-auto max-w-[760px] px-4 sm:px-8"><Result group={data.group} videoPriority={data.response.queue_priority === "video"} token={token} rebate={data.response.saved_veu_discount ?? null} customer={data.response.saved_total ?? null} suburb={data.home?.suburb ?? null} home={data.home?.short ?? null} referralUrl={data.referralUrl ?? null} firstName={data.owner.firstName ?? null} /></div>
      : data.pricing ? <CampaignDesign reviewStatus={data.response?.desk_check_status ?? null} group={data.group} token={token} name={data.owner.firstName} suburb={data.home?.suburb ?? null} p={data.pricing} busy={busy} error={error} onSave={() => void act("save")} onOptOut={() => void act("optout")} />
      : <section className="estimate-offset mx-4 rounded-2xl border bg-white p-8 text-center"><h1 className="font-display text-2xl font-bold">Your estimate is being updated</h1><p className="mt-2 text-sm">Please check back soon.</p></section>}
    </main>
  </div>;
}

function Result({ group, videoPriority, token, rebate, customer, suburb, home, referralUrl, firstName }: { group: "likely" | "onsite"; videoPriority: boolean; token: string; rebate: number | null; customer: number | null; suburb: string | null; home: string | null; referralUrl: string | null; firstName: string | null }) {
  const $ = (n: number | null) => (n == null ? "—" : `$${Math.floor(Number(n)).toLocaleString("en-AU")}`);
  const [copied, setCopied] = useState(false);
  const shareChecker = async () => {
    if (!referralUrl) return;
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ title: "Free insulation eligibility checker", text: "Send them our free eligibility checker. It takes a minute.", url: referralUrl }); return; } catch { /* user cancelled or share unsupported — fall through to copy */ }
    }
    try { await navigator.clipboard.writeText(referralUrl); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* clipboard unavailable */ }
  };
  return <section className="estimate-offset rounded-[22px] border border-estimate-blue-soft bg-white p-6 shadow-[0_18px_50px_rgba(34,55,107,0.09)] sm:p-8">
    <OwnerHouse level={1} size="sm" className="mx-auto" />
    <h1 className="mt-4 text-center font-display text-3xl font-extrabold text-estimate-navy">Spot saved.</h1>
    <div className="mt-5 rounded-xl bg-estimate-heads-up p-4 text-estimate-navy">
      <p className="font-bold">Smart move{firstName ? `, ${firstName}` : ""}. Your spot is saved.</p>
      <p className="mt-0.5 font-bold text-estimate-logo-green">Your {$(rebate)} rebate is waiting.</p>
      <p className="mt-2 text-sm">Demand is high and installer capacity is limited, so we're approving homes in batches, in the order spots were saved. You've locked in your place, so there's nothing more you need to do.</p>
      <p className="mt-2 text-sm">We're teaming up with more installers and electricians across Victoria, and we'll text you as soon as one is free {suburb ? `in ${suburb}` : "near you"} to book your free Ready Check.</p>
    </div>
    <dl className="mt-4 grid gap-2 rounded-xl border border-estimate-line p-4 text-sm text-estimate-navy">
      <div className="flex justify-between gap-3"><dt>Your rebate</dt><dd className="font-bold text-estimate-logo-green">{$(rebate)}</dd></div>
      <div className="flex justify-between gap-3"><dt>You pay about</dt><dd className="font-bold">{$(customer)}</dd></div>
      {home && <div className="flex justify-between gap-3"><dt>Home</dt><dd className="text-right">{home}</dd></div>}
    </dl>
    <p className="mt-2 text-xs text-estimate-navy/70">Estimate only. Your final price is confirmed after the free Ready Check.</p>
    {group === "onsite" && !videoPriority && <div className="mt-5 rounded-xl bg-estimate-mint p-4 text-center"><h2 className="font-display text-lg font-bold text-estimate-navy">Want to jump the queue?</h2><Button asChild className="mt-3 bg-estimate-green text-estimate-white hover:bg-estimate-accent"><Link to="/estimate/$token/video" params={{ token }}>Send a quick video</Link></Button></div>}
    {referralUrl && <div className="mt-5 rounded-xl bg-estimate-blush p-4 text-center">
      <h2 className="font-display text-lg font-bold text-estimate-navy">Have a friend who needs a spot saved?</h2>
      <p className="mt-1 text-sm text-estimate-navy/80">Send them our free eligibility checker. It takes a minute.</p>
      <Button type="button" onClick={() => void shareChecker()} className="mt-3 bg-estimate-green text-estimate-white hover:bg-estimate-accent">{copied ? "Link copied ✓" : "Share the checker"}</Button>
      <p className="mt-2 text-xs text-estimate-navy/70">Opens your phone's share sheet — or <button type="button" onClick={() => void shareChecker()} className="font-bold text-estimate-blue underline">copy the link</button>.</p>
    </div>}
  </section>;
}

type Pricing = { gross: number; discount: number; total: number; areaM2: number; assessmentFee: number; apFee: number; ratePerM2: number; installation: number; veecs: number; veecValue: number; address: string | null; insulation: InsulationDeclared | null };
const money = (n: number) => `$${Math.floor(Number(n)).toLocaleString("en-AU")}`;

/** v8 (Jo, 6 Oct): Jo's approved Group A design lives here, where Outfit/Figtree load. The short email only links here. */
function CampaignDesign({ reviewStatus, group, token, name, suburb, p, busy, error, onSave, onOptOut }: { reviewStatus: string | null; group: "likely" | "onsite"; token: string; name: string | null; suburb: string | null; p: Pricing; busy: "save" | "optout" | null; error: string | null; onSave: () => void; onOptOut: () => void }) {
  const onsite = group === "onsite" && reviewStatus !== "looks_eligible";
  const rebate = money(p.discount);
  const saveBtn = <Button type="button" disabled={!!busy} onClick={onSave} className="h-14 w-full rounded-xl bg-estimate-green font-display text-lg font-bold text-estimate-white hover:bg-estimate-accent">{busy === "save" ? "Saving…" : "Save my spot →"}</Button>;
  const videoBtn = <Button asChild className="h-14 w-full rounded-xl bg-estimate-green font-display text-lg font-bold text-estimate-white hover:bg-estimate-accent"><Link to="/estimate/$token/video" params={{ token }}>Send my insulation details →</Link></Button>;
  const removal = p.insulation === "none" ? "Doesn't include removing old insulation (you told us there isn't any)." : "This price excludes existing insulation removal — it may be able to stay. If removal is needed, we’ll confirm the cost before you proceed.";
  const row = (l: string, v: string, cls = "") => <div className={`flex justify-between gap-3 py-1.5 text-sm ${cls}`}><span>{l}</span><span>{v}</span></div>;
  const gets: [string, string][] = [["Free Ready Check", "We measure your roof space and confirm the job."], ["R5.0 ceiling insulation", "Supplied and fitted by a certified installer."], ["Electrical safety check", "By a licensed electrician, as the rules require."], ["Rebate paperwork, done for you", "We handle the forms and the claim."]];
  return <div className="mx-auto max-w-[560px] px-4 pt-5 text-estimate-navy">
    <header className="flex items-center justify-between gap-3">
      <img src={CUSTOMER_BRAND.logoUrl} alt="Home Insulation Victoria" className="h-10 w-auto" />
      <span className="whitespace-nowrap rounded-full bg-estimate-blush px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.07em]">Free estimate · No obligation</span>
    </header>
    <section className="mt-7">
      <p className={`text-[11px] font-extrabold uppercase tracking-[0.13em] ${onsite ? "text-estimate-green" : "text-estimate-logo-green"}`}>{onsite ? "Jump the queue" : "🎉 Your rebate is waiting"}</p>
      <h1 className="mt-2 font-display text-[32px] font-extrabold leading-[1.15]">{onsite ? <>{name ? `${name}, take` : "Take"} <span className="text-estimate-logo-green">{rebate}</span> off your ceiling insulation</> : <>Great news{name ? `, ${name}` : ""}! You could take <span className="text-estimate-logo-green">{rebate}</span> off your ceiling insulation</>}</h1>
      <p className="mt-4 text-[15px] leading-relaxed">Your {suburb ? `${suburb} ` : ""}home {onsite ? "could be eligible" : "looks eligible"} for the Victorian Energy Upgrades rebate. That means you pay about <strong>{money(p.total)}</strong> instead of {money(p.gross)}, and enjoy lower power bills for years to come.</p>
      <p className="mt-3 text-sm font-extrabold">{onsite ? "Your enquiry is currently behind homes whose eligibility we can already confirm. Help us check your insulation so you could move up and save your spot." : "Hundreds of homes have enquired since 1 October. Spots go in order."}</p>
      <div className="mt-5">{onsite ? videoBtn : saveBtn}</div>
      {onsite ? <p className="mt-3 text-center text-sm">Choose one way to share your insulation details. Office checks first.</p> : <p className="mt-3 text-center text-sm">Free · no payment · no obligation</p>}
      {error && <p role="alert" className="mt-2 text-center text-sm text-danger">{error}</p>}
    </section>
    <section data-campaign-estimate className="mt-7 rounded-[22px] bg-estimate-mist p-5">
      <h2 className="font-display text-[11px] font-extrabold uppercase tracking-[0.13em]">Your estimate</h2>
      <div className="mt-2">
        {row(`Installation (${p.areaM2} m² × ${money(p.ratePerM2)})`, money(p.installation))}
        {row("Electrical safety check (PIESA)", money(p.assessmentFee))}
        {row("Accredited Person fee", money(p.apFee))}
        {row("Normal price", money(p.gross), "border-t border-estimate-line font-bold")}
        {row(`Your rebate (${p.veecs} VEECs × ${money(p.veecValue)})`, `−${rebate}`, "font-extrabold text-estimate-logo-green")}
        <div className="flex items-end justify-between gap-3 border-t border-estimate-line pt-3"><span className="text-sm font-extrabold">You pay about</span><span className="font-display text-[34px] font-extrabold leading-none">{money(p.total)}</span></div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-estimate-navy/75">Based on {p.address ? `${p.address} and ` : ""}a {p.areaM2} m² ceiling. {removal} <Link to="/estimate/$token/calculator" params={{ token }} className="font-bold text-estimate-blue">Try a different size →</Link></p>
      <h2 className="mt-5 font-display text-[11px] font-extrabold uppercase tracking-[0.13em]">What you get</h2>
      <ul className="mt-2 space-y-2">{gets.map(([t, d]) => <li key={t} className="text-[13.5px] leading-snug"><span className="font-extrabold text-estimate-logo-green">✓</span>&nbsp; <strong>{t}</strong><br /><span className="text-estimate-navy/75">{d}</span></li>)}</ul>
    </section>
    <section className="mt-5 rounded-[22px] bg-estimate-blush p-5">
      <h2 className="font-display text-[23px] font-extrabold leading-tight">{onsite ? "Want to jump the queue?" : "Hold your place in line"}</h2>
      {onsite ? <><p className="mt-3 text-sm leading-relaxed">{INSULATION_REVIEW_INVITATION}</p><p className="mt-2 text-xs">Only if you can do it safely. Please don’t climb into or walk through the roof space.</p><div className="mt-4">{videoBtn}</div><p className="mt-3 text-center text-sm">{reviewStatus === "pending" ? "Your insulation details are awaiting office review." : reviewStatus === "not_eligible" ? "Our office has assessed your insulation as not eligible. Please contact us with any questions." : reviewStatus === "needs_onsite_check" ? "An onsite check is needed before we can offer Save my spot." : "Office review first. No payment. No obligation."}</p></>
        : <><p className="mt-3 text-sm leading-relaxed">One tap and you're in. We'll be in touch to book your free Ready Check as soon as an installer is free near you.</p><div className="mt-4">{saveBtn}</div></>}
    </section>
    <p className="mt-5 text-xs leading-relaxed text-estimate-navy/70">Estimate only. Your price can change if your ceiling is a different size, old insulation needs removing, access is tricky, or the electrician finds something to fix. We never add work or cost without showing you first and getting your OK.</p>
    <footer className="mt-6 border-t border-estimate-line pt-4 text-center text-xs text-estimate-navy/70">
      <p className="font-bold text-estimate-navy">Home Insulation Victoria</p>
      <p className="mt-1">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria.</p>
      <p className="mt-2"><Link to="/privacy" className="underline">Privacy</Link> · <button type="button" aria-label="Take me off the list" disabled={!!busy} onClick={onOptOut} className="underline">Remove my enquiry</button></p>
    </footer>
  </div>;
}
