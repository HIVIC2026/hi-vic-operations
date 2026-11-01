import type React from "react";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { EngagementPanel } from "./engagement";
import { useServerFn } from "@tanstack/react-start";
import { BadgeCheck, Check, ChevronDown, ClipboardCheck, Flame, Leaf, ShieldCheck, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAdminEstimate, getAdminEstimateLink, getAdminEstimateLinkUrl, getOwnerEstimate, getAdminJobEmailPreview } from "@/lib/estimate.functions";
import { LINK_ADMIN_WARNING, LINK_COMMS_OFF, linkUsable } from "@/lib/estimatelink.core";
import { BENCHMARK_LABEL, FEE_DESCRIPTION, FEE_LABEL, dollars, type RetailSettings, type Scenario } from "@/lib/estimate.core";
import type { LocationVariables } from "@/lib/activity48.core";
import { CUSTOMER_APPROVAL_REASSURANCE, CUSTOMER_READY_CHECK_PAGE, CUSTOMER_QUOTE_LABELS, CUSTOMER_READY_CHECK, CUSTOMER_READY_CHECK_EMAIL_ACTION, CUSTOMER_WHAT_COULD_CHANGE, customerQuoteRows, discountAmount } from "@/lib/customer-quote-system";
import { READY_CHECK_BOOKING_SUCCESS, type ReadyCheckAcceptanceState } from "@/lib/readycheck.core";
import { Pill } from "./badges";
import { removalFromScenario, removalNote } from "@/lib/estimate-removal.core";
import { SPOT_RELEASE_LINE } from "@/lib/spot-only-copy.core";

export const HEADLINE = { likely: "Your home has passed our initial eligibility checks.", onsite: "Your home looks likely to qualify." } as const;
const ELIGIBILITY_COPY = {
  likely: { badge: "LIKELY ELIGIBLE", description: "Based on your answers and our initial property checks, your home is on track to qualify for a VEU insulation discount. Your ceiling area and site details are confirmed before you agree to anything." },
  onsite: { badge: "LIKELY ELIGIBLE — A FEW DETAILS TO CONFIRM", description: "Based on your answers and our initial checks, your property is a strong candidate for the VEU insulation discount. We just need to confirm a few remaining details before you agree to anything." },
} as const;
function plainOnsiteDriver(driver: string) {
  if (/insulation/i.test(driver)) return "the type and condition of existing insulation";
  if (/roof|access|cavity/i.test(driver)) return "roof space and access";
  return driver;
}

export type CustomerData = {
  visible: boolean; mode?: "likely" | "onsite"; measureRequired?: boolean; onsiteDrivers?: string[]; rolloutHold?: boolean; accessConcern?: boolean;
  fees?: { piesa: number; ap: number; minCopay: number } | null;
  calc?: { location: LocationVariables; insulation: string | null; settings: RetailSettings } | null; postcodeUnlisted?: boolean;
  estimate?: { area: { m2: number; label: string }; scenarios: Scenario[]; access_adjustment: { moderate: number; difficult: number } } | null;
};

type Est = { scenarios: Scenario[]; access_adjustment: { moderate: number; difficult: number } };

/** Customer-facing copy for the free check confirmation (presentation-only rename of the Home Insulation Ready Check). */
export const FREE_CHECK_CONFIRM_COPY = {
  name: "Free Ready Check",
  intro: "Confirm your request below. We will choose an approved installer near you, and they will offer you 3 times to pick from.",
  free: "FREE · No payment required",
  checklistHeading: "What happens at your visit",
  checklist: ["Measure your ceiling area.", "Assess any existing insulation and confirm whether it can stay or needs to be removed.", "Confirm whether your home meets the rebate eligibility requirements.", "Prepare the job scope so we can confirm your quote."],
  installer: "Carried out by a pre-vetted Certified Insulation Installer (CII) from our panel.",
  piesa: "The mandatory Pre Insulation Electrical Safety Assessment (PIESA) is a separate paid step, completed later by a licensed electrician, close to installation.",
  reassurance: "No payment required. No obligation to proceed with installation.",
  acceptance: "I understand this is a free installer visit to measure my ceiling and check eligibility details. It is not the Pre Insulation Electrical Safety Assessment (PIESA), and I have no obligation to proceed with installation.",
  cta: "Confirm my free Ready Check →",
  stale: "Your estimate changed. Please review it and confirm your free Ready Check again.",
  successHeading: "We’ve received your request",
  successBody: "We’ll choose an approved installer near you. They’ll offer you 3 times for your Free Ready Check, and we’ll send you a link to pick one. If none suit, you can suggest other days.",
  successNext: "They’ll measure your ceiling, assess any existing insulation, confirm eligibility and prepare the job scope so we can confirm your quote.",
} as const;

export function ConfirmQuote({ onBack, preview = false, testMode = preview, state = null, busy = false, error = null, onAccept, picker, canSubmit = true, after }: { estimatedPrice?: number; assessmentFee?: number; onBack: () => void; preview?: boolean; testMode?: boolean; state?: ReadyCheckAcceptanceState | null; busy?: boolean; error?: string | null; onAccept?: () => void; picker?: React.ReactNode; canSubmit?: boolean; after?: React.ReactNode }) {
  const accepted = state?.paymentStatus === "accepted";
  const [acknowledged, setAcknowledged] = useState(false);
  const C = FREE_CHECK_CONFIRM_COPY;
  return <div className="estimate-brand mx-auto max-w-[640px] text-estimate-navy">
    {testMode && <div className="mb-4 rounded-xl bg-warning-soft px-5 py-3 text-center text-xs font-extrabold uppercase text-warning-foreground">Test mode · no live booking will be created</div>}
    <div className="overflow-hidden rounded-[24px] bg-estimate-white shadow-[0_30px_70px_-45px_rgba(34,55,107,.45)]">
      {accepted ? <section role="status" aria-labelledby="confirm-quote-title" data-testid="ready-check-success" className="px-5 py-8 sm:px-9">
        <p className="text-[11px] font-extrabold uppercase tracking-[1.4px] text-[#067A45]">Request received</p>
        <h1 id="confirm-quote-title" className="mt-2 text-[28px] leading-tight text-estimate-navy sm:text-[34px]">{C.successHeading}</h1>
        <p className="mt-4 text-[15px] leading-relaxed">{C.successBody}</p>
        <p className="mt-3 text-[15px] leading-relaxed">{C.successNext}</p>
        <div className="mt-6 rounded-[18px] bg-estimate-mist px-5 py-4 text-sm font-bold leading-relaxed">{C.reassurance}</div>
        {after}
      </section> : <>
        <header className="px-5 pb-6 pt-8 sm:px-9">
          <p className="text-[11px] font-extrabold uppercase tracking-[1.4px] text-[#067A45]">Your next step</p>
          <h1 id="confirm-quote-title" className="mt-2 text-[28px] leading-tight text-estimate-navy sm:text-[34px]">{C.name}</h1>
          <p className="mt-3 text-[15px] leading-relaxed">{C.intro}</p>
          <p className="mt-4 inline-block rounded-full border-2 border-estimate-green bg-estimate-mint px-4 py-1.5 text-sm font-extrabold text-[#067A45]" data-testid="free-badge">{C.free}</p>
        </header>
        <section className="mx-3 rounded-[22px] bg-estimate-mist px-4 py-5 sm:mx-7 sm:px-6" aria-labelledby="confirm-quote-title" data-testid="ready-check-card">
          <div className="rounded-[14px] bg-estimate-white px-4 py-4">
            <h2 className="text-base text-estimate-navy">{C.checklistHeading}</h2>
            <ul className="mt-3 space-y-2.5 text-[14px] leading-snug">{C.checklist.map((item) => <li key={item} className="flex items-start gap-2.5"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-estimate-green" strokeWidth={3} /><span>{item}</span></li>)}</ul>
            <p className="mt-4 border-t border-estimate-line pt-3 text-[13px] leading-relaxed">{C.installer}</p>
          </div>
          <p className="mt-4 text-[13px] leading-relaxed">{C.piesa}</p>
        </section>
        <section className="mx-3 mt-4 rounded-[20px] bg-estimate-blush px-5 py-6 sm:mx-7" aria-label="Confirm your request">
          {!state && picker && <div className="mb-5">{picker}</div>}
          {!state && <label className="flex items-start gap-3 text-sm leading-relaxed">
            <input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1 size-5 shrink-0 accent-estimate-green" />
            <span>{C.acceptance}</span>
          </label>}
          <div className="mt-5 space-y-3">
            {!state && <button type="button" className="min-h-14 w-full rounded-xl bg-estimate-green px-5 py-4 text-base font-extrabold leading-snug text-estimate-white shadow-[0_10px_24px_-12px_rgba(7,191,97,.55)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-estimate-navy focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" disabled={!acknowledged || busy || !onAccept || !canSubmit} onClick={onAccept}>{busy ? "Sending your request…" : C.cta}</button>}
            <p className="text-center text-[13px] font-bold leading-relaxed">{C.reassurance}</p>
          </div>
        </section>
        <div className="mx-3 mt-4 rounded-[14px] bg-estimate-mist px-5 py-4 sm:mx-7"><p className="text-[13px] font-bold leading-relaxed" data-testid="approval-reassurance">{CUSTOMER_APPROVAL_REASSURANCE}</p></div>
        <div className="h-6" />
      </>}
      {(state?.stale || error) && <div className="space-y-3 px-5 pb-6 sm:px-9" data-testid="confirm-alerts">
        {state?.stale && <p className="border-l-4 border-danger bg-danger-soft px-4 py-3 text-sm font-bold" role="alert">{C.stale}</p>}
        {error && <p className="text-sm font-bold text-danger" role="alert">{error}</p>}
      </div>}
    </div>
    <button type="button" className="mt-4 min-h-12 w-full rounded-xl text-sm font-bold text-estimate-blue underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-estimate-blue" onClick={onBack}>← Back to my estimate</button>
  </div>;
}

/** Shared blue stage hero used by Ready Check, measured estimate and PIESA pages. */
export function CustomerStageHero({ eyebrow, heading, intro, id }: { eyebrow: string; heading: string; intro: string; id?: string }) {
  return <header className="rounded-[20px] bg-estimate-blue px-5 py-7 text-estimate-white sm:px-8 sm:py-9">
    <p className="text-xs font-extrabold uppercase tracking-wider text-estimate-green-light">{eyebrow}</p>
    <h1 id={id} className="mt-2 text-3xl font-extrabold leading-tight sm:text-4xl">{heading}</h1>
    <p className="mt-3 max-w-xl text-sm font-semibold leading-relaxed">{intro}</p>
  </header>;
}

/** Locked canonical breakdown: 3 service rows → project total → green discount band → large blue final cost. */
export function QuoteBreakdown({ rows, gross, discount, final, ids }: { rows: ReadonlyArray<{ key: string; label: string; amount: number }>; gross: number; discount: number; final: number; ids: { gross?: string; discount?: string; final: string } }) {
  return <div data-testid="quote-breakdown">
    <dl className="text-sm">
      {rows.map(({ key, label, amount }) => <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-estimate-blue-soft py-4"><dt className="min-w-0 font-semibold leading-relaxed">{label}</dt><dd className="font-extrabold text-estimate-blue">{dollars(amount)}</dd></div>)}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-4"><dt className="font-extrabold">{CUSTOMER_QUOTE_LABELS.projectTotal}</dt><dd className="font-extrabold text-estimate-blue" {...(ids.gross ? { "data-testid": ids.gross } : {})}>{dollars(gross)}</dd></div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border border-estimate-green/30 bg-estimate-green-soft px-4 py-4 text-estimate-green" data-testid="quote-discount-band"><dt className="font-extrabold">{CUSTOMER_QUOTE_LABELS.discount}</dt><dd className="text-2xl font-extrabold leading-none" {...(ids.discount ? { "data-testid": ids.discount } : {})}>{discountAmount(discount)}</dd></div>
    </dl>
    <div className="mt-5" data-testid="quote-final-cost">
      <p className="text-xs font-extrabold uppercase tracking-wider text-estimate-navy">{CUSTOMER_QUOTE_LABELS.finalCost}</p>
      <p className="mt-2 text-5xl font-extrabold leading-none text-estimate-blue" data-testid={ids.final}>{dollars(final)}</p>
    </div>
  </div>;
}

/** Locked in-card close for every eligible/onsite quote: What could change → GST → divider → Ready Check CTA. */
export function QuoteCardReadyCheckClose({ href, onSelect, inert = false, action }: { href?: string; onSelect?: () => void; inert?: boolean; action?: React.ReactNode }) {
  return <div data-testid="quote-card-close">
    <div className="mt-6" data-testid="quote-what-could-change">
      <h4 className="text-lg font-extrabold text-estimate-blue">{CUSTOMER_WHAT_COULD_CHANGE.heading}</h4>
      <p className="mt-3 text-sm leading-relaxed">{CUSTOMER_WHAT_COULD_CHANGE.intro}</p>
      {CUSTOMER_WHAT_COULD_CHANGE.items.length > 0 && <ul className="mt-4 space-y-3 text-sm leading-relaxed">{CUSTOMER_WHAT_COULD_CHANGE.items.map(({ lead, copy }) => <li key={lead} className="flex items-start gap-3"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-estimate-green" /><span><strong>{lead} —</strong> {copy}</span></li>)}</ul>}
      <p className="mt-5 text-sm font-extrabold leading-relaxed">{CUSTOMER_WHAT_COULD_CHANGE.closing}</p>
      <p className="mt-3 text-xs font-bold">{CUSTOMER_WHAT_COULD_CHANGE.gst}</p>
    </div>
    {action ?? <div className="mt-6 border-t border-estimate-blue-soft pt-6" data-testid="ready-check-cta">
      <p className="text-xs font-extrabold uppercase tracking-wider text-estimate-green">{CUSTOMER_READY_CHECK_EMAIL_ACTION.eyebrow}</p>
      <h4 className="mt-2 text-xl font-extrabold leading-tight text-estimate-blue">{CUSTOMER_READY_CHECK_EMAIL_ACTION.heading}</h4>
      <p className="mt-3 text-sm leading-relaxed">{CUSTOMER_READY_CHECK_EMAIL_ACTION.sentence}</p>
      <p className="mt-2 text-sm font-bold">{CUSTOMER_READY_CHECK_EMAIL_ACTION.credit}</p>
      {onSelect && !inert ? <Button type="button" size="field" className="estimate-action-button mt-5 h-auto min-h-12 w-full px-4 py-3 font-extrabold" onClick={onSelect}>{CUSTOMER_READY_CHECK.cta}</Button> : href && !inert ? <a href={href} className="estimate-action-button mt-5 flex min-h-12 w-full items-center justify-center rounded-md px-4 py-3 text-center text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{CUSTOMER_READY_CHECK.cta}</a> : <Button type="button" size="field" className="estimate-action-button mt-5 h-auto min-h-12 w-full px-4 py-3 font-extrabold disabled:opacity-100" disabled>{CUSTOMER_READY_CHECK.cta}</Button>}
      <p className="mt-3 text-center text-xs">{CUSTOMER_READY_CHECK_EMAIL_ACTION.helper}</p>
    </div>}
  </div>;
}

function PriceResult({ est, area, fees, settings, insulation, onReadyCheck, readyCheckClose }: { est: Est; area: number; fees: NonNullable<CustomerData["fees"]>; settings: RetailSettings | undefined; insulation: string | null | undefined; onReadyCheck?: () => void; readyCheckClose?: React.ReactNode }) {
  const primary = est.scenarios.find((s) => s.key === "can_remain") ?? est.scenarios[0];
  if (!primary) return null;
  const standard = primary.by_access.standard;
  const removal = removalFromScenario(primary);
  return <section className="estimate-quote-card px-5 py-7 sm:px-8 sm:py-9" aria-label="Your estimated home upgrade">
    <p className="text-xs font-semibold uppercase tracking-wider text-estimate-green">Your estimated home upgrade</p>
    <p className="mt-3 text-sm leading-relaxed text-estimate-navy/80">Based on an estimated {area} m² ceiling area{est.scenarios.some((s) => s.key === "full_removal") ? ", assuming your existing insulation can remain" : ""}.</p>
    <div className="mt-4"><QuoteBreakdown rows={[...customerQuoteRows({ piesa: fees.piesa, installation: standard.installation, apManagement: fees.ap }), ...(removal.kind === "included" ? [{ key: "removal", label: "Removal of existing insulation (inc GST)", amount: removal.amount }] : [])]} gross={standard.pre_discount_total} discount={standard.applied_discount} final={standard.estimated_customer_total} ids={{ final: "total-can_remain" }} /></div>
    {(insulation === "present" || est.scenarios.some((s) => s.key === "full_removal")) && <p className="mt-4 text-sm font-bold leading-relaxed">{removalNote(removal)}</p>}
    {settings && <p className="mt-3 text-xs leading-relaxed text-estimate-navy/75">Estimated discount: {dollars(standard.applied_discount)} — confirmed before you agree to anything.</p>}
    {standard.copayment_capped && <p className="mt-3 text-sm">Discount reduced so the minimum $200 customer contribution applies.</p>}
    <QuoteCardReadyCheckClose href="#confirm" action={readyCheckClose} {...(onReadyCheck ? { onSelect: onReadyCheck } : {})} />
  </section>;
}

const insulationSource = "https://www.energy.vic.gov.au/victorian-energy-upgrades/products/insulation-discounts";
const energyTipsSource = "https://www.energy.vic.gov.au/households/save-energy-and-money/top-10-energy-saving-tips";
function HouseholdBenefits() {
  const id = useId();
  return <section aria-labelledby={id}>
    <h3 id={id} className="text-xl font-bold text-estimate-navy sm:text-2xl">What this upgrade could mean for your home</h3>
    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      {[
        { icon: Leaf, value: "$400+ / year*", label: "average potential energy-bill savings from upgrading ceiling insulation" },
        { icon: Flame, value: "Up to 20%*", label: "potential savings on heating and cooling costs" },
        { icon: Sun, value: "Comfortable all year.", label: "Better year-round comfort with less energy wasted through the ceiling." },
      ].map(({ icon: Icon, value, label }) => <div key={value} className="border-t-2 border-estimate-green px-1 py-5"><Icon aria-hidden="true" className="mb-4 size-6 text-estimate-green" /><p className="text-lg font-bold leading-snug text-estimate-navy">{value}</p><p className="mt-2 text-sm leading-relaxed">{label}</p></div>)}
    </div>
    <p className="mt-4 text-sm leading-relaxed">That means insulation isn&apos;t just an upfront upgrade — it can keep reducing energy use and household running costs year after year.</p>
    <p className="mt-3 text-xs leading-relaxed">*Victorian Government estimates/averages. Actual savings vary with your home, climate, energy use, energy prices and heating/cooling habits. <a href={insulationSource} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">Insulation discounts</a> · <a href={energyTipsSource} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">Energy-saving tips</a></p>
  </section>;
}

function PriceProtection({ settings, fees }: { settings: RetailSettings | undefined; fees: NonNullable<CustomerData["fees"]> }) {
  const id = useId();
  const pct = (m: number) => `${Math.round((m - 1) * 100)}%`;
  const rows = [
    ...(settings ? [`R5.0 insulation: ${dollars(settings.r5_install_inc_gst_per_m2)}/m² inc GST`, `Removal, if required: ${dollars(settings.removal_inc_gst_per_m2)}/m² inc GST`] : []),
    `${CUSTOMER_QUOTE_LABELS.piesa}: ${dollars(fees.piesa)} inc GST`,
    `${CUSTOMER_QUOTE_LABELS.apManagement}: ${dollars(fees.ap)} inc GST`,
    ...(settings ? [`Access adjustments: fixed +${pct(settings.access_moderate_multiplier)} moderate / +${pct(settings.access_difficult_multiplier)} difficult on the installation component`] : []),
    "electrical fixes: separately itemised and approved before work",
  ];
  return <section aria-labelledby={id} className="border-y border-estimate-blue-soft py-7">
    <p className="text-xs font-semibold uppercase tracking-wider text-estimate-green">Price protection</p>
    <h3 id={id} className="mt-2 text-xl font-bold leading-snug text-estimate-navy sm:text-2xl">Transparent Home Insulation Victoria pricing — no installer mark-up surprises.</h3>
    <p className="mt-3 text-sm leading-relaxed">Home Insulation Victoria sets the customer pricing. Once your home’s details are confirmed, your final price is calculated from our set customer rate card. Our partner electricians and insulation installers do not decide what you pay.</p>
    <ul className="mt-5 grid gap-x-7 gap-y-3 text-sm sm:grid-cols-2">{rows.map((r) => <li key={r} className="flex items-start gap-2 leading-snug"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-estimate-green" />{r}</li>)}</ul>
    <p className="mt-4 text-xs leading-relaxed">Your final total still depends on your actual ceiling area, whether removal is needed, access and any electrical fixes.</p>
  </section>;
}

function ManagedProcess() {
  const id = useId();
  const cards = [
    { icon: ShieldCheck, title: "Licensed Pre Insulation Electrical Safety Assessment (PIESA)", copy: "Your PIESA is completed by a licensed electrician employed by a Registered Electrical Contractor (REC). They check the ceiling space for unsafe wiring, prohibited lighting such as halogen downlights, solar/battery cabling and other electrical hazards before insulation work proceeds.", note: "" },
    { icon: BadgeCheck, title: "Installer", copy: "Your insulation upgrade is carried out by an Installer (CII) — the certification required for installers working under the VEU ceiling-insulation activity.", note: "CII certification covers the competency pathway for safe retrofit insulation work, including WHS, measurements and calculations, working safely at heights and bulk insulation installation." },
    { icon: ClipboardCheck, title: "We manage it end-to-end", copy: "Eligibility, vetted trades, quoting, compliance, evidence, installation coordination and VEEC processing — managed through one Home Insulation Victoria process.", note: "" },
  ];
  return <section aria-labelledby={id}>
    <p className="text-xs font-semibold uppercase tracking-wider text-estimate-green">Why Home Insulation Victoria</p>
    <h3 id={id} className="mt-2 text-xl font-bold leading-snug text-estimate-navy sm:text-2xl">One managed pathway. The right qualified people. No chasing trades.</h3>
    <p className="mt-3 text-sm leading-relaxed sm:text-base">From eligibility through to installation and VEEC processing, Home Insulation Victoria coordinates the people, paperwork and compliance for you.</p>
    <div className="mt-5 grid gap-3">
      {cards.map(({ icon: Icon, title, copy, note }) => <div key={title} className="flex items-start gap-4 border-b border-estimate-blue-soft px-1 py-5 last:border-b-0">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-estimate-green-soft"><Icon aria-hidden="true" className="size-5 text-estimate-green" /></span>
        <div><p className="font-bold leading-snug text-estimate-navy">{title}</p><p className="mt-1.5 text-sm leading-relaxed">{copy}</p>{note && <p className="mt-2 text-xs leading-relaxed">{note}</p>}</div>
      </div>)}
    </div>
    <p className="mt-4 text-sm font-semibold leading-relaxed">You don&apos;t need to work out which trades meet the program requirements — we coordinate appropriately qualified participants for the job.</p>
  </section>;
}

function RemovalNote({ est }: { est: Est }) {
  const removal = est.scenarios.find((s) => s.key === "full_removal");
  if (!removal) return null;
  return <p className="estimate-secondary-card text-sm leading-relaxed">If full removal is required, your estimated total would be around <strong data-testid="total-full_removal">{dollars(removal.by_access.standard.estimated_customer_total)}</strong>. Whether removal is actually needed is confirmed before you agree to anything.</p>;
}

/** Customer-facing estimate. Renders nothing when Gate 1 does not permit display. */
export function CustomerEstimate({ data, publicPage = false, onReadyCheck, readyCheckClose }: { data: CustomerData; publicPage?: boolean; onReadyCheck?: (() => void) | undefined; readyCheckClose?: React.ReactNode }) {
  if (!data.visible || !data.mode) return null;
  const fees = data.fees;
  const Heading = publicPage ? "h1" : "h2";
  return (
    <div className="estimate-brand space-y-8 text-estimate-navy sm:space-y-11" aria-label="Indicative estimate">
       <div className="border-b border-estimate-blue-soft pb-7 sm:pb-9">
         <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-estimate-green">GOOD NEWS</p>
         <Heading className="max-w-[620px] text-3xl font-bold leading-tight text-estimate-navy sm:text-4xl">{HEADLINE[data.mode]}</Heading>
          <span className="mt-5 inline-flex max-w-full rounded-md bg-estimate-green-soft px-3 py-2 text-xs font-bold uppercase leading-snug text-estimate-green">{ELIGIBILITY_COPY[data.mode].badge}</span>
          <p className="mt-4 max-w-[620px] text-sm leading-relaxed text-estimate-navy/85 sm:text-base">{ELIGIBILITY_COPY[data.mode].description}</p>
         {data.mode === "onsite" && !!data.onsiteDrivers?.length && <p className="mt-3 text-sm leading-relaxed text-estimate-navy"><span className="font-bold">We just need to confirm:</span> {[...new Set(data.onsiteDrivers.map(plainOnsiteDriver))].join(" · ")}</p>}
       </div>
      {data.rolloutHold && <p className="rounded-xl bg-estimate-blue-soft px-4 py-3 text-sm">Assessments for private homes open from 1 October 2026. This is a scheduling hold only, not an eligibility result.</p>}
      {!fees ? <p className="rounded-xl bg-estimate-blue-soft px-4 py-3 text-sm">Your estimate is being prepared.</p> : <>
         {data.estimate ? <PriceResult est={data.estimate} area={data.estimate.area.m2} fees={fees} settings={data.calc?.settings} insulation={data.calc?.insulation} readyCheckClose={readyCheckClose} {...(onReadyCheck ? { onReadyCheck } : {})} /> : <p className="rounded-xl bg-estimate-blue-soft px-4 py-3 text-sm">{data.postcodeUnlisted ? "We can't calculate a VEU discount for this postcode yet because it isn't in the official VEU location list. We'll confirm your pricing directly." : "Your estimate is being prepared."}</p>}
         {data.estimate && <><RemovalNote est={data.estimate} /><HouseholdBenefits /><PriceProtection settings={data.calc?.settings} fees={fees} /><ManagedProcess /></>}
        {data.calc && <details className="group border-b border-estimate-blue/20 pb-5 text-sm"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-bold text-estimate-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">How is the VEU discount estimated? <ChevronDown aria-hidden="true" className="size-5 shrink-0 transition-transform group-open:rotate-180" /></summary><p className="mt-4 leading-relaxed">We use the official Activity 48 postcode/climate calculation and a {dollars(data.calc.settings.indicative_veec_value)} consumer benchmark calibrated to the Victorian Government&apos;s published example. Final certificate values can change. This is not the live VEEC market price.</p>{data.calc.settings.veec_value_source_url?.startsWith("https://") && <a className="mt-2 inline-block font-bold text-estimate-blue underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" href={data.calc.settings.veec_value_source_url} target="_blank" rel="noopener noreferrer">View the published example <span aria-hidden="true">↗</span></a>}</details>}
      </>}
    </div>
  );
}

export function OwnerEstimateCard({ jobId }: { jobId: string }) {
  const fn = useServerFn(getOwnerEstimate);
  const { data } = useQuery({ queryKey: ["owner_estimate", jobId], queryFn: () => fn({ data: { jobId } }) as Promise<CustomerData> });
  // Decision 388: shown only at enquiry stages (before release), so the close is spot-only, never a Ready Check button.
  return data ? <CustomerEstimate data={data} readyCheckClose={<p role="status" className="mt-6 border-t border-estimate-blue-soft pt-6 font-bold">{SPOT_RELEASE_LINE}</p>} /> : null;
}

const r = (n: number, d = 4) => Number(n).toFixed(d);
export function AdminEstimateCard({ jobId }: { jobId: string }) {
  const fn = useServerFn(getAdminEstimate);
  const { data: v, isLoading } = useQuery({ queryKey: ["admin_estimate", jobId], queryFn: () => fn({ data: { jobId } }) });
  if (isLoading) return <div className="rounded-xl border p-4 text-sm text-muted-foreground">Loading estimate…</div>;
  if (!v) return null;
  const e = v.estimate, s = v.settings;
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Step 3 · Indicative estimate</h3>
        {e ? <Pill t="good">Current v{e.settings_version} · {new Date(e.created_at).toLocaleString("en-AU")}</Pill> : <Pill t="warn">Not shown to customer</Pill>}
      </div>
      {v.reason && <p className="mb-3 rounded bg-warning-soft px-3 py-2 text-sm font-medium">{v.reason}</p>}
      {e && (
        <div className="mb-3 grid gap-1 text-sm sm:grid-cols-2">
          <div>Area: <b>{e.area.m2} m²</b> — {e.area.label} ({e.area.basis})</div>
          <div>Postcode {e.location.postcode}: <b>{e.location.metropolitan_or_regional} / {e.location.climate_region}</b> (zone {e.location.climate_zone}, Spec v{e.location.source_version})</div>
          <div>GHG reduction: {e.ghg.formula} = <b>{r(e.ghg.ghgReduction)} t CO2-e</b> (≈ VEEC equivalent)</div>
          <div>× ${Number(s?.indicative_veec_value).toFixed(2)} {BENCHMARK_LABEL.toLowerCase()} (settings v{s?.version}, not market price) = raw {dollars(e.raw_estimated_discount)} · applied {dollars(e.applied_discount)} (<a className="underline" href={s?.veec_value_source_url} target="_blank" rel="noreferrer">source</a>, checked {s?.veec_value_checked_at})</div>
          <div>{FEE_LABEL}: {dollars(Number(s?.ap_management_inc_gst))}</div>
          <div>Insulation declared: {v.insulationDeclared ?? "not answered"} · scenarios: {e.scenarios.length}</div>
          <div>Access totals (primary): {(["standard", "moderate", "difficult"] as const).map((a) => `${a} ${dollars(e.primary.by_access[a].estimated_customer_total)}`).join(" · ")}</div>
        </div>
      )}
      <EstimateLinkPanel jobId={jobId} />
      <EngagementPanel jobId={jobId} />
      <AdminCustomerEmailPreview jobId={jobId} estimateId={e?.id} />
      {e && <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">Exact calculation audit</summary><pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-2">{JSON.stringify({ area: e.area, location: e.location, ghg: e.ghg, raw_estimated_discount: e.raw_estimated_discount, scenarios: e.scenarios, settings: s, history: v.history }, null, 2)}</pre></details>}
    </section>
  );
}

function AdminCustomerEmailPreview({ jobId, estimateId }: { jobId: string; estimateId?: string }) {
  const fn = useServerFn(getAdminJobEmailPreview);
  const { data, isPending, error, refetch } = useQuery({ queryKey: ['admin_job_email_preview', jobId, estimateId], queryFn: () => fn({ data: { jobId } }), retry: false });
  return <div className="min-w-0 rounded-lg border border-dashed p-3 sm:p-5">
    <h4 className="mb-4 text-xs font-bold uppercase text-muted-foreground">Customer-facing preview</h4>
    {isPending ? <p className="text-sm text-muted-foreground">Loading customer email…</p> : error ? <div role="alert"><p className="text-sm text-danger">Could not load the customer email preview.</p><Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button></div> : data?.mail ? <>
      <p className="mb-3 text-sm font-semibold">{data.mail.subject}</p>
      <iframe title="Customer-facing email preview" sandbox="" referrerPolicy="no-referrer" srcDoc={data.mail.html} className="h-[750px] w-full min-w-0 border" />
    </> : <p className="text-sm text-muted-foreground">{data?.reason}</p>}
  </div>;
}

type LinkStatus = { link: { status: string; created_at: string; expires_at: string; revocation_reason: string | null; last_viewed_at: string | null; view_count: number } | null; delivery: { ready: boolean; state: string; consent: boolean; commsEnabled: boolean } };
/** Admin-only link management. The token is fetched only on an explicit click; never auto-copied or sent. */
function EstimateLinkPanel({ jobId }: { jobId: string }) {
  const statusFn = useServerFn(getAdminEstimateLink);
  const urlFn = useServerFn(getAdminEstimateLinkUrl);
  const { data } = useQuery({ queryKey: ["admin_estimate_link", jobId], queryFn: () => statusFn({ data: { jobId } }) as Promise<LinkStatus> });
  const [url, setUrl] = useState<string | null>(null);
  if (!data) return null;
  const l = data.link;
  const active = linkUsable(l ?? null);
  const reveal = async () => { const r = await urlFn({ data: { jobId } }); setUrl(r.path ? `${window.location.origin}${r.path}` : null); };
  return (
    <div className="mb-3 rounded-lg border p-3 text-sm" data-testid="estimate-link-panel">
      <div className="mb-1 flex flex-wrap items-center gap-2"><b>Secure customer estimate link</b>{active ? <Pill t="good">Active</Pill> : <Pill t="warn">{l ? l.status : "Not prepared"}</Pill>}</div>
      {l && <div className="text-muted-foreground">Created {new Date(l.created_at).toLocaleString("en-AU")} · views {l.view_count}{l.last_viewed_at ? ` (last ${new Date(l.last_viewed_at).toLocaleString("en-AU")})` : ""}{l.revocation_reason ? ` · ${l.revocation_reason}` : ""}</div>}
      <div className="mt-1 font-medium">{data.delivery.commsEnabled ? (data.delivery.ready ? "Delivery allowed (not sent automatically)" : "Owner contact consent missing — delivery not allowed") : LINK_COMMS_OFF}</div>
      {active && <p className="mt-1 text-xs text-warning-foreground">{LINK_ADMIN_WARNING}</p>}
      {active && (url
        ? <div className="mt-2 flex flex-wrap gap-2"><input readOnly className="h-10 flex-1 rounded border bg-background px-2 text-xs" value={url} /><button type="button" className="h-10 rounded border px-3" onClick={() => navigator.clipboard.writeText(url)}>Copy</button><a className="h-10 rounded border px-3 leading-10" href={url} target="_blank" rel="noreferrer noopener">Open</a></div>
        : <button type="button" className="mt-2 h-10 rounded border px-3" onClick={reveal}>Show link (admin only)</button>)}
    </div>
  );
}
