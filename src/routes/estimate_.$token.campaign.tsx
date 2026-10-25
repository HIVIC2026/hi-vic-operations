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
import { EXISTING_PRELIMINARY, removalNote, type EstimateRemoval } from "@/lib/estimate-removal.core";
import { REMOVAL_UPTO_NOTE, priceRangeLine, removalUpToLine } from "@/lib/estimate-removal-upto.core";
// Decision 388: this page is shown BEFORE the spot is released, so it is spot-only (no Ready Check, times, measuring,
// quote timing, speed or queue-jumping promises). Changed directly — no approval flag holds page copy.
import { SPOT_FREE, SPOT_IN_TOUCH, SPOT_ORDER, SPOT_PRICE_NOTE, SPOT_REGISTERED, SPOT_RELEASE_LINE } from "@/lib/spot-only-copy.core";

export const Route = createFileRoute("/estimate_/$token/campaign")({
  ssr: false,
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({ meta: [{ title: "Your insulation savings — Home Insulation Victoria" }, { name: "description", content: "Review your preliminary ceiling insulation savings and save your spot. It's free, with no obligation." }, { property: "og:title", content: "Your insulation savings — Home Insulation Victoria" }, { property: "og:description", content: "Review your preliminary ceiling insulation savings." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  component: CampaignPage,
});

function CampaignPage() {
  const { token } = Route.useParams();
  const getPage = useServerFn(getLaunchCampaignPage);
  const save = useServerFn(saveMySpot);
  const optOut = useServerFn(takeMeOffList);
  type CampaignData = { media?: { excluded: boolean; received: boolean; uncertain: boolean; pendingSync: boolean }; mediaReview?: string | null; saveAllowed: boolean; ownerQualified: boolean; group: "likely" | "onsite"; estimate: unknown; pricing: Pricing | null; response: { spot_saved_at: string | null; opted_out_at: string | null; queue_priority: string; media_received_at?: string | null; desk_check_status?: string; saved_total?: number | null; saved_veu_discount?: number | null } | null; referralUrl?: string | null; home?: { suburb: string | null; short: string | null }; bookingAvailable: boolean; owner: { firstName: string | null }; initialValues: { address: string; areaM2: number | null; insulation: InsulationDeclared } } | null;
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
      : data.response?.spot_saved_at ? <div className="mx-auto max-w-[760px] px-4 sm:px-8"><Result group={data.group} videoPriority={data.response.queue_priority === "video" || !!data.media?.excluded} token={token} rebate={data.response.saved_veu_discount ?? null} customer={data.response.saved_total ?? null} suburb={data.home?.suburb ?? null} home={data.home?.short ?? null} referralUrl={data.referralUrl ?? null} firstName={data.owner.firstName ?? null} /></div>
      : data.group === "onsite" && data.media?.excluded && !data.saveAllowed ? <section className="estimate-offset mx-auto max-w-[620px] px-6 py-8" role="status"><h1 className="font-display text-3xl font-bold">{data.media.received ? "We've received your insulation photos/video" : "We're checking your enquiry uploads"}</h1><p className="mt-3">{data.mediaReview === "over_r2" || data.response?.desk_check_status === "not_eligible" ? "Our office has assessed your existing insulation as not eligible. Please contact us with any questions." : data.mediaReview === "unclear" || data.response?.desk_check_status === "needs_onsite_check" ? "Your evidence has been reviewed. Our office will help with the next check." : data.media.received ? "Your existing evidence is with our office for review. You do not need to upload it again." : "You do not need to answer these questions or upload again while we check your original enquiry."}</p></section>
      : data.pricing ? <CampaignDesign saveAllowed={data.saveAllowed} ownerQualified={data.ownerQualified} reviewStatus={data.response?.desk_check_status ?? null} group={data.group} token={token} name={data.owner.firstName} suburb={data.home?.suburb ?? null} p={data.pricing} busy={busy} error={error} onSave={() => void act("save")} onOptOut={() => void act("optout")} />
      : <section className="estimate-offset mx-4 rounded-2xl border bg-white p-8 text-center"><h1 className="font-display text-2xl font-bold">Your estimate is being updated</h1><p className="mt-2 text-sm">Please check back later.</p></section>}
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
      <p className="mt-2 text-sm">{SPOT_REGISTERED} {SPOT_ORDER} You've locked in your place, so there's nothing more you need to do.</p>
      <p className="mt-2 text-sm">{SPOT_IN_TOUCH}</p>
    </div>
    <dl className="mt-4 grid gap-2 rounded-xl border border-estimate-line p-4 text-sm text-estimate-navy">
      <div className="flex justify-between gap-3"><dt>Your rebate</dt><dd className="font-bold text-estimate-logo-green">{$(rebate)}</dd></div>
      <div className="flex justify-between gap-3"><dt>You pay about</dt><dd className="font-bold">{$(customer)}</dd></div>
      {home && <div className="flex justify-between gap-3"><dt>Home</dt><dd className="text-right">{home}</dd></div>}
    </dl>
    <p className="mt-2 text-xs text-estimate-navy/70">{SPOT_PRICE_NOTE}</p>
    {group === "onsite" && !videoPriority && <div className="mt-5 rounded-xl bg-estimate-mint p-4 text-center"><h2 className="font-display text-lg font-bold text-estimate-navy">Help us check your insulation</h2><Button asChild className="mt-3 bg-estimate-green text-estimate-white hover:bg-estimate-accent"><Link to="/estimate/$token/video" params={{ token }}>Send a quick video</Link></Button></div>}
    {referralUrl && <div className="mt-5 rounded-xl bg-estimate-blush p-4 text-center">
      <h2 className="font-display text-lg font-bold text-estimate-navy">Have a friend who needs a spot saved?</h2>
      <p className="mt-1 text-sm text-estimate-navy/80">Send them our free eligibility checker. It takes a minute.</p>
      <Button type="button" onClick={() => void shareChecker()} className="mt-3 bg-estimate-green text-estimate-white hover:bg-estimate-accent">{copied ? "Link copied ✓" : "Share the checker"}</Button>
      <p className="mt-2 text-xs text-estimate-navy/70">Opens your phone's share sheet — or <button type="button" onClick={() => void shareChecker()} className="font-bold text-estimate-blue underline">copy the link</button>.</p>
    </div>}
  </section>;
}

type Pricing = { gross: number; discount: number; total: number; areaM2: number; assessmentFee: number; apFee: number; ratePerM2: number; installation: number; veecs: number; veecValue: number; address: string | null; insulation: InsulationDeclared | null; removal?: EstimateRemoval; removalUpTo?: number | null };
const money = (n: number) => `$${Math.floor(Number(n)).toLocaleString("en-AU")}`;

/** v8 (Jo, 6 Oct): Jo's approved Group A design lives here, where Outfit/Figtree load. The short email only links here. */
function CampaignDesign({ saveAllowed, ownerQualified, reviewStatus, group, token, name, suburb, p, busy, error, onSave, onOptOut }: { saveAllowed: boolean; ownerQualified: boolean; reviewStatus: string | null; group: "likely" | "onsite"; token: string; name: string | null; suburb: string | null; p: Pricing; busy: "save" | "optout" | null; error: string | null; onSave: () => void; onOptOut: () => void }) {
  const onsite = group === "onsite" && !saveAllowed;
  const rebate = money(p.discount);
  const saveBtn = <Button type="button" disabled={!!busy} onClick={onSave} className="h-14 w-full rounded-xl bg-estimate-green font-display text-lg font-bold text-estimate-white hover:bg-estimate-accent">{busy === "save" ? "Saving…" : "Save my spot →"}</Button>;
  const videoBtn = <Button asChild className="h-14 w-full rounded-xl bg-estimate-green font-display text-lg font-bold text-estimate-white hover:bg-estimate-accent"><Link to="/estimate/$token/video" params={{ token }}>Send my insulation details →</Link></Button>;
  const removal = p.insulation === "none" ? "Doesn't include removing old insulation (you told us there isn't any)." : removalNote(p.removal ?? { kind: "unknown" });
  const row = (l: string, v: string, cls = "") => <div className={`flex justify-between gap-3 py-1.5 text-sm ${cls}`}><span>{l}</span><span>{v}</span></div>;
  return <div className="mx-auto max-w-[560px] px-4 pt-5 text-estimate-navy">
    <header className="flex items-center justify-between gap-3">
      <img src={CUSTOMER_BRAND.logoUrl} alt="Home Insulation Victoria" className="h-10 w-auto" />
      <span className="whitespace-nowrap rounded-full bg-estimate-blush px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.07em]">Free estimate · No obligation</span>
    </header>
    <section className="mt-7">
      <p className={`text-[11px] font-extrabold uppercase tracking-[0.13em] ${onsite ? "text-estimate-green" : "text-estimate-logo-green"}`}>{onsite ? "Check your insulation" : "🎉 Your rebate is waiting"}</p>
      <h1 className="mt-2 font-display text-[32px] font-extrabold leading-[1.15]">{onsite ? <>{name ? `${name}, take` : "Take"} <span className="text-estimate-logo-green">{rebate}</span> off your ceiling insulation</> : <>Great news{name ? `, ${name}` : ""}! You could take <span className="text-estimate-logo-green">{rebate}</span> off your ceiling insulation</>}</h1>
      <p className="mt-4 text-[15px] leading-relaxed">Your {suburb ? `${suburb} ` : ""}home {onsite ? "could be eligible" : "looks eligible"} for the Victorian Energy Upgrades rebate. That means you pay about <strong>{money(p.total)}</strong> instead of {money(p.gross)}, and enjoy lower power bills for years to come.</p>
      <p className="mt-3 text-sm font-extrabold">{onsite ? "Help us check your insulation so you can save your spot." : `${SPOT_REGISTERED} ${SPOT_ORDER}`}</p>
      <div className="mt-5">{ownerQualified && <p className="mb-3 text-sm">Your owner declaration qualifies you to save your spot. Your eligibility and any removal costs are confirmed before you agree to anything.</p>}{onsite ? videoBtn : saveBtn}</div>
      {onsite ? <p className="mt-3 text-center text-sm">Answer either question Yes to qualify for the preliminary queue, or send photos or video for office review.</p> : <p className="mt-3 text-center text-sm">Free · no payment · no obligation</p>}
      {error && <p role="alert" className="mt-2 text-center text-sm text-danger">{error}</p>}
    </section>
    {/* Jo 22 Oct: same look as the approved Save my spot email — rebate box, big price, removal box, facts, ticked list. */}
    <section data-campaign-estimate className="mt-7 rounded-[22px] bg-estimate-mist p-5">
      <div className="rounded-[18px] border-2 border-estimate-green bg-estimate-mint px-3 py-[18px] text-center">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.13em]">Your estimated VEU rebate</p>
        <p className="mt-1 font-display text-[38px] font-extrabold leading-[42px] text-estimate-green">You could save {rebate}</p>
      </div>
      <div className="pb-3 pt-[18px] text-center">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.13em]">Your estimated cost after rebate</p>
        <p className="mt-1 font-display text-[46px] font-extrabold leading-[50px] text-estimate-blue">{money(p.total)}</p>
        <p className="mt-1 text-xs font-bold">incl. GST · before rebate {money(p.gross)}</p>
      </div>
      {p.removalUpTo != null && <div data-removal-upto className="mb-3 rounded-[14px] border border-estimate-line bg-estimate-blush px-4 py-3"><p className="text-[14px] font-semibold leading-snug">{removalUpToLine(p.removalUpTo, p.areaM2)}</p><p className="mt-1.5 text-[13px] leading-relaxed">{REMOVAL_UPTO_NOTE}</p><p className="mt-2 text-[15px] font-extrabold">{priceRangeLine(p.total, p.removalUpTo)}</p></div>}
      <div className="border-t border-estimate-line">
        {p.address && row("Property", p.address, "py-1 text-[13px] [&>span:last-child]:font-extrabold [&>span:last-child]:text-right")}
        {row("Ceiling", `${p.areaM2} m²`, "py-1 text-[13px] [&>span:last-child]:font-extrabold")}
      </div>
      {p.insulation !== "none" && <>{p.removalUpTo == null && <p className="mt-3 text-sm font-bold leading-relaxed">{removal}</p>}<p className="mt-3 text-sm leading-relaxed">{EXISTING_PRELIMINARY}</p></>}
      <p className="mt-3 text-sm leading-relaxed">{p.insulation === "none" ? removal : ""} <Link to="/estimate/$token/calculator" params={{ token }} className="font-bold text-estimate-blue">Want to explore a different ceiling size? Open the calculator →</Link></p>
      <div className="mt-3.5 rounded-[14px] bg-estimate-white px-4 py-[15px]">
        <p className="mb-1.5 font-display text-sm font-extrabold">What this includes</p>
        {[
          [`R5.0 ceiling insulation (${p.areaM2} m² × ${money(p.ratePerM2)})`, "Supplied and fitted by a certified installer.", money(p.installation)],
          ["Pre Insulation Electrical Safety Assessment (PIESA)", "By a licensed electrician, as the rules require.", money(p.assessmentFee)],
          ["Accredited Person fee", "Rebate paperwork, done for you.", money(p.apFee)],
          ...(p.removal?.kind === "included" ? [[`Removal of existing insulation (${p.removal.areaM2} m²)`, "Inc GST.", money(p.removal.amount)]] : []),
        ].map(([t, d, a], i) => <div key={t} className={`py-2 ${i ? "border-t border-estimate-line" : ""}`}>
          <div className="flex justify-between gap-3 text-sm"><span><span className="font-bold text-estimate-green">✓&nbsp;</span><strong>{t}</strong></span><span className={`whitespace-nowrap font-bold ${a === "FREE" ? "font-extrabold text-estimate-green" : ""}`}>{a}</span></div>
          <p className="text-[12.5px] leading-snug">{d}</p>
        </div>)}
      </div>
    </section>
    <section className="mt-5 rounded-[22px] bg-estimate-blush p-5">
      <h2 className="font-display text-[23px] font-extrabold leading-tight">{onsite ? "Help us check your insulation" : "Hold your place in line"}</h2>
      {onsite ? <><p className="mt-3 text-sm leading-relaxed">{INSULATION_REVIEW_INVITATION}</p><p className="mt-2 text-xs">Only if you can do it safely. Please don’t climb into or walk through the roof space.</p><div className="mt-4">{videoBtn}</div><p className="mt-3 text-center text-sm">{reviewStatus === "pending" ? "Your insulation details are awaiting office review." : reviewStatus === "not_eligible" ? "Our office has assessed your insulation as not eligible. Please contact us with any questions." : reviewStatus === "needs_onsite_check" ? "Our office needs to check a few more details before we can offer Save my spot." : "Photos and video need office review. No payment. No obligation."}</p></>
        : <><p className="mt-3 text-sm leading-relaxed">One tap and you're in. {SPOT_FREE} {SPOT_RELEASE_LINE}</p><div className="mt-4">{ownerQualified && <p className="mb-3 text-sm text-estimate-navy">Your Yes answer qualifies you to save your spot. Your existing insulation and any removal needs are confirmed before you agree to a final price.</p>}{saveBtn}</div></>}
    </section>
    <p className="mt-5 text-xs leading-relaxed text-estimate-navy/70">Estimate only. Your price can change if your ceiling is a different size, old insulation needs removing, access is tricky, or the electrician finds something to fix. We never add work or cost without showing you first and getting your OK.</p>
    <footer className="mt-6 border-t border-estimate-line pt-4 text-center text-xs text-estimate-navy/70">
      <p className="font-bold text-estimate-navy">Home Insulation Victoria</p>
      <p className="mt-1">DC Construction Solutions Pty Ltd trading as Home Insulation Victoria.</p>
      <p className="mt-2"><Link to="/privacy" className="underline">Privacy</Link> · <button type="button" aria-label="Take me off the list" disabled={!!busy} onClick={onOptOut} className="underline">Remove my enquiry</button></p>
    </footer>
  </div>;
}
