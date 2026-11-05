import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Phone } from "lucide-react";
import { cancelMyJob, finishLifeSupportPlanUploadFn, getLifeSupportPlanState, getOwnerMyJob, startLifeSupportPlanUploadFn } from "@/lib/owner-myjob.functions";
import { supabase } from "@/integrations/supabase/client";
import { OwnerHouse } from "@/components/owner/OwnerHouse";
import { agreedWithLabel, ownerPriceTitle } from "@/lib/owner-confirm.core";
import { HOUSE_LEVEL } from "@/lib/owner-house.core";
import { ownerHeadline } from "@/lib/owner-headlines.core";
import { gateACard, QUOTE_NOT_READY_OWNER_LINE, SPOT_SAVED_PROGRESS, spotSavedLayout, resolveOwnerScreen } from "@/lib/owner-myjob.core";
import { quoteSittingBlockers } from '@/lib/owner-quote-sign.core';
import { ownerPaperworkFn } from "@/lib/owner-gates.functions";
import { visitPill, type OwnerScreen } from "@/lib/owner-myjob.core";
import { SPOT_FREE, SPOT_PRICE_NOTE, SPOT_RELEASE_LINE, SPOT_WAIT_LINE } from "@/lib/spot-only-copy.core";
import { paymentPlan } from "@/lib/payments.core";
import { QUOTE_CHANGES_FOOTNOTE, QUOTE_CHANGES_HEADING } from "@/lib/quote-changes.core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { OwnerPaperwork } from "@/components/owner/OwnerPaperwork";
import { OwnerConfirmSignPay } from "@/components/owner/OwnerConfirmSignPay";
import { OwnerSignAndPay } from "@/components/owner/OwnerSignAndPay";
import { OwnerCodeGate, signBtn } from "@/components/owner/OwnerSign";
import { ownerAcceptQuoteFn, ownerAgreementFn, ownerQuoteDocumentFn, ownerBookingStateFn, ownerCardCheckoutFn, ownerChoosePiesaFn, ownerDeclineQuoteFn, ownerSuggestInstallDaysFn, ownerTakeInstallDayFn, ownerVeecAssignmentFn, ownerSignVeecAssignmentFn, ownerPiesaConfirmFn, ownerSignPiesaConfirmFn, ownerTakePiesaTimeLinkFn, ownerSuggestPiesaDaysLinkFn, ownerReviewStateFn, ownerReviewStarsFn, ownerReviewFeedbackFn, ownerFixesStateFn, ownerApproveFixesFn, ownerPickFixesTimeFn, ownerRepeatPiesaFn, ownerAcceptRepeatPiesaFn } from "@/lib/owner-link.functions";
import { OWNER_FIXES_COPY, ownerFixesNeedsOwner } from "@/lib/owner-fixes.core";
import { REVIEW_COPY, REVIEW_FEEDBACK_MAX } from "@/lib/owner-review.core";
import { parseStars, reviewScreen } from "@/lib/owner-review-screen.core"; // speed (portal speed step 2B): validateSearch loads only these
import { DECLINE_REASONS, OWNER_DECLINED_SCREEN, type DeclineReason } from "@/lib/quote-decline.core";
import { melbourneToday, addYmd } from "@/lib/melbourne-time.core";
import { formatInstallDay } from "@/lib/install-days.core";
import { PIESA_OWNER_SUGGEST_MAX, formatPiesaTime } from "@/lib/piesa-times.core";
import { OwnerReadyCheckTimes } from "@/components/owner/OwnerReadyCheckTimes";
import { OwnerRunTime } from "@/components/owner/OwnerRunTime";
import { AuthorityChoice, FactRows, FormCard, InfoBox, LockHint, LockedButton, OwnerFooter, OwnerPageHeader, PageIntro, SectionTitle, SmallNote, ThirtyDayClock, TickCard, TypedField } from "@/components/owner/OwnerPageKit";
import { OFFICE_EMAIL, P2, P3, P4, P6, centsAud, dayMonth, declarationBullets, longDate, shortAud, weekdayDate } from "@/lib/owner-pages.core";
import { ownerConfirmTurnFn, ownerDeclineTurnFn, ownerTurnStateFn } from "@/lib/spot-release.functions";
import { LEGACY_WHAT_HAPPENS_NEXT, SPOT_RELEASE_PAGE, type OwnerTurnView } from "@/lib/spot-release.core";
import { ownerRequestNewQuoteFn } from "@/lib/new-quote-request.functions";
import { NEW_QUOTE_THANKS } from "@/lib/new-quote-request.core";
import { ownerQuickTapsAddressSearchFn, ownerQuickTapsDetailsFn, ownerQuickTapsSaveFn, ownerQuickTapsStateFn } from "@/lib/quick-taps.functions";
import { QUICK_TAPS_COPY, nextTapStep, quickTapsGoLabel, quickTapsPassLine, tapOutcome, websiteQuestions, type QuickTapAnswers, type QuickTapsView } from "@/lib/quick-taps.core";
import { RENTAL_DONE_LINE, RENTAL_TAPS, nextRentalStep, rentalDetailsProblems, rentalWhoChoices, type RentalAnswersInput, type RentalStep } from "@/lib/rental-answers.core";
import { createAddressPicker, type PickResult } from "@/lib/address-pick.core";
import { assertInHouseActionSucceeded } from "@/lib/in-house.core";
import { completeOwnerQuoteAcceptance, ownerQuoteCanAccept } from "@/lib/owner-quote-visibility.core";
import { replacedOwnQuoteLine } from '@/lib/own-customer-quote-messages.core';

// Owner "My job" — no login. The secure link token is the only credential; nothing fetched during SSR.
// Decision 335: "review" = the O51 star links (?screen=review&stars=N).
// Decision 366: "fixes" = the electrical upgrades screen (O29's approve link): approve → pay in full → pick the electrician's time.
// Decision 389: "turn" = "It's your turn" (O77's link): Confirm the free Ready Check, or no longer interested.
// Batch 3a: "newquote" = O78's "Send me a new quote" button: the request runs on arrival, then the approved thanks line.
// A48 batch 2: "taps" = the quick taps (the batch text's link): one question per screen, big buttons.
const SCREENS = ["home", "spot", "quote", "pay", "piesa", "veec", "book", "done", "review", "fixes", "turn", "newquote", "taps", "clear", "finish"] as const satisfies readonly OwnerScreen[];

export const Route = createFileRoute("/my-job/$token")({
  ssr: false,
  // Same rule as the former zod schema (optional enum, anything else rejected) without pulling zod into every page's first load (decision 280).
  // SCREENS mirrors the OwnerScreen union in owner-myjob.core.
  validateSearch: (s: Record<string, unknown>): { screen?: OwnerScreen; stars?: number; only?: "rental"; quote?: string } => {
    const screen = s["screen"];
    if (screen === undefined) return {};
    if (typeof screen === "string" && (SCREENS as readonly string[]).includes(screen)) {
      if(screen==='quote' && typeof s['quote']==='string' && /^[0-9a-f-]{36}$/i.test(s['quote'])) return {screen:'quote',quote:s['quote']};
      // Decision 335: ?stars=1..5 only on the review screen; anything else is ignored (never an error page from an email).
      const stars = screen === "review" ? parseStars(s["stars"]) : null;
      // Task 19 (answer 24): ?screen=taps&only=rental = an installer's own customer answering only the rental questions.
      if (screen === "taps" && s["only"] === "rental") return { screen: "taps", only: "rental" };
      return stars ? { screen: screen as OwnerScreen, stars } : { screen: screen as OwnerScreen };
    }
    throw new Error("Invalid screen");
  },
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }),
  head: () => ({
    meta: [
      { title: "My job — Home Insulation Victoria" },
      { name: "description", content: "See where your insulation job is up to and what happens next." },
      { property: "og:title", content: "My job — Home Insulation Victoria" },
      { property: "og:description", content: "Your insulation job, step by step." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: MyJobPage,
});

type View = NonNullable<Awaited<ReturnType<typeof getOwnerMyJob>>> & Record<string, any>;
const aud = (v: number | null | undefined) => Math.max(0, Number(v ?? 0)).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Melbourne" });

function MyJobPage() {
  const { token } = Route.useParams();
  const { screen: requestedScreen, stars, only, quote: requestedQuote } = Route.useSearch();
  const load = useServerFn(getOwnerMyJob);
  const { data, isLoading } = useQuery({ queryKey: ["my-job", token], queryFn: () => load({ data: { token } }) as Promise<View | null>, staleTime: 30_000, retry: false, refetchOnWindowFocus: false });
  const screen = resolveOwnerScreen(requestedScreen, data ? { ...data, piesaConfirm: data.piesaConfirm === true } : {});
  return (
    <div className="estimate-brand min-h-screen bg-estimate-canvas pb-10 text-estimate-navy">
      {/* Approved pages P2–P4 (Jo 24 Oct): white bar, logo left, job number right. */}
      <OwnerPageHeader right={data?.jobNumber ? (data.spotSaved ? `Job ${data.jobNumber}` : data.jobNumber) : undefined} partnerLogo={data?.cobrand ?? null} />
      <main className="mx-auto max-w-[560px] space-y-4 px-4 pt-5 sm:px-5">
        {isLoading ? <p role="status" className="py-10 text-center text-sm">Opening your job…</p>
          : !data ? <Unavailable />
          : screen === "review" ? <ReviewScreen token={token} initialStars={stars ?? null} />
          : screen === "turn" ? <TurnScreen token={token} />
          : screen === "taps" ? <TapsScreen v={data} token={token} only={only} />
          : screen === "newquote" ? <NewQuoteScreen v={data} token={token} />
          : screen === "quote" && requestedQuote && data.replacedQuoteIds?.includes(requestedQuote) ? <section className="py-8"><p role="status" className="text-lg font-semibold">{replacedOwnQuoteLine(data.replacementSentAt)}</p><Link to="/my-job/$token" params={{token}} search={{screen:'quote'}} className="mt-3 inline-flex min-h-12 items-center underline">See the current quote</Link></section>
          : screen === "quote" ? <>{!requestedQuote && data.replacedQuoteIds?.length > 0 && <p role="status" className="text-sm font-semibold">{replacedOwnQuoteLine(data.replacementSentAt)}</p>}<QuoteScreen v={data} token={token} /></>
          : screen === "pay" ? <><RepeatPiesaCard token={token} /><PayNowCard v={data} token={token} /></>
          : screen === "clear" ? <OwnerConfirmSignPay v={data} token={token} />
          : screen === "finish" ? <OwnerSignAndPay token={token} />
          : screen === "piesa" ? <PiesaConfirmCard v={data} token={token} />
          : screen === "veec" ? <VeecAssignmentCard v={data} token={token} />
          : screen === "fixes" ? <FixesScreen v={data} token={token} />
          : screen === "book" ? <BookScreen v={data} token={token} />
          : screen === "done" ? <DoneScreen v={data} token={token} />
          : screen === "spot" ? <SpotScreen v={data} token={token} />
          : <AllSetScreen v={data} />}
      </main>
    </div>
  );
}

/** Nothing is needed from the owner. G8 (4), Jo 4 Nov 2026: when a visit is booked, the screen says which one, when and who
 *  is coming (owner-myjob.core nextVisitCard); otherwise the plain all-set line. */
function AllSetScreen({ v }: { v: View }) {
  const next = (v as { nextVisit?: { title: string; line: string; note: string | null } | null }).nextVisit ?? null;
  return <section className="py-8" data-testid="owner-all-set">
    <h1 className="font-display text-2xl font-bold">You're all set{v.firstName ? `, ${v.firstName}` : ''}.</h1>
    {next ? <div className="mt-4 rounded-[22px] bg-card p-5 shadow-sm" data-testid="owner-next-visit">
      <p className="text-xs font-bold uppercase tracking-wide text-estimate-navy/70">Your next visit</p>
      <p className="mt-1 font-display text-lg font-extrabold">{next.title}</p>
      <p className="mt-1 text-sm">{next.line}</p>
      {next.note && <p className="mt-2 text-sm font-semibold">{next.note}</p>}
    </div> : null}
    <p className="mt-3">We'll email you when there's a next step.</p>
  </section>;
}

function Unavailable() {
  return <div className="rounded-[22px] bg-card p-6 text-center shadow-sm"><p className="font-display text-xl font-extrabold">This link isn't working</p><p className="mt-2 text-sm">It may have expired. Visit our website contact page and we'll send you a fresh one.</p></div>;
}

function Hero({ v, level, size = "lg", headline }: { v: View; level: number; size?: "sm" | "lg"; headline: string }) {
  const step = v.hero.step as number;
  return (
    <section data-testid="owner-hero" className="rounded-[26px] border border-estimate-line bg-estimate-mist p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {v.firstName && <p className="text-sm font-semibold">Hi {v.firstName}</p>}
          <h1 className="mt-1 font-display text-2xl font-extrabold leading-tight">{headline}</h1>
          {v.address && <p className="mt-2 text-sm text-estimate-navy/80">{v.address}</p>}
        </div>
        <OwnerHouse level={level} size={size} />
      </div>
      {size === "lg" && !v.hero.closed && <>
        <div className="mt-4 grid grid-cols-5 gap-1.5" aria-hidden>{[0, 1, 2, 3, 4].map((i) => <span key={i} className={`h-2 rounded-full ${i < step || v.stage === "complete" ? "bg-estimate-green" : i === step ? "bg-estimate-blue" : "bg-estimate-line"}`} />)}</div>
        <div className="mt-2 flex justify-between text-xs font-semibold"><span>Step {Math.min(step + 1, 5)} of 5 · {v.progress[step]?.label}</span><span className="text-estimate-green">You're saving {aud(v.numbers.rebate)}</span></div>
      </>}
    </section>
  );
}

/** Jo 28 Oct (decision 158, OFFICE CHOOSES): lapsed window → "arranging the next step", then the new safety check + Accept. */
function RepeatPiesaCard({ token }: { token: string }) {
  const loadRepeat = useServerFn(ownerRepeatPiesaFn);
  const acceptRepeat = useServerFn(ownerAcceptRepeatPiesaFn);
  const { data: repeat, refetch } = useQuery({ queryKey: ["owner-repeat-piesa", token], queryFn: () => loadRepeat({ data: { token } }) });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  if (!repeat) return null;
  return <section data-testid="repeat-piesa" className="rounded-[22px] bg-card p-5 text-sm shadow-sm">
    <p className="font-display text-lg font-extrabold">{repeat.title}</p>
    <p className="mt-2">{repeat.body}</p>
    {repeat.price && <p className="mt-2 font-bold">{repeat.price}</p>}
    {err && <p className="mt-2 font-bold text-destructive">{err}</p>}
    {repeat.button && <button type="button" className={`${signBtn} mt-3`} disabled={busy} onClick={async () => { setErr(""); setBusy(true); try { await acceptRepeat({ data: { token } }); await refetch(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } }}>{busy ? "Saving…" : repeat.button}</button>}
  </section>;
}

function Home({ v, token }: { v: View; token: string }) {
  const a = v.action;
  const loadRepeat = useServerFn(ownerRepeatPiesaFn);
  const { data: repeat } = useQuery({ queryKey: ["owner-repeat-piesa", token], queryFn: () => loadRepeat({ data: { token } }) });
  if (repeat) return <><RepeatPiesaCard token={token} /><Hero v={v} level={v.hero.level} headline={v.hero.headline} /></>;
  return <>
    {/* Part 4 Task 14 (Jo 2 Nov 2026): the separate P3 consent step, the fixes home card and the P6F confirm-fixes page are gone —
        the consent is signed on the confirm-and-pay page (?screen=clear); a job mid-way through an old fixes quote opens ?screen=fixes directly. */}
    {/* Decision 296 (P6): between the electrician's PIESA and the install day the owner confirms the safety check here; unsigned = the page. */}
    {v.piesaConfirm && <PiesaConfirmCard v={v} token={token} />}
    <LifeSupportPlanCard token={token} />
    <Hero v={v} level={v.hero.level} headline={v.hero.headline} />
    <OwnerRunTime token={token} />
    <OwnerReadyCheckTimes token={token} />
    <StatusSnapshot v={v} />
    <PayNowCard v={v} token={token} />
    <section className="rounded-[22px] bg-estimate-navy p-5 text-estimate-canvas">
      <p className="text-xs font-bold uppercase tracking-wide text-estimate-canvas/70">{a.kicker}</p>
      <h2 className="mt-1 font-display text-xl font-extrabold">{a.title}</h2>
      <p className="mt-1 text-sm text-estimate-canvas/85">{a.sentence}</p>
      {a.pill && <span className="mt-3 inline-block rounded-full bg-owner-house-pink px-3 py-1 text-sm font-bold text-estimate-navy">{a.pill}</span>}
      {a.button && <Link to="/my-job/$token" params={{ token }} search={{ screen: a.button.screen as OwnerScreen }} className="mt-4 flex h-12 w-full items-center justify-center rounded-full bg-estimate-green font-bold text-estimate-canvas">{a.button.label}</Link>}
    </section>
    {v.visit && v.trade && (
      <section className="rounded-[22px] bg-card p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-estimate-navy/60">Who's coming</p>
        <div className="mt-2 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-estimate-mist font-display text-lg font-extrabold">{v.trade.initial}</span>
          <div className="min-w-0 flex-1"><p className="font-bold">{v.trade.name}</p>{v.trade.company && <p className="text-sm">{v.trade.company}</p>}<p className="text-sm">{visitPill(v.visit.startsAt)}</p></div>
          {v.trade.phone && <a href={`tel:${v.trade.phone}`} aria-label={`Call ${v.trade.name}`} className="flex h-12 w-12 items-center justify-center rounded-full bg-estimate-green text-estimate-canvas"><Phone className="h-5 w-5" /></a>}
        </div>
        <p className="mt-3 text-sm">We'll text you the day before.</p>
      </section>
    )}
    <section className="rounded-[22px] bg-card p-5 shadow-sm">
      <p className="font-display text-lg font-extrabold">Your progress</p>
      <ol className="mt-3 space-y-2">{v.progress.map((p: any) => (
        <li key={p.label} className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2 font-semibold">{p.state === "done" ? <Check className="h-4 w-4 text-estimate-green" /> : <span className={`h-2.5 w-2.5 rounded-full ${p.state === "now" ? "bg-estimate-blue" : "bg-estimate-line"}`} />}{p.label}</span>
          <span className={p.state === "done" ? "text-estimate-green" : p.state === "now" ? "font-bold text-estimate-blue" : "text-estimate-navy/60"}>{p.state === "done" ? `Done${p.at ? ` ${day(p.at)}` : ""}` : p.mustBy ? `Must be by ${day(p.mustBy)}` : p.state === "now" ? "Now" : "To come"}</span>
        </li>))}</ol>
    </section>
    {/* Jo 4 Nov 2026 16:10 (approved): "Your old insulation stays." stays on My job once the Ready Check recorded it was kept. */}
    {v.keptInsulation && <section data-testid="kept-insulation" className="rounded-[22px] bg-card p-5 shadow-sm"><p className="text-sm leading-relaxed">{v.keptInsulation.line}</p></section>}
    {v.veecAssignment && <VeecAssignmentCard v={v} token={token} />}
    <OwnerPaperwork token={token} />
    <Numbers v={v} />
    {v.canCancel && <CancelMyJob token={token} />}
  </>;
}

function StatusSnapshot({ v }: { v: View }) {
  const action = v.action;
  const current = v.progress.find((p: any) => p.state === "now") ?? v.progress[Math.min(v.hero.step ?? 0, v.progress.length - 1)];
  const completed = v.progress.filter((p: any) => p.state === "done").map((p: any) => p.label);
  const nextForYou = action.button ? action.title : "Nothing right now";
  const waitingOn = action.button ? "Waiting for your next step" : action.title;
  const summary = [
    { label: "Current status", value: current?.label ?? "In progress" },
    { label: "Completed", value: completed.length ? completed.join(", ") : "We'll show completed steps here" },
    { label: "Next for you", value: nextForYou },
    { label: "Waiting on", value: waitingOn },
  ];
  return (
    <section aria-label="Job status summary" className="rounded-[22px] bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-estimate-mint text-estimate-green"><Check className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-estimate-navy/60">At a glance</p>
          <h2 className="mt-1 font-display text-lg font-extrabold leading-tight">{action.kicker === "You need to do this" ? "Your next step is ready" : "You're up to date"}</h2>
        </div>
      </div>
      <dl className="mt-4 grid gap-2">
        {summary.map((item) => (
          <div key={item.label} className="grid gap-1 rounded-2xl bg-estimate-mist px-4 py-3 sm:grid-cols-[8rem_1fr] sm:items-center">
            <dt className="text-xs font-bold uppercase tracking-wide text-estimate-navy/60">{item.label}</dt>
            <dd className="text-sm font-semibold leading-relaxed">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function useSession(): [string | null, (value: string | null) => void] {
  const { token } = Route.useParams();
  const [value,setValue] = useState<string | null>(null);
  const key = `owner-verified-visit:${token}`;
  useEffect(() => { try { const saved=JSON.parse(sessionStorage.getItem(key) ?? 'null'); if (saved?.expires > Date.now() && typeof saved.value === 'string') setValue(saved.value); } catch { /* verification remains required */ } }, [key]);
  return [value,(next) => {setValue(next); try {if(next) sessionStorage.setItem(key,JSON.stringify({value:next,expires:Date.now()+30*60*1000}));else sessionStorage.removeItem(key);}catch{/* memory-only session */}}];
}

/** Decision 389: "It's your turn". Two buttons, the link token only (it signs nothing). Confirm offers the Ready Check to the
 *  installer Jo chose; "I'm no longer interested" closes the spot and nothing else is sent. */
function TurnScreen({ token }: { token: string }) {
  const load = useServerFn(ownerTurnStateFn);
  const confirm = useServerFn(ownerConfirmTurnFn);
  const decline = useServerFn(ownerDeclineTurnFn);
  const qc = useQueryClient();
  const { data: st, isLoading } = useQuery({ queryKey: ["owner-turn", token], queryFn: () => load({ data: { token } }), retry: false, refetchOnWindowFocus: false });
  const [view, setView] = useState<OwnerTurnView | null>(null);
  const [busy, setBusy] = useState<"confirm" | "decline" | null>(null);
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState("");
  const v = view ?? st ?? null;
  const act = async (which: "confirm" | "decline") => {
    setErr(""); setBusy(which);
    try { setView(await (which === "confirm" ? confirm : decline)({ data: { token } })); void qc.invalidateQueries({ queryKey: ["my-job", token] }); }
    catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };
  if (isLoading && !v) return <p role="status" className="py-10 text-center text-sm">Opening…</p>;
  const card = "space-y-4 rounded-[22px] bg-card p-6 shadow-sm";
  if (!v || v.kind === "closed") return <section data-testid="owner-turn" data-turn="closed" className={card}><p className="text-sm">{SPOT_RELEASE_PAGE.closed}</p><Link to="/my-job/$token" params={{ token }} className="block text-center text-sm font-semibold underline">Back to my job</Link></section>;
  if (v.kind === "confirmed") return <section data-testid="owner-turn" data-turn="confirmed" className={card}><p className="flex items-start gap-2 font-display text-xl font-extrabold"><Check className="mt-1 h-5 w-5 shrink-0 text-estimate-green" aria-hidden />{SPOT_RELEASE_PAGE.thanks(v.installer)}</p><Link to="/my-job/$token" params={{ token }} className="block text-center text-sm font-semibold underline">Back to my job</Link></section>;
  if (v.kind === "declined") return <section data-testid="owner-turn" data-turn="declined" className={card}><p className="text-sm">{SPOT_RELEASE_PAGE.declined}</p></section>;
  return (
    <section data-testid="owner-turn" data-turn="ask" className={card}>
      <h1 className="font-display text-2xl font-extrabold">{SPOT_RELEASE_PAGE.title}</h1>
      <p className="text-sm">{SPOT_RELEASE_PAGE.lead}</p>
      <InfoBox>
        <p className="font-bold">{LEGACY_WHAT_HAPPENS_NEXT.title}</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">{LEGACY_WHAT_HAPPENS_NEXT.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      </InfoBox>
      <button type="button" className={signBtn} disabled={!!busy} onClick={() => void act("confirm")}>{busy === "confirm" ? SPOT_RELEASE_PAGE.confirming : SPOT_RELEASE_PAGE.confirm}</button>
      {!sure
        ? <button type="button" className="block w-full text-center text-sm font-semibold underline" disabled={!!busy} onClick={() => setSure(true)}>{SPOT_RELEASE_PAGE.decline}</button>
        : <div className="rounded-[14px] border border-estimate-line p-4 text-sm"><p>We'll close your spot and won't contact you about it again.</p><button type="button" className="mt-3 flex h-11 w-full items-center justify-center rounded-full border border-estimate-navy font-bold" disabled={!!busy} onClick={() => void act("decline")}>{busy === "decline" ? "Closing…" : SPOT_RELEASE_PAGE.decline}</button></div>}
      {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
    </section>
  );
}

const tapBtn = "flex min-h-14 w-full items-center justify-center rounded-full border border-estimate-navy bg-card px-5 py-3 text-center text-base font-bold disabled:opacity-50";
const tapPrimary = "flex min-h-14 w-full items-center justify-center rounded-full bg-estimate-green px-5 py-3 text-center text-base font-bold text-estimate-canvas disabled:opacity-50";

/** A48 batch 2: the quick taps. One question per screen, in order: full name, address, hatch, any website
 *  answer left blank, who lets the installer in (Me / My tenant + their name and mobile), then "Yes, let's go" / "No thanks". A decline tap ends it. Name/address changes are saved as they
 *  are given (a typed name waits for the address when there is no full address on file yet); the answers are saved once.
 *  Not in a batch asking for taps → the normal My job page. The link token is the only credential. */
function TapsScreen({ v, token, only }: { v: View; token: string; only?: "rental" | undefined }) {
  const load = useServerFn(ownerQuickTapsStateFn);
  const save = useServerFn(ownerQuickTapsSaveFn);
  const saveDetails = useServerFn(ownerQuickTapsDetailsFn);
  const qc = useQueryClient();
  const { data: st, isLoading } = useQuery({ queryKey: ["owner-taps", token, only ?? null], queryFn: () => load({ data: { token, ...(only ? { only } : {}) } }) as Promise<QuickTapsView>, retry: false, refetchOnWindowFocus: false });
  const [done, setDone] = useState<Extract<QuickTapsView, { kind: "done" | "rental_done" }> | null>(null);
  const [a, setA] = useState<QuickTapAnswers>({});
  const [onFile, setOnFile] = useState<{ name: string | null; address: string | null } | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (isLoading && !st) return <p role="status" className="py-10 text-center text-sm">Opening…</p>;
  const view: QuickTapsView | null = done ?? st ?? null;
  if (!view || view.kind === "none") return v.spotSaved ? <SpotSavedHome v={v} token={token} /> : <Home v={v} token={token} />;
  const card = "space-y-4 rounded-[22px] bg-card p-6 shadow-sm";
  if (view.kind === "rental_done") return <section data-testid="owner-taps" data-outcome="rental_done" className={card}><p className="flex items-start gap-2 font-display text-xl font-extrabold"><Check className="mt-1 h-5 w-5 shrink-0 text-estimate-green" aria-hidden />{RENTAL_DONE_LINE}</p></section>;
  if (view.kind === "rental_ask") return <RentalOnlyTaps token={token} only={only} onDone={(r) => { setDone(r); }} card={card} />;
  if (view.kind === "done") return <section data-testid="owner-taps" data-outcome={view.outcome} className={card}><p className="flex items-start gap-2 font-display text-xl font-extrabold">{view.outcome === "pass" && <Check className="mt-1 h-5 w-5 shrink-0 text-estimate-green" aria-hidden />}{view.outcome === "pass" ? quickTapsPassLine(view.installer) : QUICK_TAPS_COPY.outcome[view.outcome]}</p></section>;
  if (view.kind === "retry") return <section data-testid="owner-taps" className={card}><button type="button" className={tapPrimary} disabled={busy} onClick={async () => {
    setErr(""); setBusy(true);
    try { const r = await save({ data: { token, answers: {} } }); if (r.kind === "done") { setDone(r); void qc.invalidateQueries({ queryKey: ["my-job", token] }); } }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }}>Try again</button>{err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}</section>;

  const name = onFile?.name ?? view.name;
  const address = onFile?.address ?? view.address;
  const blanksFor = (x: QuickTapAnswers) => websiteQuestions(view.website, x.website ?? {});
  const ask = { rental: view.rental };
  const step = nextTapStep(a, blanksFor(a), ask);
  const submit = async (x: QuickTapAnswers) => {
    setErr(""); setBusy(true);
    try {
      const r = (await save({ data: { token, answers: x } })) as QuickTapsView;
      if (r.kind === "done") { setDone(r); void qc.invalidateQueries({ queryKey: ["my-job", token] }); }
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const answer = (x: QuickTapAnswers) => {
    setA(x); setEditing(false); setTyped(""); setErr("");
    if (tapOutcome(x, blanksFor(x), ask) !== "incomplete") void submit(x);
  };
  const details = async (input: { fullName?: string | null; placeId?: string | null }, then: (r: { name: string; address: string }) => void): Promise<PickResult> => {
    const r = await saveDetails({ data: { token, fullName: input.fullName ?? null, placeId: input.placeId ?? null } });
    if (r.ok) { setOnFile({ name: r.name, address: r.address }); then(r); }
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  };
  const options = <T extends string>(list: readonly { value: T; label: string }[], pick: (value: T) => void) =>
    <div className="space-y-3">{list.map((o) => <button key={o.value} type="button" className={tapBtn} disabled={busy} onClick={() => pick(o.value)}>{o.label}</button>)}</div>;
  const confirm = (question: string, value: string, yes: () => void) => <>
    <h1 className="font-display text-2xl font-extrabold">{question}</h1>
    <p className="rounded-[14px] bg-estimate-panel px-4 py-3.5 text-lg font-bold">{value}</p>
    <div className="space-y-3">
      <button type="button" className={tapPrimary} disabled={busy} onClick={yes}>{QUICK_TAPS_COPY.yes}</button>
      <button type="button" className={tapBtn} disabled={busy} onClick={() => { setEditing(true); setTyped(""); setErr(""); }}>{QUICK_TAPS_COPY.change}</button>
    </div>
  </>;
  const saveName = async () => {
    const n = typed.trim().replace(/\s+/g, " ");
    if (n.length < 2) { setErr("Please type your full name."); return; }
    if (!address) { setPendingName(n); answer({ ...a, name: n }); return; } // saved with the address on the next tap
    setBusy(true); setErr("");
    try { const r = await details({ fullName: n }, (d) => answer({ ...a, name: d.name })); if (!r.ok) setErr(r.error); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  let body: ReactNode = null;
  if (busy && !step) body = <p role="status" className="py-6 text-center text-sm">Saving…</p>;
  else if (step === "name") body = name && !editing ? confirm(QUICK_TAPS_COPY.nameConfirm, name, () => answer({ ...a, name })) : <>
    <h1 className="font-display text-2xl font-extrabold">{QUICK_TAPS_COPY.nameAsk}</h1>
    <input aria-label={QUICK_TAPS_COPY.nameAsk} autoComplete="name" className="h-14 w-full rounded-2xl border border-estimate-line bg-card px-4 text-lg" value={typed} disabled={busy} onChange={(e) => setTyped(e.target.value)} />
    <button type="button" className={tapPrimary} disabled={busy} onClick={() => void saveName()}>{busy ? "Saving…" : "Save"}</button>
  </>;
  else if (step === "address") body = address && !editing ? confirm(QUICK_TAPS_COPY.addressConfirm, address, () => answer({ ...a, address })) : <>
    <h1 className="font-display text-2xl font-extrabold">{QUICK_TAPS_COPY.addressAsk}</h1>
    <QuickTapsAddressSearch token={token} save={(placeId) => details({ fullName: pendingName, placeId }, (d) => { setPendingName(null); answer({ ...a, name: d.name, address: d.address }); })} />
  </>;
  else if (step === "hatch") body = <><h1 className="font-display text-2xl font-extrabold">{QUICK_TAPS_COPY.hatch.question}</h1>{options(QUICK_TAPS_COPY.hatch.options, (hatch) => answer({ ...a, hatch }))}</>;
  // The old "Who will be at the home to let the installer in?" tap (Me / My tenant) was retired 4 Nov 2026 (Jo, pack 2 batch 7):
  // the rental screens ask "Who should we arrange access with?". The step is only reachable with the rental screens off.
  else if (step === "access") body = <><h1 className="font-display text-2xl font-extrabold">Who should we arrange access with?</h1>{options([{ value: "owner" as const, label: "Me" }], () => answer({ ...a, access: { who: "owner" } }))}</>;
  // Task 5 (Jo 2 Nov 2026): phone consent over 3 months old → "Yes, {installer} can call me".
  else if (step === "go") { const yes = quickTapsGoLabel(view); body = options(QUICK_TAPS_COPY.go.options.map((o) => (o.value === "yes" ? { ...o, label: yes } : o)), (go) => answer({ ...a, go })); }
  // Task 19 / Jo 4 Nov 2026 21:40: "Who should we arrange access with?" and their details (only while the server says to ask).
  else if (step === "who" || step === "details")
    body = <RentalStepBody key={step} step={step} answers={a.rental ?? {}} busy={busy} set={(patch) => answer({ ...a, rental: { ...a.rental, ...patch } })} />;
  else if (step) { const w = QUICK_TAPS_COPY.website[step]; body = <><h1 className="font-display text-2xl font-extrabold">{w.label}</h1>{options(w.options, (value) => answer({ ...a, website: { ...a.website, [step]: value } }))}</>; }
  else body = <button type="button" className={tapPrimary} disabled={busy} onClick={() => void submit(a)}>Try again</button>;
  return <section data-testid="owner-taps" data-step={step ?? "saving"} className={card}>{body}{err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}</section>;
}

/** The two rental screens (Jo 4 Nov 2026 21:40, approved): who we arrange access with (Me / My tenant / My property
 *  manager) → their details (name, mobile, email optional) when it isn't the owner. */
function RentalStepBody({ step, busy, set }: { step: RentalStep; answers: RentalAnswersInput; busy: boolean; set: (patch: Partial<RentalAnswersInput>) => void }) {
  const [draft, setDraft] = useState<RentalAnswersInput>({});
  const [problems, setProblems] = useState<string[]>([]);
  const field = "h-14 w-full rounded-2xl border border-estimate-line bg-card px-4 text-lg";
  const choices = <T extends string>(list: readonly { value: T; label: string }[], pick: (v: T) => void) =>
    <div className="space-y-3">{list.map((o) => <button key={o.value} type="button" className={tapBtn} disabled={busy} onClick={() => pick(o.value)}>{o.label}</button>)}</div>;
  const box = (label: string, key: keyof RentalAnswersInput, type: string, mode: "text" | "tel" | "email") =>
    <label className="block space-y-1.5"><span className="text-sm font-bold">{label}</span>
      <input className={field} type={type} inputMode={mode} autoComplete="off" maxLength={120} value={(draft[key] as string | undefined) ?? ""} disabled={busy} onChange={(e) => { setDraft({ ...draft, [key]: e.target.value }); setProblems([]); }} /></label>;
  const problemList = problems.length > 0 && <ul role="alert" className="space-y-1 text-sm font-semibold text-destructive">{problems.map((p) => <li key={p}>{p}</li>)}</ul>;
  if (step === "who") return <><h1 className="font-display text-2xl font-extrabold">{RENTAL_TAPS.whoTitle}</h1>{choices(rentalWhoChoices(), (who) => set({ who }))}</>;
  const next = () => { const p = rentalDetailsProblems(draft); if (p.length) { setProblems(p); return; } set({ name: draft.name?.trim(), mobile: draft.mobile?.trim(), email: draft.email?.trim() ?? "" }); };
  return <>
    <h1 className="font-display text-2xl font-extrabold">{RENTAL_TAPS.detailsTitle}</h1>
    {box(RENTAL_TAPS.name, "name", "text", "text")}
    {box(RENTAL_TAPS.mobile, "mobile", "tel", "tel")}
    {box(RENTAL_TAPS.email, "email", "email", "email")}
    {problemList}
    <button type="button" className={tapPrimary} disabled={busy} onClick={next}>{RENTAL_TAPS.next}</button>
  </>;
}

/** Task 19 (answer 24): an installer's own customer answers ONLY the rental questions (`?screen=taps&only=rental`). */
function RentalOnlyTaps({ token, only, onDone, card }: { token: string; only: "rental" | undefined; onDone: (r: { kind: "rental_done" }) => void; card: string }) {
  const save = useServerFn(ownerQuickTapsSaveFn);
  const [r, setR] = useState<RentalAnswersInput>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const step = nextRentalStep(r);
  const submit = async (x: RentalAnswersInput) => {
    setErr(""); setBusy(true);
    try { const res = (await save({ data: { token, answers: { rental: x }, ...(only ? { only } : {}) } })) as QuickTapsView; if (res.kind === "rental_done") onDone(res); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const set = (patch: Partial<RentalAnswersInput>) => { const next = { ...r, ...patch }; setR(next); if (nextRentalStep(next) === null) void submit(next); };
  return <section data-testid="owner-taps" data-step={step ?? "saving"} className={card}>
    {step ? <RentalStepBody key={step} step={step} answers={r} busy={busy} set={set} /> : busy ? <p role="status" className="py-6 text-center text-sm">Saving…</p> : <button type="button" className={tapPrimary} onClick={() => void submit(r)}>Try again</button>}
    {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
  </section>;
}

/** The address tap's search (the same search-and-pick as the owner's address page, my-address.$token): the address can
 *  only be picked from the list, never typed in free. */
function QuickTapsAddressSearch({ token, save }: { token: string; save: (placeId: string) => Promise<PickResult> }) {
  const searchFn = useServerFn(ownerQuickTapsAddressSearchFn);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; label: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 4) { setResults([]); setSearching(false); return; }
    let live = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try { const r = (await searchFn({ data: { token, query: q } })) as { id: string; label: string }[]; if (live) { setResults(r); setError(null); } }
      catch { if (live) setError("We couldn't search right now. Please try again."); }
      finally { if (live) setSearching(false); }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [query, token, searchFn]);
  const saveRef = useRef(save);
  saveRef.current = save;
  const pickerRef = useRef<ReturnType<typeof createAddressPicker> | null>(null);
  pickerRef.current ??= createAddressPicker((placeId) => saveRef.current(placeId), { setBusy, onDone: (r) => { if (!r.ok) setError(r.error); } });
  return <div>
    <label htmlFor="taps-address" className="block text-sm font-semibold">Start typing your address</label>
    <input id="taps-address" type="search" inputMode="search" autoComplete="off" enterKeyHint="search" value={query} disabled={busy}
      onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
      className="mt-2 block h-14 w-full rounded-2xl border border-estimate-line bg-card px-4 text-lg" />
    {searching && <p className="mt-3 text-sm">Searching…</p>}
    {results.length > 0 && <ul className="mt-3 divide-y divide-estimate-line overflow-hidden rounded-2xl border border-estimate-line">
      {results.map((r) => <li key={r.id}><button type="button" disabled={busy} onClick={() => { setError(null); void pickerRef.current!(r.id); }} className="block min-h-14 w-full px-4 py-3 text-left text-base disabled:opacity-60">{r.label}</button></li>)}
    </ul>}
    {!searching && query.trim().length >= 4 && results.length === 0 && !error && <p className="mt-3 text-sm">No matches yet. Keep typing.</p>}
    {busy && <p className="mt-3 text-sm">Saving…</p>}
    {error && <p role="alert" className="mt-3 text-sm font-semibold text-destructive">{error}</p>}
  </div>;
}

/** Batch 3a: O78's "Send me a new quote". The tap is the request (sent once on arrival; a second tap gets the same
 *  answer and changes nothing). Refused (not a job closed by an expired quote) → the normal My job page. */
function NewQuoteScreen({ v, token }: { v: View; token: string }) {
  const ask = useServerFn(ownerRequestNewQuoteFn);
  const qc = useQueryClient();
  const { data: r, isLoading, isError } = useQuery({ queryKey: ["owner-newquote", token], queryFn: () => ask({ data: { token } }), retry: false, staleTime: Infinity, refetchOnWindowFocus: false });
  useEffect(() => { if (r?.kind === "thanks") void qc.invalidateQueries({ queryKey: ["my-job", token] }); }, [r?.kind, qc, token]);
  if (isLoading) return <p role="status" className="py-10 text-center text-sm">Opening…</p>;
  if (isError || r?.kind !== "thanks") return v.spotSaved ? <SpotSavedHome v={v} token={token} /> : <Home v={v} token={token} />;
  return <section data-testid="owner-newquote" className="space-y-4 rounded-[22px] bg-card p-6 shadow-sm"><p className="flex items-start gap-2 font-display text-xl font-extrabold"><Check className="mt-1 h-5 w-5 shrink-0 text-estimate-green" aria-hidden />{NEW_QUOTE_THANKS}</p><Link to="/my-job/$token" params={{ token }} className="block text-center text-sm font-semibold underline">Back to my job</Link></section>;
}

/** Decision 335: the review screen. The email's star tap is recorded on arrival; 4–5 → thanks + Google (when the link is
 *  set), 1–3 → a private "What could we have done better?" box (never Google). Link token only — it signs nothing. */
function ReviewScreen({ token, initialStars }: { token: string; initialStars: number | null }) {
  const load = useServerFn(ownerReviewStateFn);
  const rate = useServerFn(ownerReviewStarsFn);
  const sendFeedback = useServerFn(ownerReviewFeedbackFn);
  const { data: st } = useQuery({ queryKey: ["owner-review", token], queryFn: () => load({ data: { token } }), retry: false });
  const [stars, setStars] = useState<number | null>(initialStars);
  const [google, setGoogle] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const recorded = useRef(false);
  const tap = async (n: number) => {
    setStars(n); setErr("");
    try { const r = await rate({ data: { token, stars: n } }); setGoogle(r.googleUrl); } catch (e) { setErr(errText(e)); }
  };
  useEffect(() => { if (initialStars && !recorded.current) { recorded.current = true; void tap(initialStars); } }, [initialStars]); // eslint-disable-line react-hooks/exhaustive-deps
  if (st && !st.open) return <section className="rounded-[22px] bg-card p-6 text-center shadow-sm"><p className="font-display text-xl font-extrabold">{REVIEW_COPY.title}</p><p className="mt-2 text-sm">You can rate us once your install is done.</p></section>;
  const view = reviewScreen(stars, google ?? st?.googleUrl ?? null);
  return (
    <section data-testid="owner-review" className="space-y-4 rounded-[22px] bg-card p-6 shadow-sm">
      <h1 className="font-display text-2xl font-extrabold">{REVIEW_COPY.title}</h1>
      <p className="text-sm">{REVIEW_COPY.sub}</p>
      <div className="flex justify-between gap-1" role="group" aria-label="Star rating">
        {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-label={`${n} star${n > 1 ? "s" : ""}`} aria-pressed={stars === n} disabled={busy} onClick={() => void tap(n)} className={`h-14 w-14 rounded-2xl border text-3xl ${stars != null && n <= stars ? "border-estimate-green bg-estimate-mint text-estimate-green" : "border-estimate-line text-estimate-navy/40"}`}>★</button>)}
      </div>
      {view.kind === "thanks" && <div data-review-thanks>
        <p className="font-bold">{REVIEW_COPY.thanksHappy}</p>
        {view.googleUrl && <><p className="mt-2 text-sm">{REVIEW_COPY.googleAsk}</p><a href={view.googleUrl} target="_blank" rel="noopener noreferrer" className="mt-3 flex h-12 w-full items-center justify-center rounded-full bg-estimate-green font-bold text-estimate-canvas">{REVIEW_COPY.googleButton}</a></>}
      </div>}
      {view.kind === "feedback" && (sent || st?.feedbackSent ? <p className="font-bold" data-review-feedback-sent>{REVIEW_COPY.feedbackSent}</p> : <div data-review-feedback>
        <p className="font-bold">{REVIEW_COPY.feedbackTitle}</p>
        <p className="mt-1 text-sm">{REVIEW_COPY.feedbackSub}</p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={REVIEW_FEEDBACK_MAX} aria-label={REVIEW_COPY.feedbackTitle} className="mt-3 w-full rounded-2xl border border-estimate-line p-3 text-base" />
        <button type="button" className={`${signBtn} mt-3`} disabled={busy || !text.trim()} onClick={async () => { setErr(""); setBusy(true); try { await sendFeedback({ data: { token, stars: stars!, feedback: text } }); setSent(true); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } }}>{busy ? "Sending…" : REVIEW_COPY.feedbackButton}</button>
      </div>)}
      {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
      <Link to="/my-job/$token" params={{ token }} className="block text-center text-sm font-semibold underline">Back to my job</Link>
    </section>
  );
}
const errText = (e: unknown) => (e instanceof Error ? e.message : "Please try again.");

/** Quote page "Say yes" (touchpoints #33, Fix 3, lawyer Q8; Jo 2 Nov 2026): two ticks, a typed name, one locked button.
 *  The ESC declarations are not asked here (they move to the confirm-and-pay page). The 6-digit code is still asked for
 *  when the owner presses the button. */
function AcceptQuote({ token, quote, safetyCheck, showDocs, onAccepted }: { token: string; quote: { id: string; version: number }; safetyCheck: number | null; showDocs: boolean; onAccepted: () => void }) {
  const [session, setSession] = useSession();
  const [needCode, setNeedCode] = useState(false);
  const load = useServerFn(ownerAgreementFn);
  const accept = useServerFn(ownerAcceptQuoteFn);
  const getDoc = useServerFn(ownerQuoteDocumentFn);
  const qc = useQueryClient();
  const { data: ag } = useQuery({ queryKey: ["owner-agreement", quote.id], queryFn: () => load({ data: { token, quoteId: quote.id } }) });
  const [f, setF] = useState({ authority: "owner" as "owner" | "authorised_representative" });
  const [tick1, setTick1] = useState(false); const [tick2, setTick2] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const blocked = (ag?.blockers ?? []) as string[];
  const fee = safetyCheck != null ? shortAud(safetyCheck) : "$349";
  const ready = !!ag && blocked.length === 0 && quoteSittingBlockers({ tick1, tick2, typedName }).length === 0;
  const openDoc = async (doc: "agreement" | "rights") => {
    setErr("");
    try {
      const d = await getDoc({ data: { token, quoteId: quote.id, doc } });
      if (!d) { setErr("That document isn't ready yet. Please try again soon."); return; }
      const bytes = Uint8Array.from(atob(d.base64), (c) => c.charCodeAt(0));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      a.target = "_blank"; a.download = d.filename; a.rel = "noopener"; a.click();
    } catch (e) { setErr(errText(e)); }
  };
  const sign = async () => {
    if (!session) { setNeedCode(true); return; }
    setErr(""); setBusy(true);
    try { await completeOwnerQuoteAcceptance(
      () => accept({ data: { token, session, quoteId: quote.id, expectedVersion: quote.version, signing: { authorityType: f.authority, tick1, tick2, typedName: typedName.trim(), assistance: "none" } } }),
      onAccepted,
      () => qc.invalidateQueries({ queryKey: ["my-job", token] }),
    ); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const link = "font-bold text-estimate-blue underline-offset-2";
  return (
    <div data-testid="say-yes" className="mt-7 border-t-2 border-estimate-navy pt-5">
      <p className="text-xs font-bold tracking-[0.1em] text-estimate-logo-green">{P2.sayYes}</p>
      <h2 className="mt-1 font-display text-[21px] font-extrabold">{P2.twoTicks}</h2>
      {/* Jo 4 Nov 2026 20:05 (pack 2 batch 5): "How you pay" and the 30-day line sit above the two ticks, not under the signature. */}
      <p className="mt-3 text-[13px] leading-relaxed text-estimate-sub">{P2.howYouPayFor(fee)}</p>
      <p className="mt-2 text-[13px] leading-relaxed text-estimate-sub">{P2.timing}</p>
      <TickCard on={tick1} set={setTick1} title={<>{P2.tick1}{showDocs && <> <span className="font-normal text-estimate-sub">{P2.attachedNote}</span></>}</>}
        sub={showDocs && <><button type="button" className={link} onClick={(e) => { e.preventDefault(); void openDoc("agreement"); }}>{P2.agreementLink}</button> · <button type="button" className={link} onClick={(e) => { e.preventDefault(); void openDoc("agreement"); }}>{P2.paymentTermsLink}</button> · <button type="button" className={link} onClick={(e) => { e.preventDefault(); void openDoc("rights"); }}>{P2.rightsLink}</button></>}
        {...(!showDocs ? { read: "Quote, terms and consumer information", readBody: ag ? <>{ag.agreementWording?.body ?? ''}{'\n\n'}{ag.consumerRights?.body ?? ''}{'\n\n'}{ag.paymentTerms ?? ''}</> : 'Loading…' } : {})} />
      <TickCard on={tick2} set={setTick2} title={P2.tick2For(fee)} bold={false} />
      <section className="mt-[18px] rounded-[14px] border border-estimate-line bg-card px-4 py-3.5">
        <AuthorityChoice value={f.authority} onChange={(authority) => setF({ ...f, authority })} />
      </section>
      <TypedField label={P2.signLabel} value={typedName} onChange={setTypedName} placeholder={P2.typeHere} italic autoComplete="name" />
      <SmallNote>{P2.signSub}</SmallNote>
      {/* G8 (6), 4 Nov 2026 (LOOKS WRONG 12): the office-internal template lines never reach the owner — one owner-safe line; the office gets a Needs me row. */}
      {blocked.length > 0 && <p role="alert" className="mt-3 rounded-[12px] bg-estimate-blush p-3 text-sm font-semibold">{QUOTE_NOT_READY_OWNER_LINE}</p>}
      {needCode && !session && <div className="mt-4"><OwnerCodeGate token={token} onVerified={(s) => { setSession(s); setNeedCode(false); }} /></div>}
      {err && <p role="alert" className="mt-3 text-sm font-semibold text-destructive">{err}</p>}
      <LockedButton ready={ready} busy={busy} busyLabel={P2.signing} onClick={() => void sign()}>{P2.button(fee)}</LockedButton>
      {!ready && <LockHint>{P2.lockHint}</LockHint>}
    </div>
  );
}

/** Jo 24 Oct: "Not for me" — no code needed (it signs nothing); an optional reason helps the office. */
function DeclineQuote({ token, quoteId }: { token: string; quoteId: string }) {
  const decline = useServerFn(ownerDeclineQuoteFn);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DeclineReason | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  if (!open) return <p className="mt-[22px] text-center"><button type="button" data-decline-open className="min-h-11 text-sm text-estimate-sub underline" onClick={() => setOpen(true)}>{P2.notForMe}</button></p>;
  return (
    <div data-decline className="mt-4 space-y-3 rounded-2xl border border-estimate-line p-4">
      <p className="font-bold">No problem. Can you tell us why? (optional)</p>
      <div className="space-y-2">{DECLINE_REASONS.map((r) => (
        <label key={r.key} className="flex min-h-11 items-center gap-3 text-sm"><input type="radio" name="decline-reason" checked={reason === r.key} onChange={() => setReason(r.key)} />{r.label}</label>
      ))}</div>
      <textarea aria-label="Anything else you'd like to tell us" maxLength={800} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything else you'd like to tell us" className="min-h-20 w-full rounded-xl border border-estimate-line bg-card p-2 text-sm" />
      {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
      <div className="flex gap-2">
        <button type="button" className={`${signBtn} flex-1`} disabled={busy} onClick={async () => { setErr(""); setBusy(true); try { await decline({ data: { token, quoteId, reason, note: note.trim() || null } }); await qc.invalidateQueries({ queryKey: ["my-job", token] }); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } }}>{busy ? "Sending…" : "Decline this quote"}</button>
        <button type="button" className="px-3 text-sm font-semibold underline" disabled={busy} onClick={() => setOpen(false)}>Go back</button>
      </div>
    </div>
  );
}

const SLOTS = [["8-10", "8–10am"], ["10-12", "10am–12"], ["12-14", "12–2pm"], ["14-16", "2–4pm"]] as const;
function nextDays(n: number, from = 1) { const out: string[] = []; let ymd = addYmd(melbourneToday(), from); while (out.length < n) { if (new Date(`${ymd}T12:00:00Z`).getUTCDay() !== 0) out.push(ymd); ymd = addYmd(ymd, 1); } return out; }

function BookPickers({ token }: { token: string }) {
  const load = useServerFn(ownerBookingStateFn);
  const choosePiesa = useServerFn(ownerChoosePiesaFn);
  const takeDay = useServerFn(ownerTakeInstallDayFn);
  const suggestDays = useServerFn(ownerSuggestInstallDaysFn);
  const takePiesa = useServerFn(ownerTakePiesaTimeLinkFn);
  const suggestPiesa = useServerFn(ownerSuggestPiesaDaysLinkFn);
  const [piesaSuggesting, setPiesaSuggesting] = useState(false);
  const [piesaDays, setPiesaDays] = useState<string[]>([]);
  const { data, refetch } = useQuery({ queryKey: ["owner-booking", token], queryFn: () => load({ data: { token } }) });
  // Jo 28 Oct (decision 158): a lapsed 30-day window replaces the booking pickers with the repeat safety check card.
  const loadRepeat = useServerFn(ownerRepeatPiesaFn);
  const { data: repeat } = useQuery({ queryKey: ["owner-repeat-piesa", token], queryFn: () => loadRepeat({ data: { token } }) });
  const [session, setSession] = useSession();
  const [picks, setPicks] = useState<{ date: string; slot: (typeof SLOTS)[number][0] }[]>([]);
  const [understands, setUnderstands] = useState(false);
  const [days, setDays] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  if (repeat) return <RepeatPiesaCard token={token} />;
  if (!data) return null;
  if (data.inHouseDispatch) return <>{data.piesa.booked && <p className="text-sm font-semibold">Pre Insulation Electrical Safety Assessment (PIESA) · {visitPill(data.piesa.booked.startsAt)}</p>}{data.install.bookedAt && <p className="text-sm font-semibold">Install · {visitPill(data.install.bookedAt)}</p>}</>;
  const installMove = data.install.turn === "owner_to_answer";
  // Decision 333: the electrician offers the safety check times; the owner taps one or suggests days (old jobs keep the old picker).
  const pt = data.piesaTimes as { applies: boolean; turn: string; open: { id: string; starts_at: string }[]; days: string[]; thirtyDayAck: { needed: boolean; wording: string } } | undefined;
  const piesaMove = !!pt?.applies && pt.turn === "owner_to_answer";
  const ackBlock = !!pt?.thirtyDayAck?.needed && !understands;
  const piesaBooked = data.piesa.booked as { startsAt: string; canChange: boolean; late: boolean } | null;
  const any = data.piesa.canPick || piesaMove || installMove;
  const tile = (on: boolean) => `min-h-12 rounded-2xl border px-2 text-sm font-bold ${on ? "border-estimate-green bg-estimate-mint" : "border-estimate-line bg-card"}`;
  const go = async (f: () => Promise<unknown>) => { setErr(""); setBusy(true); try { await f(); setPicks([]); setDays([]); setSuggesting(false); setPiesaDays([]); setPiesaSuggesting(false); await refetch(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  return <>
    {/* Decision #24 (Jo 2 Nov 2026): no change buttons — the owner calls the business to change a booked time. */}
    {piesaBooked && <section data-testid="piesa-booked" className="rounded-[22px] bg-card p-5 text-sm shadow-sm">
      <p className="font-bold">Your Pre Insulation Electrical Safety Assessment (PIESA) is booked for {visitPill(piesaBooked.startsAt)}.</p>
    </section>}
    {!any && !piesaBooked && data.install.turn !== "booked" && data.piesa.windows.length > 0 && <section className="rounded-[22px] bg-card p-5 text-sm shadow-sm"><p className="font-bold">Your Pre Insulation Electrical Safety Assessment (PIESA) times are with our electricians.</p><ul className="mt-2 space-y-1">{data.piesa.windows.map((w: any) => <li key={w.starts_at}>{visitPill(w.starts_at)}</li>)}</ul></section>}
    {any && !session && <OwnerCodeGate token={token} onVerified={setSession} />}
    {any && session && data.piesa.canPick && <section className="rounded-[22px] bg-card p-5 shadow-sm">
      <h3 className="font-display text-lg font-extrabold">Pre Insulation Electrical Safety Assessment (PIESA) times</h3>
      <p className="mt-1 text-sm">Pick 3 to 5 times across at least 3 days.</p>
      {data.piesa.thirtyDayAck?.needed && <label className="mt-3 flex items-start gap-3 rounded-2xl border border-estimate-line p-3 text-sm">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={understands} onChange={(e) => setUnderstands(e.target.checked)} />
        <span>{data.piesa.thirtyDayAck.wording}</span>
      </label>}
      <div className="mt-3 space-y-3">{nextDays(8).map((d) => <div key={d}><p className="text-xs font-bold">{day(d + "T02:00:00Z")}</p><div className="mt-1 grid grid-cols-2 gap-2">{SLOTS.map(([k, l]) => { const on = picks.some((p) => p.date === d && p.slot === k); return <button key={k} className={tile(on)} onClick={() => setPicks(on ? picks.filter((p) => !(p.date === d && p.slot === k)) : picks.length < 5 ? [...picks, { date: d, slot: k }] : picks)}>{l}</button>; })}</div></div>)}</div>
      <button className={`${signBtn} mt-4`} disabled={busy || picks.length < 3 || (!!data.piesa.thirtyDayAck?.needed && !understands)} onClick={() => go(async () => { const result = await choosePiesa({ data: { token, session, picks, understandsThirtyDays: understands } }); assertInHouseActionSucceeded(result); })}>Send my {picks.length} times</button>
    </section>}
    {any && session && piesaMove && pt && <section className="rounded-[22px] bg-card p-5 shadow-sm" data-piesa-times-owner>
      <h3 className="font-display text-lg font-extrabold">Choose your Pre Insulation Electrical Safety Assessment (PIESA) time</h3>
      <p className="mt-1 text-sm">Your electrician can come at these times. Tap one to book it.</p>
      {/* Decision 307 kept by decision 333: the 30-day box is ticked before a time can be taken. */}
      {pt.thirtyDayAck?.needed && <label className="mt-3 flex items-start gap-3 rounded-2xl border border-estimate-line p-3 text-sm">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={understands} onChange={(e) => setUnderstands(e.target.checked)} />
        <span>{pt.thirtyDayAck.wording}</span>
      </label>}
      <div className="mt-3 grid gap-2">{pt.open.map((o) => <button key={o.id} className={tile(false)} disabled={busy || ackBlock} onClick={() => go(() => takePiesa({ data: { token, session, proposalId: o.id, understandsThirtyDays: understands } }))}>{formatPiesaTime(o.starts_at)}</button>)}</div>
      {ackBlock && <p className="mt-2 text-xs font-semibold">Please tick the box above first.</p>}
      {!piesaSuggesting ? <button className="mt-3 min-h-12 w-full rounded-2xl border border-estimate-line px-3 text-sm font-bold" disabled={busy} onClick={() => setPiesaSuggesting(true)}>None of these suit – suggest other days</button> : <>
        <p className="mt-4 text-sm font-semibold">Pick up to {PIESA_OWNER_SUGGEST_MAX} days that suit you. Your electrician will take one and choose the time, or offer new times.</p>
        <div className="mt-2 grid grid-cols-2 gap-2">{pt.days.map((d) => { const on = piesaDays.includes(d); return <button key={d} className={tile(on)} onClick={() => setPiesaDays(on ? piesaDays.filter((x) => x !== d) : piesaDays.length < PIESA_OWNER_SUGGEST_MAX ? [...piesaDays, d] : piesaDays)}>{day(d + "T02:00:00Z")}</button>; })}</div>
        <button className={`${signBtn} mt-4`} disabled={busy || !piesaDays.length || ackBlock} onClick={() => go(() => suggestPiesa({ data: { token, session, days: piesaDays, understandsThirtyDays: understands } }))}>Send my {piesaDays.length || ""} day{piesaDays.length === 1 ? "" : "s"}</button>
      </>}
    </section>}
    {any && session && installMove && <section className="rounded-[22px] bg-card p-5 shadow-sm">
      <h3 className="font-display text-lg font-extrabold">Choose your install day</h3>
      <p className="mt-1 text-sm">Your installer can come at these times. Tap one to book it.</p>
      {data.install.deadline && <p className="mt-1 text-sm font-semibold">Your install must be on or before {day(data.install.deadline + "T02:00:00Z")}{data.install.daysLeft != null ? ` (${data.install.daysLeft} day${data.install.daysLeft === 1 ? "" : "s"} left)` : ""}.</p>}
      <div className="mt-3 grid gap-2">{(data.install.open as { id: string; starts_at: string }[]).map((o) => <button key={o.id} className={tile(false)} disabled={busy} onClick={() => go(() => takeDay({ data: { token, session, proposalId: o.id } }))}>{formatInstallDay(o.starts_at)}</button>)}</div>
      {!suggesting ? <button className="mt-3 min-h-12 w-full rounded-2xl border border-estimate-line px-3 text-sm font-bold" disabled={busy} onClick={() => setSuggesting(true)}>None of these suit – suggest other days</button> : <>
        <p className="mt-4 text-sm font-semibold">Pick up to 5 days that suit you. Your installer will take one and choose the time, or offer new days.</p>
        <div className="mt-2 grid grid-cols-2 gap-2">{(data.install.days as string[]).map((d) => { const on = days.includes(d); return <button key={d} className={tile(on)} onClick={() => setDays(on ? days.filter((x) => x !== d) : days.length < 5 ? [...days, d] : days)}>{day(d + "T02:00:00Z")}</button>; })}</div>
        <button className={`${signBtn} mt-4`} disabled={busy || !days.length} onClick={() => go(() => suggestDays({ data: { token, session, days } }))}>Send my {days.length || ""} day{days.length === 1 ? "" : "s"}</button>
      </>}
    </section>}
    {data.install.turn === "booked" && <section className="rounded-[22px] bg-card p-5 text-sm shadow-sm">
      <p className="font-bold">Your install is booked{data.install.bookedAt ? ` for ${formatInstallDay(data.install.bookedAt)}` : ""}.</p>
    </section>}
    {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
  </>;
}

function Numbers({ v }: { v: View }) {
  return (
    <section className="rounded-[22px] bg-estimate-mint p-5">
      <p className="text-sm font-semibold">Your rebate</p>
      <p className="font-display text-4xl font-extrabold text-estimate-green">{aud(v.numbers.rebate)}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-card p-3"><p className="text-xs">Your cost</p><p className="font-display text-lg font-extrabold">{v.numbers.cost != null ? aud(v.numbers.cost) : "Coming soon"}</p></div>
        <div className="rounded-2xl bg-card p-3"><p className="text-xs">Paid so far</p><p className="font-display text-lg font-extrabold">{aud(v.numbers.paid)}</p></div>
      </div>
      <p className="mt-3 text-sm">Rebate is taken off your bill. You never have to claim it.</p>
    </section>
  );
}

function CancelMyJob({ token }: { token: string }) {
  const cancel = useServerFn(cancelMyJob);
  const qc = useQueryClient();
  const [step, setStep] = useState<"idle" | "confirm" | "busy" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  if (step === "done") return <section className="rounded-[22px] bg-card p-5 text-center text-sm shadow-sm"><p className="font-bold">Your job is cancelled.</p><p className="mt-1">No charge. Thanks for letting us know.</p></section>;
  if (step === "idle") return <p className="pt-2 text-center"><button type="button" onClick={() => setStep("confirm")} className="text-xs text-estimate-navy/70 underline">Cancel my job</button></p>;
  return <section className="rounded-[22px] bg-card p-5 shadow-sm">
    <p className="font-display text-lg font-extrabold">Cancel your job?</p>
    <p className="mt-1 text-sm">No charge. You can ask us questions or change your mind before your Pre Insulation Electrical Safety Assessment (PIESA) is booked.</p>
    {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
    <button type="button" disabled={step === "busy"} onClick={async () => { setStep("busy"); setErr(null); const r = await cancel({ data: { token } }); if (r.ok) { setStep("done"); qc.invalidateQueries(); } else { setErr(r.reason ?? "Something went wrong."); setStep("confirm"); } }} className="mt-4 flex h-12 w-full items-center justify-center rounded-full bg-estimate-navy font-bold text-estimate-canvas">{step === "busy" ? "Cancelling…" : "Yes, cancel my job"}</button>
    <button type="button" onClick={() => setStep("idle")} className="mt-2 flex h-12 w-full items-center justify-center rounded-full font-bold text-estimate-blue">Keep my job</button>
  </section>;
}

function Back({ token }: { token: string }) {
  return <Link to="/my-job/$token" params={{ token }} search={{}} className="inline-flex h-12 items-center text-sm font-bold text-estimate-blue">‹ Back to my job</Link>;
}

function SpotScreen({ v, token }: { v: View; token: string }) {
  return <>
    <Back token={token} />
    <Hero v={v} level={HOUSE_LEVEL.save_my_spot} size="sm" headline={ownerHeadline("save_my_spot", v.numbers.rebate)} />
    <section className="rounded-[22px] bg-card p-5 shadow-sm">
      <h2 className="font-display text-xl font-extrabold">Save my spot</h2>
      {/* Decision 388: saving a spot never offers times or a Ready Check. */}
      <p className="mt-1 text-sm">{SPOT_FREE} {SPOT_WAIT_LINE}</p>
      <a href={`/estimate/${token}`} className="mt-4 flex h-12 items-center justify-center rounded-full bg-estimate-green font-bold text-estimate-canvas">See my estimate and save my spot</a>
    </section>
  </>;
}

/** Approved P2 quote + acceptance page (decision 127): quote as the email, then "Say yes". Facts and guards unchanged. */
function QuoteScreen({ v, token }: { v: View; token: string }) {
  const [acknowledged, setAcknowledged] = useState<{ id: string; version: number } | null>(null);
  const qc = useQueryClient();
  const q = v.quote;
  const rebate = q?.rebate ?? v.numbers.rebate;
  const measured = (v.progress as { at: string | null }[])[0]?.at ?? null;
  const full = q ? q.total + q.rebate : null;
  return <>
    <Back token={token} />
    <section data-testid="owner-quote-heading">
      {/* Installer-quoted jobs the owner already agreed (Jo 7 Oct 9:25pm) keep their "Confirm your insulation job" title. */}
      <PageIntro kicker={P2.kicker} title={q ? (v.agreed?.agreed ? ownerPriceTitle(v.agreed) : P2.title(v.firstName)) : (rebate > 0 ? <>You could save <span className="text-estimate-green">{aud(rebate)}</span> on ceiling insulation</> : "Your ceiling insulation quote")}>
        {q ? P2.sub({ address: v.address, measuredOn: measured ? dayMonth(measured) : null, heldUntil: q.heldUntil ? longDate(q.heldUntil) : null }) : v.address}
      </PageIntro>
      {agreedWithLabel(v.agreed) && <p className="mt-2 text-sm font-semibold" data-agreed-with>{agreedWithLabel(v.agreed)}</p>}
      {!q && <div role="status" className="mt-6"><p className="font-semibold">Your exact price is being worked out.</p><p className="mt-1 text-sm">We'll let you know as soon as it's ready.</p></div>}
    </section>
    {q && <>
      <section className="rounded-[18px] bg-estimate-panel px-4 py-[18px]">
        {q.rebate > 0 && <div className="rounded-[14px] border-2 border-estimate-green bg-estimate-rebate px-2.5 py-4 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em]">{P2.rebateEyebrow}</p>
          <p className="mt-1 font-display text-[32px] font-extrabold leading-none text-estimate-green">{P2.youSave(shortAud(q.rebate))}</p>
          <p className="mt-1.5 text-[13px]">{P2.rebateNote}</p>
        </div>}
        <div className="pt-[18px] pb-1 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em]">{P2.priceEyebrow}</p>
          <p className="mt-1 font-display text-[42px] font-extrabold leading-none text-estimate-blue">{centsAud(q.total)}</p>
          {q.rebate > 0 && full != null && <p className="mt-1.5 text-[13px] font-bold">{P2.priceNote} <span className="line-through">{centsAud(full)}</span></p>}
          {/* Jo 4 Nov 2026 20:05 (pack 2 batch 5): the address is shown once, in the line under the title. */}
          {q.changesFootnote !== null && <p className="mt-3 border-t border-estimate-line pt-3 text-[13px] leading-relaxed text-estimate-sub">{q.changesFootnote ?? P2.measured}</p>}
        </div>
      </section>
      {q.validLine && <p data-testid="quote-valid-line" className="text-center text-[13px] font-semibold text-estimate-sub">{q.validLine}</p>}
      {q.changes.length > 0 && <section data-testid="quote-changes" className="rounded-[14px] bg-estimate-mist px-4 py-3.5">
        <h2 className="text-[15px] font-bold">{QUOTE_CHANGES_HEADING}</h2>
        <p className="mt-1 text-right text-xs text-estimate-sub">Estimate → Quote</p>
        <ul>{q.changes.map((r: { label: string; estimate: string; quote: string }) => <li key={r.label} className="flex items-baseline justify-between gap-2.5 border-t border-estimate-line py-2.5 text-sm"><span>{r.label}</span><span className="tabular-nums">{r.estimate} → <b>{r.quote}</b></span></li>)}</ul>
        {q.changesFootnote !== null && <p className="mt-1 text-[13px] text-estimate-sub">{q.changesFootnote ?? QUOTE_CHANGES_FOOTNOTE}</p>}
      </section>}
      <section className="rounded-[14px] border border-estimate-line bg-card px-4 pt-3.5 pb-1.5">
        <h2 className="mb-1 text-[15px] font-bold">{P2.itemsTitle}</h2>
        {/* Part 10 Task 6: an installer's own customer (co-brand approved) sees the approved rows — Insulation · extras · fee · PIESA · Rebate · Your price. */}
        {q.ownRows ? <ul data-testid="quote-lines-own">
          <li className="flex items-start justify-between gap-2.5 py-2.5"><span className="text-sm font-bold">Ready Check</span><span className="shrink-0 text-sm font-bold text-estimate-green">FREE</span></li>
          {q.ownRows.map((r: { key: string; label: string; detail: string | null; amountIncGst: number }, i: number) => r.key === "total"
            ? <li key={i} className="flex items-center justify-between gap-2.5 border-t-2 border-estimate-navy py-3"><span className="text-base font-bold">{r.label}</span><span className="font-display text-lg font-extrabold text-estimate-blue">{centsAud(r.amountIncGst)}</span></li>
            : <li key={i} className="flex items-start justify-between gap-2.5 border-t border-estimate-line py-2.5"><span className="min-w-0 break-words"><span className="block text-sm font-bold">{r.label}</span>{r.detail && <span className="block text-xs text-estimate-sub">{r.detail}</span>}{r.key === "rebate" && <span className="block text-xs text-estimate-sub">{P2.rebateLineSub}</span>}</span><span className={`shrink-0 text-sm tabular-nums ${r.key === "rebate" ? "font-bold text-estimate-green" : ""}`}>{r.key === "rebate" ? `−${centsAud(Math.abs(r.amountIncGst))}` : centsAud(r.amountIncGst)}</span></li>)}
        </ul> : <ul data-testid="quote-lines">
          <li className="flex items-start justify-between gap-2.5 py-2.5"><span className="text-sm font-bold">Ready Check</span><span className="shrink-0 text-sm font-bold text-estimate-green">FREE</span></li>
          {q.lines.map((l: { description: string; amount: number }, i: number) => <li key={i} className="flex items-start justify-between gap-2.5 border-t border-estimate-line py-2.5"><span className="min-w-0 break-words text-sm font-bold">{l.description}</span><span className="shrink-0 text-sm tabular-nums">{centsAud(l.amount)}</span></li>)}
          {q.rebate > 0 && full != null && <li className="flex items-start justify-between gap-2.5 border-t border-estimate-line py-2.5"><span><span className="block text-sm font-bold">{P2.fullPrice}</span><span className="block text-xs text-estimate-sub">{P2.fullPriceSub}</span></span><span className="shrink-0 text-sm font-bold tabular-nums">{centsAud(full)}</span></li>}
          {q.rebate > 0 && <li className="flex items-start justify-between gap-2.5 border-t border-estimate-line py-2.5"><span><span className="block text-sm font-bold">{P2.rebateLine}</span><span className="block text-xs text-estimate-sub">{P2.rebateLineSub}</span></span><span className="shrink-0 text-sm font-bold tabular-nums text-estimate-green">−{centsAud(q.rebate)}</span></li>}
          <li className="flex items-center justify-between gap-2.5 border-t-2 border-estimate-navy py-3"><span className="text-base font-bold">{P2.youPay}</span><span className="font-display text-lg font-extrabold text-estimate-blue">{centsAud(q.total)}</span></li>
        </ul>}
        <p className="border-t border-estimate-line py-2 text-[13px] leading-relaxed text-estimate-sub">{P2.notIncluded}</p>
      </section>
      {/* Jo 4 Nov 2026 16:10 (approved): the Ready Check says the old insulation stays — same words as the quote email and the agreement. */}
      {v.keptInsulation && <p data-testid="kept-insulation" className="rounded-[14px] bg-estimate-mist px-4 py-3.5 text-sm leading-relaxed">{v.keptInsulation.line}</p>}
      {ownerQuoteCanAccept(q, acknowledged)
        ? <div><AcceptQuote token={token} quote={q} safetyCheck={q.split?.deposit ?? null} showDocs={!!q.validLine} onAccepted={() => {
          setAcknowledged({ id: q.id, version: q.version });
          qc.setQueryData<View | null>(["my-job", token], (current: View | null | undefined) => current?.quote?.id === q.id && current.quote.version === q.version
            ? { ...current, quote: { ...current.quote, status: "accepted" } } : current);
        }} /><DeclineQuote token={token} quoteId={q.id} /></div>
        : q.status === "declined"
          ? <p data-quote-declined className="rounded-[14px] bg-estimate-mist px-4 py-3 text-sm">{OWNER_DECLINED_SCREEN}</p>
          : <p className="rounded-[14px] bg-estimate-mint px-4 py-3 text-center text-sm font-bold text-estimate-green">You said yes. Thanks!</p>}
      {q.status === "accepted" && <PayNowCard v={v} token={token} />}
      <OwnerFooter />
    </>}
  </>;
}

/** Decisions 139/140/141: what is due now and how to pay it. Card ("Pay now", Xero online invoice) only for the $349
 *  safety check, electrical upgrades and the install deposit (Jo 29 Oct); the balance is bank transfer / PayID only. Never a card fee. */
function PayNowCard({ v, token }: { v: View; token: string }) {
  const p = v.payment as { dueNow: number; remaining: number; paid: number; payNow: { title: string; amount: number; card: boolean; lines: string[] }; provisional: { expiresAt: string | null; deposit: number } | null } | null;
  const checkout = useServerFn(ownerCardCheckoutFn);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  if (!p || (p.dueNow <= 0 && !p.provisional)) return null;
  return <section data-testid="pay-now" className="rounded-[22px] border-2 border-estimate-green bg-card p-5">
    <p className="text-xs font-bold uppercase tracking-wide text-estimate-green">Payment</p>
    <h3 className="mt-1 font-display text-lg font-extrabold">{p.payNow.title}</h3>
    {p.payNow.card && <button type="button" disabled={busy} className="mt-3 flex h-12 w-full items-center justify-center rounded-full bg-estimate-green font-bold text-estimate-canvas disabled:opacity-60" onClick={async () => {
      setErr(""); setBusy(true);
      try { const r = await checkout({ data: { token } }); if ("url" in r && r.url) window.location.assign(r.url); else setErr(("blocker" in r && r.blocker) || "Please pay by bank transfer."); }
      catch (e) { setErr(errText(e)); } finally { setBusy(false); }
    }}>{busy ? "Opening secure card payment…" : `Pay now by card — ${aud(p.payNow.amount)}`}</button>}
    {err && <p role="alert" className="mt-2 text-sm font-semibold text-destructive">{err}</p>}
    <ul className="mt-3 space-y-1 text-sm">{p.payNow.lines.map((l) => <li key={l}>{l}</li>)}</ul>
    {p.paid > 0 && <p className="mt-2 text-xs text-estimate-navy/70">Paid so far: {aud(p.paid)}. Remaining: {aud(p.remaining)}.</p>}
  </section>;
}

/** Decision 366 (audit F03): the Home card for an electrical upgrades quote that needs the owner. */
/** A48 batch 1 final fix (Jo 29 Oct 2026, approved wording verbatim): life support yes / unknown and no plan on file →
 *  the owner uploads the written consent or medical plan (photo or PDF). That file alone clears the safety check block. */
function LifeSupportPlanCard({ token }: { token: string }) {
  const load = useServerFn(getLifeSupportPlanState);
  const start = useServerFn(startLifeSupportPlanUploadFn);
  const finish = useServerFn(finishLifeSupportPlanUploadFn);
  const { data } = useQuery({ queryKey: ["owner-life-support-plan", token], queryFn: () => load({ data: { token } }), retry: false, refetchOnWindowFocus: false });
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [err, setErr] = useState("");
  if (done) return <section data-testid="life-support-plan-done" role="status" className="flex items-start gap-3 rounded-[22px] bg-estimate-mint p-5"><Check className="mt-0.5 h-5 w-5 shrink-0 text-estimate-green" aria-hidden /><p className="font-bold">Thanks, we've got your life support plan.</p></section>;
  if (!data?.show) return null;
  const upload = async (file: File) => {
    setErr(""); setBusy(true);
    try {
      const slot = await start({ data: { token, fileName: file.name, mime: file.type, size: file.size } });
      const up = await supabase.storage.from("job-files").uploadToSignedUrl(slot.path, slot.uploadToken, file, { contentType: slot.mime });
      if (up.error) throw new Error("The upload was interrupted. Please check your connection and try again.");
      await finish({ data: { token, path: slot.path, fileName: file.name } });
      setDone(true);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return <section data-testid="life-support-plan" className="rounded-[22px] border-2 border-estimate-green bg-card p-5">
    <h2 className="font-display text-lg font-extrabold">LIFE SUPPORT PLAN</h2>
    <p className="mt-1 text-sm">Someone at your home uses life support equipment (or you weren't sure). Before the electrician's safety check, please upload your written consent or medical plan.</p>
    <input ref={input} type="file" accept="application/pdf,image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
    {err && <p role="alert" className="mt-2 text-sm font-bold text-destructive">{err}</p>}
    <button type="button" className={`${signBtn} mt-4`} disabled={busy} onClick={() => input.current?.click()} aria-busy={busy}>Upload file</button>
  </section>;
}

/** Decision 366 (audit F03): the electrical fixes screen (?screen=fixes, O29's link). The latest fixes quote (lines + total)
 *  → Approve (6-digit code session, same acceptance helper as the installation quote, without regenerating it) → pay in full
 *  (the existing PayNowCard `fixes` step: card when Stripe is on, else bank transfer) → pick one of the electrician's times → booked. */
function FixesScreen({ v, token }: { v: View; token: string }) {
  const load = useServerFn(ownerFixesStateFn);
  const approve = useServerFn(ownerApproveFixesFn);
  const pick = useServerFn(ownerPickFixesTimeFn);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["owner-fixes", token], queryFn: () => load({ data: { token } }), retry: false });
  const [session, setSession] = useSession();
  const [needCode, setNeedCode] = useState(false);
  const [tick, setTick] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["owner-fixes", token] }), qc.invalidateQueries({ queryKey: ["my-job", token] })]);
  const run = async (fn: (s: string) => Promise<unknown>) => {
    if (!session) { setNeedCode(true); return; }
    setErr(""); setBusy(true);
    try { await fn(session); await refresh(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  if (isLoading) return <><Back token={token} /><p role="status" className="py-10 text-center text-sm">Opening your electrical upgrades…</p></>;
  // Part 3 Task 1 (Jo 2 Nov 2026): no Home Insulation Victoria upgrades quote — the electrician arranges the upgrades directly.
  if (data?.electricianBills && (data.step === "none" || !data.quote)) return <><Back token={token} /><section data-testid="fixes-electrician-bills" className="rounded-[22px] bg-card p-5 shadow-sm"><p className="text-sm">{data.electricianBills}</p></section></>;
  if (!data || data.step === "none" || !data.quote) return <><Back token={token} /><section className="rounded-[22px] bg-card p-5 shadow-sm"><p className="font-display text-lg font-extrabold">No electrical upgrades to look at</p><p className="mt-1 text-sm">Your safety check didn't leave any electrical upgrades for you to approve.</p></section></>;
  const q = data.quote;
  return <>
    <Back token={token} />
    <section data-testid="fixes-screen" data-step={data.step} className="space-y-4">
      <PageIntro kicker={OWNER_FIXES_COPY.kicker} title={OWNER_FIXES_COPY.title}>{v.address}</PageIntro>
      <section className="rounded-[14px] border border-estimate-line bg-card px-4 pt-3.5 pb-1.5">
        <ul data-testid="fixes-lines">
          {q.lines.map((l, i) => <li key={i} className={`flex items-start justify-between gap-2.5 py-2.5 ${i ? "border-t border-estimate-line" : ""}`}><span className="min-w-0 break-words text-sm font-bold">{l.description}</span><span className="shrink-0 text-sm tabular-nums">{centsAud(l.amount)}</span></li>)}
          <li className="flex items-center justify-between gap-2.5 border-t-2 border-estimate-navy py-3"><span className="text-base font-bold">Total (inc GST)</span><span className="font-display text-lg font-extrabold text-estimate-blue" data-testid="fixes-total">{centsAud(q.total)}</span></li>
        </ul>
      </section>
      {data.step === "approve" && <div data-testid="fixes-approve">
        <p className="text-sm">{OWNER_FIXES_COPY.approve}</p>
        <TickCard on={tick} set={setTick} title={OWNER_FIXES_COPY.approveTick} />
        {needCode && !session && <div className="mt-4"><OwnerCodeGate token={token} onVerified={(s) => { setSession(s); setNeedCode(false); }} /></div>}
        <LockedButton ready={tick} busy={busy} busyLabel="Approving…" onClick={() => void run((s) => approve({ data: { token, session: s, quoteId: q.id, ...(q.version != null ? { expectedVersion: q.version } : {}), approve: true } }))}>{OWNER_FIXES_COPY.approveButton}</LockedButton>
        <DeclineQuote token={token} quoteId={q.id} />
      </div>}
      {data.step === "pay" && <><p className="text-sm font-semibold">{OWNER_FIXES_COPY.pay}</p><PayNowCard v={v} token={token} /></>}
      {!v.inHouseDispatch && data.step === "pick" && <div data-testid="fixes-pick" className="space-y-2">
        <p className="text-sm font-semibold">{OWNER_FIXES_COPY.pick}</p>
        {data.windows.map((w) => <label key={w.id} className="flex min-h-12 items-center gap-3 rounded-2xl border border-estimate-line bg-card px-4 text-sm font-semibold"><input type="radio" name="fixes-time" checked={chosen === w.id} onChange={() => setChosen(w.id)} />{formatPiesaTime(w.startsAt)}</label>)}
        {needCode && !session && <div className="mt-4"><OwnerCodeGate token={token} onVerified={(s) => { setSession(s); setNeedCode(false); }} /></div>}
        <LockedButton ready={!!chosen} busy={busy} busyLabel="Booking…" onClick={() => void run((s) => pick({ data: { token, session: s, proposalId: chosen! } }))}>{OWNER_FIXES_COPY.pickButton}</LockedButton>
      </div>}
      {!v.inHouseDispatch && data.step === "waiting_times" && <p className="rounded-[14px] bg-estimate-mist px-4 py-3 text-sm">{OWNER_FIXES_COPY.waitingTimes}</p>}
      {!v.inHouseDispatch && data.step === "booking" && <p className="rounded-[14px] bg-estimate-mist px-4 py-3 text-sm">{OWNER_FIXES_COPY.booking}</p>}
      {data.step === "booked" && data.bookedAt && <p data-testid="fixes-booked" className="rounded-[14px] bg-estimate-mint px-4 py-3 text-center text-sm font-bold text-estimate-green">{OWNER_FIXES_COPY.booked(formatPiesaTime(data.bookedAt))}</p>}
      {data.step === "declined" && <p className="rounded-[14px] bg-estimate-mist px-4 py-3 text-sm">{OWNER_FIXES_COPY.declined}</p>}
      {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
      <OwnerFooter />
    </section>
  </>;
}

/** Part 4 Task 14: only a job already mid-way through the old pick-a-day step reaches this screen (resolveOwnerScreen falls
 *  through otherwise). It shows the times/days already offered and nothing else: no "pick windows" intro, no change buttons. */
function BookScreen({ v, token }: { v: View; token: string }) {
  // G8 (4), 4 Nov 2026 (LOOKS WRONG 1): the owner's Ready Check window from the installer's run — Confirm / Can't make it.
  if ((v as { readyCheckWindow?: boolean }).readyCheckWindow) return <><Back token={token} /><OwnerRunTime token={token} /></>;
  if (v.inHouseDispatch) return <><Back token={token} /><PayNowCard v={v} token={token} /><BookPickers token={token} /></>;
  return <>
    <Back token={token} />
    <Hero v={v} level={HOUSE_LEVEL.book_visits} size="sm" headline={ownerHeadline("booking_visits", v.numbers.rebate)} />
    <ThirtyDayClock />
    <BookPickers token={token} />
    <PayNowCard v={v} token={token} />
    {v.canCancel && <CancelMyJob token={token} />}
  </>;
}

function DoneScreen({ v, token }: { v: View; token: string }) {
  return <>
    {v.stage !== "complete" && <Back token={token} />}
    {v.veecAssignment && <VeecAssignmentCard v={v} token={token} />}
    <Hero v={v} level={HOUSE_LEVEL.all_done} headline={ownerHeadline("all_done", v.numbers.rebate)} />
    <Numbers v={v} />
  </>;
}
/** Decision 296 (mock-up P6): "Your electrical safety check — please confirm". The date, the electrician, the result and the
 *  ceiling-entry warning come from the job record; one tick ("The assessment was completed on …"), typed full name =
 *  signature, no 6-digit code (decision 306). After signing: "Confirmed on <date>". Nothing when there is no PIESA yet. */
function PiesaConfirmCard({ v, token }: { v: View; token: string }) {
  const load = useServerFn(ownerPiesaConfirmFn);
  const sign = useServerFn(ownerSignPiesaConfirmFn);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["owner-piesa-confirm", token], queryFn: () => load({ data: { token } }) });
  const [f, setF] = useState({ name: "", authority: "owner" as "owner" | "authorised_representative" });
  const [tick, setTick] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  if (!data) return null;
  if (data.confirmed) return <section data-testid="piesa-confirmed" className="flex items-start gap-3 rounded-[22px] bg-estimate-mint p-5">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-estimate-green text-estimate-canvas"><Check className="h-5 w-5" /></span>
    <div><p className="font-display text-lg font-extrabold">{P6.confirmedTitle}</p><p className="text-sm">{P6.confirmedOn(data.confirmed.signedOn, data.confirmed.name)}</p></div>
  </section>;
  const ready = tick && f.name.trim().length >= 2;
  const doSign = async () => {
    setErr(""); setBusy(true);
    try { await sign({ data: { token, signatoryName: f.name, authorityType: f.authority, signatureName: f.name, confirmed: tick } }); await Promise.all([qc.invalidateQueries({ queryKey: ["owner-piesa-confirm", token] }), qc.invalidateQueries({ queryKey: ["my-job", token] })]); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return <section data-testid="piesa-confirm" className="space-y-4">
    <PageIntro kicker={P6.kicker} title={P6.title}>{P6.sub(data.assessmentDate)}</PageIntro>
    <InfoBox><b>{P6.whyLead}</b>{P6.why}</InfoBox>
    <FormCard eyebrow={P6.formEyebrow}>
      <SectionTitle className="mt-1.5 mb-1">{P6.factsTitle}</SectionTitle>
      <FactRows rows={[{ label: P6.rows.date, value: data.assessmentDate }, { label: P6.rows.electrician, value: data.electricianLine }, { label: P6.rows.result, value: data.outcome }]} />
      <p className="mt-3 rounded-[10px] bg-estimate-blush p-3 text-[13px] leading-relaxed"><b>{P6.warningLead}</b>{data.warning}</p>
      <p className="mt-2 text-xs text-estimate-sub">{P3.wrong} <a className="font-bold text-estimate-blue" href={`mailto:${OFFICE_EMAIL}?subject=${encodeURIComponent(`My electrical safety check${v.jobNumber ? ` – ${v.jobNumber}` : ""}`)}`}>Tell us before you confirm</a></p>
      <SectionTitle className="mt-[18px]">{P6.declareTitle}</SectionTitle>
      <TickCard on={tick} set={setTick} title={data.tick} sub={P6.declare} read="Read the four declarations ›" readBody={(data.declarations as string[]).map((d) => `• ${d}`).join("\n")} />
      <AuthorityChoice value={f.authority} onChange={(authority) => setF({ ...f, authority })} />
      <TypedField label={P6.signLabel} value={f.name} onChange={(name) => setF({ ...f, name })} placeholder={P6.typeHere} autoComplete="name" />
      <p className="mt-1.5 text-xs leading-relaxed text-estimate-sub">{P6.dateLine(longDate(new Date().toISOString()))}</p>
    </FormCard>
    {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
    <div>
      <LockedButton ready={ready} busy={busy} busyLabel={P6.signing} onClick={() => void doSign()}>{P6.button}</LockedButton>
      {!ready && <LockHint>{P6.lockHint}</LockHint>}
      <SmallNote>{P6.afterNote}</SmallNote>
      <OwnerFooter />
    </div>
  </section>;
}

/** Decision 119/120: the official ESC VEEC assignment form, shown read-only and signed by the owner ONLY after the install
 *  is recorded complete (never at acceptance). Installer → AP sign first; the owner is the last signature. */
/** Approved P4 (decision 129): Section 1 summarised with the full text a tap away, Section 2 read-only, Section 4
 *  declaration verbatim with the one "I have read and make every declaration above" tick, the 18+/owner tick, typed
 *  name. Same server function (over18 + confirmsSection2 + 6-digit code, asked for on the button). */
function VeecAssignmentCard({ v, token }: { v: View; token: string }) {
  const load = useServerFn(ownerVeecAssignmentFn);
  const sign = useServerFn(ownerSignVeecAssignmentFn);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["owner-veec", token], queryFn: () => load({ data: { token } }) });
  const [session, setSession] = useSession();
  const [needCode, setNeedCode] = useState(false);
  const [f, setF] = useState({ name: "", authority: "owner" as "owner" | "authorised_representative" });
  const [ok18, setOk18] = useState(false); const [okS2, setOkS2] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [showRights, setShowRights] = useState(false); const [showAll, setShowAll] = useState(false);
  if (!data) return null;
  const rows = (data.rows ?? []) as { label: string; value: string }[];
  if (data.signedAt) return <section data-testid="veec-signed" className="flex items-start gap-3 rounded-[22px] bg-estimate-mint p-5">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-estimate-green text-estimate-canvas"><Check className="h-5 w-5" /></span>
    <div><p className="font-display text-lg font-extrabold">Rebate form: Signed ✓</p><p className="text-sm">Signed {day(data.signedAt)}. {data.copySentAt ? "We've emailed you a copy." : "Your copy is on its way within 10 business days."}</p></div>
  </section>;
  const rebate = shortAud(v.numbers.rebate);
  const installedOn = (v.progress as { at: string | null }[])[3]?.at ?? null;
  const ready = ok18 && okS2 && f.name.trim().length >= 2;
  const doSign = async () => {
    if (!session) { setNeedCode(true); return; }
    setErr(""); setBusy(true);
    try { await sign({ data: { token, session, signatoryName: f.name, authorityType: f.authority, signatureName: f.name, over18: ok18, confirmsSection2: okS2 } }); await Promise.all([qc.invalidateQueries({ queryKey: ["owner-veec", token] }), qc.invalidateQueries({ queryKey: ["my-job", token] })]); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return <section data-testid="veec-assignment" className="space-y-4">
    <PageIntro kicker={data.canSign ? P4.kicker : "Coming up"} title={P4.title(v.firstName)}>
      {data.canSign ? P4.intro({ installedOn: installedOn ? weekdayDate(installedOn) : null, rebate }) : data.waitingOn === "installer" ? P4.waitingInstaller : P4.waitingAp}
    </PageIntro>
    <InfoBox className="text-[13px]"><b>{P4.rightsLead}</b>{P4.rights(rebate)}<button type="button" className="font-bold text-estimate-blue" aria-expanded={showRights} onClick={() => setShowRights((s) => !s)}>{P4.rightsRead}</button>
      {showRights && <pre className="mt-3 whitespace-pre-wrap border-t border-estimate-line pt-3 font-sans text-[13px] leading-relaxed">{data.rights}</pre>}
    </InfoBox>
    <FormCard eyebrow={P4.formEyebrow}>
      <SectionTitle className="mt-4 mb-0.5">{P4.section2}</SectionTitle>
      {rows.length > 0 ? <FactRows rows={rows} labelWidth="42%" /> : <p className="mt-1 text-sm text-estimate-sub">Being completed from your job record.</p>}
      <p className="mt-2 text-xs text-estimate-sub">{P4.wrong} <a className="font-bold text-estimate-blue" href={`mailto:${OFFICE_EMAIL}?subject=${encodeURIComponent(`Rebate form details${v.jobNumber ? ` – ${v.jobNumber}` : ""}`)}`}>{P4.tellUs}</a></p>
      <SectionTitle className="mt-4 mb-0.5">{P4.section4}</SectionTitle>
      <p className="text-[13px] text-estimate-sub">{P4.declare}</p>
      <ul className="mt-1">{declarationBullets(data.consumerDeclaration).map((b) => <li key={b} className="flex gap-2 py-1 text-[13px] leading-[1.45]"><span className="text-estimate-blue">•</span><span>{b}</span></li>)}</ul>
      {/* G8 (6), 4 Nov 2026 (LOOKS WRONG 15): the form version on its own line — no "·" that wrapped onto a new line on the phone. */}
      <p className="mt-1 text-xs text-estimate-sub"><button type="button" className="font-bold text-estimate-blue" aria-expanded={showAll} onClick={() => setShowAll((s) => !s)}>{showAll ? "Hide the installer and Home Insulation Victoria declarations" : "Show the installer and Home Insulation Victoria declarations"}</button></p>
      <p className="mt-0.5 text-xs text-estimate-sub">Official form {data.version}</p>
      {showAll && <pre className="mt-2 whitespace-pre-wrap rounded-[10px] bg-estimate-panel p-3 font-sans text-[13px] leading-relaxed">{[data.apDeclaration, data.installerDeclaration].join("\n\n")}</pre>}
      {data.canSign && <>
        <TickCard on={okS2} set={setOkS2} title={P4.tick} />
        <TickCard on={ok18} set={setOk18} title={P2.tick3} />
        <AuthorityChoice value={f.authority} onChange={(authority) => setF({ ...f, authority })} />
        <TypedField label={P4.signLabel} value={f.name} onChange={(name) => setF({ ...f, name })} placeholder={P4.typeHere} autoComplete="name" />
        <p className="mt-1.5 text-xs leading-relaxed text-estimate-sub">{P4.dateLine(longDate(new Date().toISOString()))}</p>
      </>}
    </FormCard>
    {data.canSign && <>
      {needCode && !session && <OwnerCodeGate token={token} onVerified={(s) => { setSession(s); setNeedCode(false); }} />}
      {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
      <div>
        <LockedButton ready={ready} busy={busy} busyLabel={P4.signing} onClick={() => void doSign()}>{P4.button}</LockedButton>
        {!ready && <LockHint>{P4.lockHint}</LockHint>}
        <SmallNote>{P4.afterNote}</SmallNote>
        <OwnerFooter />
      </div>
    </>}
  </section>;
}


/** Jo-approved My job at the SPOT SAVED stage (before any Ready Check is booked). */
function SpotSavedHome({ v, token }: { v: View; token: string }) {
  const sp = v.spotSaved as { rebate: number; cost: number | null; shortAddress: string | null; videoInvite: boolean; released: boolean; optOutUrl: string };
  const L = spotSavedLayout(sp.released);
  const loadPw = useServerFn(ownerPaperworkFn);
  const { data: pw } = useQuery({ queryKey: ["owner-paperwork", token], queryFn: () => loadPw({ data: { token } }) });
  const [open, setOpen] = useState(false);
  const card = pw ? gateACard((pw.todo ?? []) as { gate: string }[]) : null;
  const optOut = (() => { try { const u = new URL(sp.optOutUrl); return u.pathname + u.search; } catch { return sp.optOutUrl; } })();
  return <>
    <section data-testid="spot-saved-hero" className="flex items-start gap-3 rounded-[26px] border border-estimate-line bg-card p-5">
      <OwnerHouse level={1} size="sm" />
      <div className="min-w-0">
        {v.firstName && <p className="text-sm font-semibold">Hi {v.firstName}</p>}
        <h1 className="mt-1 font-display text-2xl font-extrabold leading-tight">Spot saved. Your <span className="text-estimate-logo-green">{aud(sp.rebate)}</span> rebate is waiting.</h1>
        <p className="mt-2 text-sm text-estimate-navy/80">{sp.shortAddress ? `${sp.shortAddress} · ` : ""}{L.stepLabel}</p>
      </div>
    </section>
    <OwnerRunTime token={token} />
    <OwnerReadyCheckTimes token={token} />
    {L.showWaitingBox && <p className="rounded-[18px] bg-estimate-heads-up p-4 text-sm">{SPOT_RELEASE_LINE}</p>}
    {card === "todo" && <section data-testid="gate-a-todo" className="rounded-[22px] border-2 border-estimate-green bg-card p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-estimate-green">While you wait · 2 minutes</p>
      <h2 className="mt-1 font-display text-xl font-extrabold">Get your paperwork out of the way</h2>
      <p className="mt-1 text-sm">A few quick questions and your OK to share your details with the trades. Do it now and it's out of the way when your spot is released.</p>
      {!open ? <button type="button" onClick={() => setOpen(true)} className="mt-4 flex h-12 w-full items-center justify-center rounded-full bg-estimate-green font-bold text-estimate-canvas">Do it now</button> : <div className="mt-4"><OwnerPaperwork token={token} /></div>}
    </section>}
    {card === "done" && <section data-testid="gate-a-done" className="flex items-start gap-3 rounded-[22px] bg-estimate-mint p-5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-estimate-green text-estimate-canvas"><Check className="h-5 w-5" /></span>
      <div><p className="font-display text-lg font-extrabold">Paperwork done. You're ready to go.</p>{L.doneSub && <p className="text-sm">{L.doneSub}</p>}</div>
    </section>}
    {sp.videoInvite && <section className="rounded-[22px] bg-estimate-mint p-5">
      <h2 className="font-display text-lg font-extrabold">Help us check your insulation: send a quick video</h2>
      <Link to="/estimate/$token/video" params={{ token }} className="mt-3 flex h-12 w-full items-center justify-center rounded-full bg-estimate-green font-bold text-estimate-canvas">Send a quick video</Link>
    </section>}
    <section className="rounded-[22px] bg-card p-5 shadow-sm">
      <p className="font-display text-lg font-extrabold">Your progress</p>
      <ol className="mt-3 space-y-3">{SPOT_SAVED_PROGRESS.map((p, i) => (
        <li key={p.label} className="flex items-start gap-3 text-sm">
          {i < L.currentIndex ? <Check className="mt-0.5 h-4 w-4 text-estimate-green" /> : <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${i === L.currentIndex ? "bg-estimate-blue" : "bg-estimate-line"}`} />}
          <span><span className={`block font-semibold ${i < L.currentIndex ? "text-estimate-green" : i === L.currentIndex ? "text-estimate-blue" : ""}`}>{p.label}</span>{!(i === 1 && !L.showReleasedSub) && <span className="text-estimate-navy/70">{p.sub}</span>}</span>
        </li>))}</ol>
    </section>
    <section className="rounded-[22px] bg-card p-5 shadow-sm">
      <p className="font-display text-lg font-extrabold">Your numbers</p>
      <div className="mt-3 flex justify-between text-sm"><span>Your rebate</span><span className="font-bold text-estimate-logo-green">{aud(sp.rebate)}</span></div>
      <div className="mt-2 flex justify-between text-sm"><span>Your estimated quote based on what you've told us</span><span className="font-bold">{sp.cost == null ? "—" : aud(sp.cost)}</span></div>
      <p className="mt-3 text-xs text-estimate-navy/70">{SPOT_PRICE_NOTE}</p>
    </section>
    <p className="pt-2 text-center"><a href={optOut} className="text-xs text-estimate-navy/70 underline">Remove my enquiry</a></p>
    {v.canCancel && <CancelMyJob token={token} />}
  </>;
}
