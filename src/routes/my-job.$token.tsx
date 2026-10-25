import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Phone } from "lucide-react";
import { cancelMyJob, getOwnerMyJob } from "@/lib/owner-myjob.functions";
import { OwnerHouse } from "@/components/owner/OwnerHouse";
import { PIESA_FIXES_NOTE, agreedWithLabel, ownerPriceTitle } from "@/lib/owner-confirm.core";
import { HOUSE_LEVEL } from "@/lib/owner-house.core";
import { ownerHeadline } from "@/lib/owner-headlines.core";
import { gateACard, SPOT_SAVED_PROGRESS } from "@/lib/owner-myjob.core";
import { ownerPaperworkFn } from "@/lib/owner-gates.functions";
import { earliestInstall, installDeadline, TWO_HOUR_WINDOWS, visitPill, type OwnerScreen } from "@/lib/owner-myjob.core";
import { PAYMENT_OPTION_SUMMARY, paymentOptionSummary } from "@/lib/payment-gate.core";
import { howYouPayLines, paymentPlan } from "@/lib/payments.core";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { OwnerPaperwork } from "@/components/owner/OwnerPaperwork";
import { OwnerCodeGate, signBtn } from "@/components/owner/OwnerSign";
import { ownerAcceptQuoteFn, ownerAgreementFn, ownerBookingStateFn, ownerCardCheckoutFn, ownerChoosePiesaFn, ownerDeclineQuoteFn, ownerChangeInstallDayFn, ownerSignConsentFn, ownerSuggestInstallDaysFn, ownerTakeInstallDayFn, ownerVeecAssignmentFn, ownerSignVeecAssignmentFn, ownerPiesaConfirmFn, ownerSignPiesaConfirmFn, ownerFixesConfirmFn, ownerSignFixesConfirmFn } from "@/lib/owner-link.functions";
import { DECLINE_REASONS, OWNER_DECLINED_SCREEN, type DeclineReason } from "@/lib/quote-decline.core";
import { melbourneToday, addYmd } from "@/lib/melbourne-time.core";
import { formatInstallDay } from "@/lib/install-days.core";
import { OwnerReadyCheckTimes } from "@/components/owner/OwnerReadyCheckTimes";
import { AuthorityChoice, FactRows, FormCard, InfoBox, LockHint, LockedButton, OwnerFooter, OwnerPageHeader, PageIntro, SectionTitle, SmallNote, ThirtyDayClock, TickCard, TypedField } from "@/components/owner/OwnerPageKit";
import { OFFICE_EMAIL, P2, P3, P4, P6, P6F, centsAud, dayMonth, declarationBullets, longDate, sentence, shortAud, weekdayDate } from "@/lib/owner-pages.core";
import { OWNER_DECLARATIONS, type OwnerDeclarationKey } from "@/lib/consent.core";

// Owner "My job" — no login. The secure link token is the only credential; nothing fetched during SSR.
const SCREENS = ["home", "spot", "quote", "book", "done"] as const satisfies readonly OwnerScreen[];

export const Route = createFileRoute("/my-job/$token")({
  ssr: false,
  // Same rule as the former zod schema (optional enum, anything else rejected) without pulling zod into every page's first load (decision 280).
  // SCREENS mirrors the OwnerScreen union in owner-myjob.core.
  validateSearch: (s: Record<string, unknown>): { screen?: OwnerScreen } => {
    const screen = s["screen"];
    if (screen === undefined) return {};
    if (typeof screen === "string" && (SCREENS as readonly string[]).includes(screen)) return { screen: screen as OwnerScreen };
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
  const { screen = "home" } = Route.useSearch();
  const load = useServerFn(getOwnerMyJob);
  const { data, isLoading } = useQuery({ queryKey: ["my-job", token], queryFn: () => load({ data: { token } }) as Promise<View | null>, staleTime: 30_000, retry: false, refetchOnWindowFocus: false });
  return (
    <div className="estimate-brand min-h-screen bg-estimate-canvas pb-10 text-estimate-navy">
      {/* Approved pages P2–P4 (Jo 24 Oct): white bar, logo left, job number right. */}
      <OwnerPageHeader right={data?.jobNumber ? (data.spotSaved ? `Job ${data.jobNumber}` : data.jobNumber) : undefined} />
      <main className="mx-auto max-w-[560px] space-y-4 px-4 pt-5 sm:px-5">
        {isLoading ? <p role="status" className="py-10 text-center text-sm">Opening your job…</p>
          : !data ? <Unavailable />
          : screen === "quote" ? <QuoteScreen v={data} token={token} />
          : screen === "book" ? <BookScreen v={data} token={token} />
          : screen === "done" || data.stage === "complete" ? <DoneScreen v={data} token={token} />
          : screen === "spot" ? <SpotScreen v={data} token={token} />
          : data.spotSaved ? <SpotSavedHome v={data} token={token} />
          : <Home v={data} token={token} />}
      </main>
    </div>
  );
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
      {size === "lg" && <>
        <div className="mt-4 grid grid-cols-5 gap-1.5" aria-hidden>{[0, 1, 2, 3, 4].map((i) => <span key={i} className={`h-2 rounded-full ${i < step || v.stage === "complete" ? "bg-estimate-green" : i === step ? "bg-estimate-blue" : "bg-estimate-line"}`} />)}</div>
        <div className="mt-2 flex justify-between text-xs font-semibold"><span>Step {Math.min(step + 1, 5)} of 5 · {v.progress[step]?.label}</span><span className="text-estimate-green">You're saving {aud(v.numbers.rebate)}</span></div>
      </>}
    </section>
  );
}

function Home({ v, token }: { v: View; token: string }) {
  const a = v.action;
  return <>
    {/* Approved P3 (decision 128): when the ESC consent is waiting, it is the page; everything else follows below. */}
    {v.consent && <ConsentCard v={v} token={token} />}
    {/* Decision 296 (P6): between the electrician's PIESA and the install day the owner confirms the safety check here; unsigned = the page. */}
    {v.piesaConfirm && <PiesaConfirmCard v={v} token={token} />}
    {v.fixesConfirm && <FixesConfirmCard token={token} />}
    <Hero v={v} level={v.hero.level} headline={v.hero.headline} />
    <OwnerReadyCheckTimes token={token} />
    {/* Decision 137: the 30-day clock on the owner's job page while the install is being booked. */}
    {a.button?.screen === "book" && <ThirtyDayClock />}
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

function useSession() { return useState<string | null>(null); }
const errText = (e: unknown) => (e instanceof Error ? e.message : "Please try again.");

/** Approved P2 "Say yes" (decisions 126/127): two ticks, full name, the 18+/owner tick, typed signature, one locked button.
 *  Same server function, validation and 6-digit code: the code is asked for when the owner presses the button. */
function AcceptQuote({ token, quote, rebate, safetyCheck }: { token: string; quote: { id: string; version: number }; rebate: number; safetyCheck: number | null }) {
  const [session, setSession] = useSession();
  const [needCode, setNeedCode] = useState(false);
  const load = useServerFn(ownerAgreementFn);
  const accept = useServerFn(ownerAcceptQuoteFn);
  const qc = useQueryClient();
  const { data: ag } = useQuery({ queryKey: ["owner-agreement", quote.id], queryFn: () => load({ data: { token, quoteId: quote.id } }) });
  const [f, setF] = useState({ name: "", authority: "owner" as "owner" | "authorised_representative", sig: "" });
  const [over18, setOver18] = useState(false); const [read, setRead] = useState(false); const [agree, setAgree] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const blocked = (ag?.blockers ?? []) as string[];
  const fee = safetyCheck != null ? shortAud(safetyCheck) : "$349";
  const feeCents = safetyCheck != null ? centsAud(safetyCheck) : "$349.00";
  const ready = blocked.length === 0 && over18 && read && agree && f.name.trim().length >= 2 && f.sig.trim().length >= 2;
  const sign = async () => {
    if (!session) { setNeedCode(true); return; }
    setErr(""); setBusy(true);
    try { await accept({ data: { token, session, quoteId: quote.id, expectedVersion: quote.version, signing: { signatoryName: f.name, authorityType: f.authority, signatureName: f.sig, over18, readConsumerInfo: read, acceptAgreement: agree, assistance: "none" } } }); await qc.invalidateQueries({ queryKey: ["my-job", token] }); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div data-testid="say-yes" className="mt-7 border-t-2 border-estimate-navy pt-5">
      <p className="text-xs font-bold tracking-[0.1em] text-estimate-logo-green">{P2.sayYes}</p>
      <h2 className="mt-1 font-display text-[21px] font-extrabold">{P2.twoThings}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-estimate-sub">{P2.tapEach}</p>
      <TickCard on={agree} set={setAgree} title={P2.tick1} sub={P2.tick1Sub(shortAud(rebate))} read={P2.tick1Read} readBody={ag?.agreementWording ? <>{`The agreement (${ag.agreementWording.version})`}{"\n\n"}{ag.agreementWording.body}</> : "Loading…"} />
      <TickCard on={read} set={setRead} title={P2.tick2} sub={P2.tick2Sub(fee)} read={P2.tick2Read} readBody={ag ? <>{ag.consumerRights ? `Your consumer information (${ag.consumerRights.version})\n\n${ag.consumerRights.body}` : ""}{ag.paymentTerms ? `\n\nPayment terms\n\n${typeof ag.paymentTerms === "string" ? ag.paymentTerms : JSON.stringify(ag.paymentTerms, null, 1)}` : ""}</> : "Loading…"} />
      {blocked.length > 0 && <p role="alert" className="mt-3 rounded-[12px] bg-estimate-blush p-3 text-sm font-semibold">{blocked.join(" ")}</p>}
      <section className="mt-[18px] rounded-[14px] border border-estimate-line bg-card px-4 py-3.5">
        <p className="text-[15px] font-bold">{P2.signTitle}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-estimate-sub">{P2.signSub}</p>
        <TypedField label={P2.fullName} value={f.name} onChange={(name) => setF({ ...f, name })} autoComplete="name" />
        <AuthorityChoice value={f.authority} onChange={(authority) => setF({ ...f, authority })} />
        <TickCard on={over18} set={setOver18} title={P2.tick3} />
        <TypedField label={P2.typeAgain} value={f.sig} onChange={(sig) => setF({ ...f, sig })} placeholder={P2.typeHere} italic />
      </section>
      {needCode && !session && <div className="mt-4"><OwnerCodeGate token={token} onVerified={(s) => { setSession(s); setNeedCode(false); }} /></div>}
      {err && <p role="alert" className="mt-3 text-sm font-semibold text-destructive">{err}</p>}
      <LockedButton ready={ready} busy={busy} busyLabel={P2.signing} onClick={() => void sign()}>{P2.button(feeCents)}</LockedButton>
      {!ready && <LockHint>{P2.lockHint}</LockHint>}
      <SmallNote>{P2.payNote(fee)}</SmallNote>
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
  const changeDay = useServerFn(ownerChangeInstallDayFn);
  const [changing, setChanging] = useState(false);
  const { data, refetch } = useQuery({ queryKey: ["owner-booking", token], queryFn: () => load({ data: { token } }) });
  const [session, setSession] = useSession();
  const [picks, setPicks] = useState<{ date: string; slot: (typeof SLOTS)[number][0] }[]>([]);
  const [understands, setUnderstands] = useState(false);
  const [days, setDays] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  if (!data) return null;
  const installMove = data.install.turn === "owner_to_answer";
  const any = data.piesa.canPick || installMove || changing;
  const tile = (on: boolean) => `min-h-12 rounded-2xl border px-2 text-sm font-bold ${on ? "border-estimate-green bg-estimate-mint" : "border-estimate-line bg-card"}`;
  const go = async (f: () => Promise<unknown>) => { setErr(""); setBusy(true); try { await f(); setPicks([]); setDays([]); setSuggesting(false); await refetch(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  return <>
    {!any && data.install.turn !== "booked" && <section className="rounded-[22px] bg-card p-5 text-sm shadow-sm">{data.piesa.windows.length ? <><p className="font-bold">Your Pre Insulation Electrical Safety Assessment (PIESA) times are with our electricians.</p><ul className="mt-2 space-y-1">{data.piesa.windows.map((w: any) => <li key={w.starts_at}>{visitPill(w.starts_at)}</li>)}</ul></> : data.install.turn === "installer_to_answer" ? <><p className="font-bold">Your days are with your installer.</p><p className="mt-1">They'll take one, or offer you new days.</p></> : data.install.turn === "installer_to_offer" ? <p className="font-bold">Your installer will offer you 3 install days shortly.</p> : <p className="font-bold">Nothing to pick right now. We'll let you know.</p>}</section>}
    {any && !session && <OwnerCodeGate token={token} onVerified={setSession} />}
    {any && session && data.piesa.canPick && <section className="rounded-[22px] bg-card p-5 shadow-sm">
      <h3 className="font-display text-lg font-extrabold">Pre Insulation Electrical Safety Assessment (PIESA) times</h3>
      <p className="mt-1 text-sm">Pick 3 to 5 times across at least 3 days.</p>
      {data.piesa.thirtyDayAck?.needed && <label className="mt-3 flex items-start gap-3 rounded-2xl border border-estimate-line p-3 text-sm">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={understands} onChange={(e) => setUnderstands(e.target.checked)} />
        <span>{data.piesa.thirtyDayAck.wording}</span>
      </label>}
      <div className="mt-3 space-y-3">{nextDays(8).map((d) => <div key={d}><p className="text-xs font-bold">{day(d + "T02:00:00Z")}</p><div className="mt-1 grid grid-cols-2 gap-2">{SLOTS.map(([k, l]) => { const on = picks.some((p) => p.date === d && p.slot === k); return <button key={k} className={tile(on)} onClick={() => setPicks(on ? picks.filter((p) => !(p.date === d && p.slot === k)) : picks.length < 5 ? [...picks, { date: d, slot: k }] : picks)}>{l}</button>; })}</div></div>)}</div>
      <button className={`${signBtn} mt-4`} disabled={busy || picks.length < 3 || (!!data.piesa.thirtyDayAck?.needed && !understands)} onClick={() => go(() => choosePiesa({ data: { token, session, picks, understandsThirtyDays: understands } }))}>Send my {picks.length} times</button>
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
      {!changing ? <button className="mt-3 min-h-12 w-full rounded-2xl border border-estimate-line px-3 text-sm font-bold" onClick={() => setChanging(true)}>Change day</button> : session ? <>
        <p className="mt-3">This cancels the booked day. Your installer will then offer you 3 new days{data.install.deadline ? `, on or before ${day(data.install.deadline + "T02:00:00Z")}` : ""}.</p>
        <button className={`${signBtn} mt-3`} disabled={busy} onClick={() => go(async () => { await changeDay({ data: { token, session } }); setChanging(false); })}>Yes, change the day</button>
        <button className="mt-2 min-h-12 w-full text-sm font-bold" disabled={busy} onClick={() => setChanging(false)}>Keep it</button>
      </> : null}
    </section>}
    {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
  </>;
}

/** Approved P3 (decision 128): the ESC Owner's Consent Form verbatim — Section 1 prefilled, the four Section 2 ticks,
 *  typed-name signature. Same server function and 24-hour/template guards; the 6-digit code is asked for on the button. */
function ConsentCard({ v, token }: { v: View; token: string }) {
  const c = v.consent as { scheduledStart: string | null; section1?: Record<string, string> | null };
  const sign = useServerFn(ownerSignConsentFn);
  const qc = useQueryClient();
  const [session, setSession] = useSession();
  const [needCode, setNeedCode] = useState(false);
  const [f, setF] = useState({ name: "", authority: "owner" as "owner" | "authorised_representative" });
  const [ticks, setTicks] = useState<Partial<Record<OwnerDeclarationKey, boolean>>>({});
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const all = OWNER_DECLARATIONS.every((d) => ticks[d.key] === true);
  const ready = all && f.name.trim().length >= 2;
  const q = v.quote as { total: number; split?: { deposit: number } | null } | null;
  const deposit = v.payment?.provisional?.deposit ?? (q ? paymentPlan({ quoteTotalCents: Math.round(q.total * 100), safetyCheckCents: q.split ? Math.round(q.split.deposit * 100) : null }).installDepositCents / 100 : null);
  const s1 = c.section1 ?? null;
  const doSign = async () => {
    if (!session) { setNeedCode(true); return; }
    setErr(""); setBusy(true);
    try {
      await sign({ data: { token, session, signatoryName: f.name, authorityType: f.authority, signatureName: f.name, accept: all, declarations: { owner_or_authorised: !!ticks.owner_or_authorised, details_accurate: !!ticks.details_accurate, consent_ap_sends: !!ticks.consent_ap_sends, consent_commission_shares: !!ticks.consent_commission_shares } } });
      await qc.invalidateQueries({ queryKey: ["my-job", token] });
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return <section data-testid="owner-consent" className="space-y-4">
    <PageIntro kicker={P3.kicker} title={c.scheduledStart ? P3.title(c.scheduledStart) : "Sign your install consent"}>{P3.sub(deposit != null && deposit > 0 ? centsAud(deposit) : null)}</PageIntro>
    <InfoBox><b>{P3.whyLead}</b>{P3.why}</InfoBox>
    <FormCard eyebrow={P3.formEyebrow}>
      <SectionTitle className="mt-1.5 mb-1">{P3.section1}</SectionTitle>
      {s1 && <FactRows rows={P3.rows.map(([k, label]) => ({ label, value: s1[k] || "—" }))} />}
      <p className="mt-2 text-xs text-estimate-sub">{P3.wrong} <a className="font-bold text-estimate-blue" href={`mailto:${OFFICE_EMAIL}?subject=${encodeURIComponent(`Correct my details${v.jobNumber ? ` – ${v.jobNumber}` : ""}`)}`}>{P3.correct}</a></p>
      <SectionTitle className="mt-[18px]">{P3.section2}</SectionTitle>
      <p className="text-[13px] text-estimate-sub">{P3.declare}</p>
      {OWNER_DECLARATIONS.map((d) => <TickCard key={d.key} on={ticks[d.key] === true} set={(b) => setTicks({ ...ticks, [d.key]: b })} title={sentence(d.text)} bold={false} />)}
      <AuthorityChoice value={f.authority} onChange={(authority) => setF({ ...f, authority })} />
      <TypedField label={P3.signLabel} value={f.name} onChange={(name) => setF({ ...f, name })} placeholder={P3.typeHere} autoComplete="name" />
      <p className="mt-1.5 text-xs leading-relaxed text-estimate-sub">{P3.dateLine(longDate(new Date().toISOString()))}</p>
    </FormCard>
    {needCode && !session && <OwnerCodeGate token={token} onVerified={(s) => { setSession(s); setNeedCode(false); }} />}
    {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
    <div>
      <LockedButton ready={ready} busy={busy} busyLabel={P3.signing} onClick={() => void doSign()}>{P3.button}</LockedButton>
      {!ready && <LockHint>{P3.lockHint}</LockHint>}
      <SmallNote>{P3.afterNote}</SmallNote>
      <OwnerFooter />
    </div>
  </section>;
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
    <Hero v={v} level={HOUSE_LEVEL.save_my_spot} size="sm" headline={ownerHeadline("spot_saved", v.numbers.rebate)} />
    <section className="rounded-[22px] bg-card p-5 shadow-sm">
      <h2 className="font-display text-xl font-extrabold">Save my spot</h2>
      <p className="mt-1 text-sm">Pick at least 3 times that suit you for your free Ready Check. Each time is a 2-hour window: {TWO_HOUR_WINDOWS.join(", ")}.</p>
      <a href={`/estimate/${token}`} className="mt-4 flex h-12 items-center justify-center rounded-full bg-estimate-green font-bold text-estimate-canvas">Pick my times</a>
    </section>
  </>;
}

/** Approved P2 quote + acceptance page (decision 127): quote as the email, then "Say yes". Facts and guards unchanged. */
function QuoteScreen({ v, token }: { v: View; token: string }) {
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
          <p className="mt-3 border-t border-estimate-line pt-3 text-[13px] leading-relaxed text-estimate-sub">{v.address && <>{v.address}<br /></>}{P2.measured}</p>
        </div>
      </section>
      <section className="rounded-[14px] border border-estimate-line bg-card px-4 pt-3.5 pb-1.5">
        <h2 className="mb-1 text-[15px] font-bold">{P2.itemsTitle}</h2>
        <ul data-testid="quote-lines">
          <li className="flex items-start justify-between gap-2.5 py-2.5"><span className="text-sm font-bold">Ready Check</span><span className="shrink-0 text-sm font-bold text-estimate-green">FREE</span></li>
          {q.lines.map((l: { description: string; amount: number }, i: number) => <li key={i} className="flex items-start justify-between gap-2.5 border-t border-estimate-line py-2.5"><span className="min-w-0 break-words text-sm font-bold">{l.description}</span><span className="shrink-0 text-sm tabular-nums">{centsAud(l.amount)}</span></li>)}
          {q.rebate > 0 && full != null && <li className="flex items-start justify-between gap-2.5 border-t border-estimate-line py-2.5"><span><span className="block text-sm font-bold">{P2.fullPrice}</span><span className="block text-xs text-estimate-sub">{P2.fullPriceSub}</span></span><span className="shrink-0 text-sm font-bold tabular-nums">{centsAud(full)}</span></li>}
          {q.rebate > 0 && <li className="flex items-start justify-between gap-2.5 border-t border-estimate-line py-2.5"><span><span className="block text-sm font-bold">{P2.rebateLine}</span><span className="block text-xs text-estimate-sub">{P2.rebateLineSub}</span></span><span className="shrink-0 text-sm font-bold tabular-nums text-estimate-green">−{centsAud(q.rebate)}</span></li>}
          <li className="flex items-center justify-between gap-2.5 border-t-2 border-estimate-navy py-3"><span className="text-base font-bold">{P2.youPay}</span><span className="font-display text-lg font-extrabold text-estimate-blue">{centsAud(q.total)}</span></li>
        </ul>
        <p className="border-t border-estimate-line py-2 text-[13px] leading-relaxed text-estimate-sub">{P2.notIncluded}</p>
      </section>
      <FixesNote />
      <details className="rounded-[14px] border border-estimate-line bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-bold">How you can pay</summary>
        <ul className="mt-2 space-y-1 text-sm" data-testid="how-you-pay">
          {howYouPayLines(paymentPlan({ quoteTotalCents: Math.round(q.total * 100), safetyCheckCents: q.split ? Math.round(q.split.deposit * 100) : null })).map((l) => <li key={l}>{l}</li>)}
        </ul>
        <p className="mt-2 text-xs text-estimate-sub">{q.split ? paymentOptionSummary(q.split.deposit) : PAYMENT_OPTION_SUMMARY}</p>
      </details>
      {q.status === "issued"
        ? <div><AcceptQuote token={token} quote={q} rebate={q.rebate} safetyCheck={q.split?.deposit ?? null} /><DeclineQuote token={token} quoteId={q.id} /></div>
        : q.status === "declined"
          ? <p data-quote-declined className="rounded-[14px] bg-estimate-mist px-4 py-3 text-sm">{OWNER_DECLINED_SCREEN}</p>
          : <p className="rounded-[14px] bg-estimate-mint px-4 py-3 text-center text-sm font-bold text-estimate-green">You said yes. Thanks!</p>}
      {q.status === "accepted" && <PayNowCard v={v} token={token} />}
      <OwnerFooter />
    </>}
  </>;
}

/** Decisions 139/140/141: what is due now and how to pay it. Card ("Pay now", Xero online invoice) only for the $349
 *  safety check and electrical fixes; the install deposit and balance are bank transfer / PayID only. Never a card fee. */
function PayNowCard({ v, token }: { v: View; token: string }) {
  const p = v.payment as { dueNow: number; remaining: number; paid: number; payNow: { title: string; amount: number; card: boolean; lines: string[] }; provisional: { expiresAt: string | null; deposit: number } | null } | null;
  const checkout = useServerFn(ownerCardCheckoutFn);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  if (!p || (p.dueNow <= 0 && !p.provisional)) return null;
  return <section data-testid="pay-now" className="rounded-[22px] border-2 border-estimate-green bg-card p-5">
    <p className="text-xs font-bold uppercase tracking-wide text-estimate-green">Payment</p>
    <h3 className="mt-1 font-display text-lg font-extrabold">{p.payNow.title}</h3>
    {p.provisional && <p className="mt-1 text-sm font-semibold">Your install day is held for 48 hours{p.provisional.expiresAt ? ` (until ${visitPill(p.provisional.expiresAt)})` : ""} while your {aud(p.provisional.deposit)} deposit arrives.</p>}
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

/** Jo insists this is clear and boxed (7 Oct 2026). */
function FixesNote() {
  return <section role="note" data-piesa-fixes-note className="rounded-[22px] border-2 border-estimate-navy/40 bg-card p-5 text-sm"><p className="font-bold">About electrical fixes</p><p className="mt-1">{PIESA_FIXES_NOTE}</p></section>;
}

function BookScreen({ v, token }: { v: View; token: string }) {
  const today = melbourneToday();
  return <>
    <Back token={token} />
    <Hero v={v} level={HOUSE_LEVEL.book_visits} size="sm" headline={ownerHeadline("booking_visits", v.numbers.rebate)} />
    <section className="rounded-[22px] bg-card p-5 shadow-sm">
      <h2 className="font-display text-xl font-extrabold">Book your Pre Insulation Electrical Safety Assessment (PIESA) and install</h2>
      <p className="mt-1 text-sm">First the electrician does a quick Pre Insulation Electrical Safety Assessment (PIESA). Your install can be from {v.piesaInstallGapDays} days after that, and must be within 30 days.</p>
      <p className="mt-2 text-sm">For example, a Pre Insulation Electrical Safety Assessment (PIESA) on {day(today)} means an install between {day(earliestInstall(today, v.piesaInstallGapDays))} and {day(installDeadline(today))}.</p>
      <p className="mt-2 text-sm">Pick 2-hour windows that suit you: {TWO_HOUR_WINDOWS.join(", ")}.</p>
    </section>
    <ThirtyDayClock />
    <FixesNote />
    <BookPickers token={token} />
    <PayNowCard v={v} token={token} />
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

/** Decision 330: "Your electrical fixes — please confirm" (P6 pattern, no code): one tick "The electrical fixes were completed on
 *  <date>" + typed full name. Nothing when no fixes are recorded; "Confirmed on <date>" afterwards. Never holds the booking. */
function FixesConfirmCard({ token }: { token: string }) {
  const load = useServerFn(ownerFixesConfirmFn);
  const sign = useServerFn(ownerSignFixesConfirmFn);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["owner-fixes-confirm", token], queryFn: () => load({ data: { token } }) });
  const [f, setF] = useState({ name: "", authority: "owner" as "owner" | "authorised_representative" });
  const [tick, setTick] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  if (!data) return null;
  if (data.confirmed) return <section data-testid="fixes-confirmed" className="flex items-start gap-3 rounded-[22px] bg-estimate-mint p-5">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-estimate-green text-estimate-canvas"><Check className="h-5 w-5" /></span>
    <div><p className="font-display text-lg font-extrabold">{P6F.confirmedTitle}</p><p className="text-sm">{P6F.confirmedOn(data.confirmed.signedOn, data.confirmed.name)}</p></div>
  </section>;
  const ready = tick && f.name.trim().length >= 2;
  const doSign = async () => {
    setErr(""); setBusy(true);
    try { await sign({ data: { token, signatoryName: f.name, authorityType: f.authority, signatureName: f.name, confirmed: tick } }); await qc.invalidateQueries({ queryKey: ["owner-fixes-confirm", token] }); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return <section data-testid="fixes-confirm" className="space-y-4">
    <PageIntro kicker={P6F.kicker} title={P6F.title}>{P6F.sub(data.electricianLine, data.fixesDate)}</PageIntro>
    <FormCard eyebrow={P6F.formEyebrow}>
      <TickCard on={tick} set={setTick} title={data.tick} sub={P6F.declare} read="Read the declaration ›" readBody={`• ${data.declaration}`} />
      <AuthorityChoice value={f.authority} onChange={(authority) => setF({ ...f, authority })} />
      <TypedField label={P6F.signLabel} value={f.name} onChange={(name) => setF({ ...f, name })} placeholder={P6.typeHere} autoComplete="name" />
      <p className="mt-1.5 text-xs leading-relaxed text-estimate-sub">{P6F.dateLine(longDate(new Date().toISOString()))}</p>
    </FormCard>
    {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
    <div>
      <LockedButton ready={ready} busy={busy} busyLabel={P6F.signing} onClick={() => void doSign()}>{P6F.button}</LockedButton>
      {!ready && <LockHint>{P6F.lockHint}</LockHint>}
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
      <p className="mt-1 text-xs text-estimate-sub"><button type="button" className="font-bold text-estimate-blue" aria-expanded={showAll} onClick={() => setShowAll((s) => !s)}>{showAll ? "Hide the installer and Home Insulation Victoria declarations" : "Show the installer and Home Insulation Victoria declarations"}</button> · Official form {data.version}</p>
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
  const sp = v.spotSaved as { rebate: number; cost: number | null; shortAddress: string | null; videoInvite: boolean; optOutUrl: string };
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
        <p className="mt-2 text-sm text-estimate-navy/80">{sp.shortAddress ? `${sp.shortAddress} · ` : ""}Step 1 of 6</p>
      </div>
    </section>
    <OwnerReadyCheckTimes token={token} />
    <p className="rounded-[18px] bg-estimate-heads-up p-4 text-sm"><strong>The waiting list is huge.</strong> We book in order and we're teaming up with more installers and electricians across Victoria to speed it up. We'll text you when it's your turn.</p>
    {card === "todo" && <section data-testid="gate-a-todo" className="rounded-[22px] border-2 border-estimate-green bg-card p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-estimate-green">While you wait · 2 minutes</p>
      <h2 className="mt-1 font-display text-xl font-extrabold">Get your paperwork out of the way</h2>
      <p className="mt-1 text-sm">A few quick questions and your OK to share your details with the trades. Do it now and you can book the moment it's your turn.</p>
      {!open ? <button type="button" onClick={() => setOpen(true)} className="mt-4 flex h-12 w-full items-center justify-center rounded-full bg-estimate-green font-bold text-estimate-canvas">Do it now</button> : <div className="mt-4"><OwnerPaperwork token={token} /></div>}
    </section>}
    {card === "done" && <section data-testid="gate-a-done" className="flex items-start gap-3 rounded-[22px] bg-estimate-mint p-5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-estimate-green text-estimate-canvas"><Check className="h-5 w-5" /></span>
      <div><p className="font-display text-lg font-extrabold">Paperwork done. You're ready to go.</p><p className="text-sm">Nothing else to do until we text you.</p></div>
    </section>}
    {sp.videoInvite && <section className="rounded-[22px] bg-estimate-mint p-5">
      <h2 className="font-display text-lg font-extrabold">Jump the queue: send a quick video</h2>
      <Link to="/estimate/$token/video" params={{ token }} className="mt-3 flex h-12 w-full items-center justify-center rounded-full bg-estimate-green font-bold text-estimate-canvas">Send a quick video</Link>
    </section>}
    <section className="rounded-[22px] bg-card p-5 shadow-sm">
      <p className="font-display text-lg font-extrabold">Your progress</p>
      <ol className="mt-3 space-y-3">{SPOT_SAVED_PROGRESS.map((p, i) => (
        <li key={p.label} className="flex items-start gap-3 text-sm">
          {i === 0 ? <Check className="mt-0.5 h-4 w-4 text-estimate-green" /> : <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${i === 1 ? "bg-estimate-blue" : "bg-estimate-line"}`} />}
          <span><span className={`block font-semibold ${i === 0 ? "text-estimate-green" : i === 1 ? "text-estimate-blue" : ""}`}>{p.label}</span><span className="text-estimate-navy/70">{p.sub}</span></span>
        </li>))}</ol>
    </section>
    <section className="rounded-[22px] bg-card p-5 shadow-sm">
      <p className="font-display text-lg font-extrabold">Your numbers</p>
      <div className="mt-3 flex justify-between text-sm"><span>Your rebate</span><span className="font-bold text-estimate-logo-green">{aud(sp.rebate)}</span></div>
      <div className="mt-2 flex justify-between text-sm"><span>You pay about</span><span className="font-bold">{sp.cost == null ? "—" : aud(sp.cost)}</span></div>
      <p className="mt-3 text-xs text-estimate-navy/70">Estimate only. Your exact price comes after the free Ready Check.</p>
    </section>
    <p className="pt-2 text-center"><a href={optOut} className="text-xs text-estimate-navy/70 underline">Remove my enquiry</a></p>
    {v.canCancel && <CancelMyJob token={token} />}
  </>;
}
