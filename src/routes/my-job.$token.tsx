import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronRight, FileText, MessageSquare, Phone, AlertCircle } from "lucide-react";
import { z } from "zod";
import { cancelMyJob, getOwnerMyJob } from "@/lib/owner-myjob.functions";
import { OwnerHouse } from "@/components/owner/OwnerHouse";
import { PIESA_FIXES_NOTE, agreedWithLabel, ownerPriceTitle } from "@/lib/owner-confirm.core";
import { CUSTOMER_BRAND } from "@/lib/customer-quote-system";
import { HOUSE_LEVEL } from "@/lib/owner-house.core";
import { ownerHeadline } from "@/lib/owner-headlines.core";
import { gateACard, SPOT_SAVED_PROGRESS } from "@/lib/owner-myjob.core";
import { ownerPaperworkFn } from "@/lib/owner-gates.functions";
import { earliestInstall, installDeadline, TWO_HOUR_WINDOWS, visitPill, type OwnerScreen } from "@/lib/owner-myjob.core";
import { PAYMENT_OPTION_SUMMARY } from "@/lib/payment-gate.core";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { OwnerPaperwork } from "@/components/owner/OwnerPaperwork";
import { OwnerCodeGate, SignerFields, Tick, signBtn } from "@/components/owner/OwnerSign";
import { ownerAcceptQuoteFn, ownerAgreementFn, ownerBookingStateFn, ownerChoosePiesaFn, ownerDeclineQuoteFn, ownerChangeInstallDayFn, ownerSignConsentFn, ownerSuggestInstallDaysFn, ownerTakeInstallDayFn } from "@/lib/owner-link.functions";
import { DECLINE_REASONS, OWNER_DECLINED_SCREEN, type DeclineReason } from "@/lib/quote-decline.core";
import { melbourneToday, addYmd } from "@/lib/melbourne-time.core";
import { formatInstallDay } from "@/lib/install-days.core";

// Owner "My job" — no login. The secure link token is the only credential; nothing fetched during SSR.
export const Route = createFileRoute("/my-job/$token")({
  ssr: false,
  validateSearch: (s) => z.object({ screen: z.enum(["home", "spot", "quote", "book", "done"]).optional() }).parse(s),
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
      <header className="mx-auto flex max-w-[480px] items-center justify-between px-5 py-4">
        <img src={CUSTOMER_BRAND.logoUrl} alt={CUSTOMER_BRAND.name} className="h-10 w-auto max-w-[130px] object-contain" />
        {data?.jobNumber && <span className="rounded-full bg-estimate-blush px-3 py-1 text-xs font-bold">{data.spotSaved ? `Job ${data.jobNumber}` : data.jobNumber}</span>}
      </header>
      <main className="mx-auto max-w-[480px] space-y-4 px-4">
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
    <Hero v={v} level={v.hero.level} headline={v.hero.headline} />
    <StatusSnapshot v={v} />
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
    <OwnerPaperwork token={token} />
    {v.consent && <ConsentCard token={token} startsAt={v.consent.scheduledStart} />}
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

function AcceptQuote({ token, quote }: { token: string; quote: { id: string; version: number } }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useSession();
  const load = useServerFn(ownerAgreementFn);
  const accept = useServerFn(ownerAcceptQuoteFn);
  const qc = useQueryClient();
  const { data: ag } = useQuery({ queryKey: ["owner-agreement", quote.id], queryFn: () => load({ data: { token, quoteId: quote.id } }), enabled: open });
  const [f, setF] = useState({ name: "", authority: "owner" as "owner" | "authorised_representative", sig: "" });
  const [over18, setOver18] = useState(false); const [read, setRead] = useState(false); const [agree, setAgree] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  if (!open) return <button className={`${signBtn} mt-4`} onClick={() => setOpen(true)}>Say yes and sign</button>;
  if (!session) return <div className="mt-4"><OwnerCodeGate token={token} onVerified={setSession} /></div>;
  const blocked = (ag?.blockers ?? []) as string[];
  return (
    <div className="mt-4 space-y-3">
      {ag?.consumerRights && <details className="rounded-2xl bg-estimate-mist p-3 text-sm"><summary className="cursor-pointer font-bold">Your consumer information ({ag.consumerRights.version})</summary><p className="mt-2 whitespace-pre-wrap">{ag.consumerRights.body}</p></details>}
      {ag?.agreementWording && <details className="rounded-2xl bg-estimate-mist p-3 text-sm"><summary className="cursor-pointer font-bold">The agreement ({ag.agreementWording.version})</summary><p className="mt-2 whitespace-pre-wrap">{ag.agreementWording.body}</p></details>}
      {blocked.length > 0 && <p role="alert" className="rounded-2xl bg-estimate-blush p-3 text-sm font-semibold">{blocked.join(" ")}</p>}
      <SignerFields v={f} set={(p) => setF({ ...f, ...p })} />
      <Tick on={over18} set={setOver18}>I'm 18 or older.</Tick>
      <Tick on={read} set={setRead}>I've read the consumer information.</Tick>
      <Tick on={agree} set={setAgree}>I accept this quote and the agreement.</Tick>
      {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
      <button className={signBtn} disabled={busy || blocked.length > 0 || !over18 || !read || !agree || f.name.trim().length < 2 || f.sig.trim().length < 2} onClick={async () => {
        setErr(""); setBusy(true);
        try { await accept({ data: { token, session, quoteId: quote.id, expectedVersion: quote.version, signing: { signatoryName: f.name, authorityType: f.authority, signatureName: f.sig, over18, readConsumerInfo: read, acceptAgreement: agree, assistance: "none" } } }); await qc.invalidateQueries({ queryKey: ["my-job", token] }); }
        catch (e) { setErr(errText(e)); } finally { setBusy(false); }
      }}>{busy ? "Signing…" : "Sign and say yes"}</button>
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
  if (!open) return <button type="button" data-decline-open className="mt-3 w-full py-2 text-center text-sm font-semibold text-estimate-navy underline" onClick={() => setOpen(true)}>Not for me</button>;
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
      <div className="mt-3 space-y-3">{nextDays(8).map((d) => <div key={d}><p className="text-xs font-bold">{day(d + "T02:00:00Z")}</p><div className="mt-1 grid grid-cols-2 gap-2">{SLOTS.map(([k, l]) => { const on = picks.some((p) => p.date === d && p.slot === k); return <button key={k} className={tile(on)} onClick={() => setPicks(on ? picks.filter((p) => !(p.date === d && p.slot === k)) : picks.length < 5 ? [...picks, { date: d, slot: k }] : picks)}>{l}</button>; })}</div></div>)}</div>
      <button className={`${signBtn} mt-4`} disabled={busy || picks.length < 3} onClick={() => go(() => choosePiesa({ data: { token, session, picks } }))}>Send my {picks.length} times</button>
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

function ConsentCard({ token, startsAt }: { token: string; startsAt: string | null }) {
  const sign = useServerFn(ownerSignConsentFn);
  const qc = useQueryClient();
  const [session, setSession] = useSession();
  const [f, setF] = useState({ name: "", authority: "owner" as "owner" | "authorised_representative", sig: "" });
  const [ok, setOk] = useState(false); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  return <section className="rounded-[22px] bg-estimate-blush p-5">
    <p className="text-xs font-bold uppercase tracking-wide">You need to do this</p>
    <h2 className="mt-1 font-display text-xl font-extrabold">Sign your install consent</h2>
    <p className="mt-1 text-sm">For your install{startsAt ? ` on ${visitPill(startsAt)}` : ""}. It must be signed at least 24 hours before.</p>
    <div className="mt-3">{!session ? <OwnerCodeGate token={token} onVerified={setSession} /> : <div className="space-y-3 rounded-[22px] bg-card p-4">
      <SignerFields v={f} set={(p) => setF({ ...f, ...p })} />
      <Tick on={ok} set={setOk}>I consent to the information sharing for my install.</Tick>
      {err && <p role="alert" className="text-sm font-semibold text-destructive">{err}</p>}
      <button className={signBtn} disabled={busy || !ok || f.name.trim().length < 2 || f.sig.trim().length < 2} onClick={async () => { setErr(""); setBusy(true); try { await sign({ data: { token, session, signatoryName: f.name, authorityType: f.authority, signatureName: f.sig, accept: ok } }); await qc.invalidateQueries({ queryKey: ["my-job", token] }); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } }}>Sign</button>
    </div>}</div>
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

function QuoteScreen({ v, token }: { v: View; token: string }) {
  const q = v.quote;
  const rebate = q?.rebate ?? v.numbers.rebate;
  return <>
    <Back token={token} />
    <section data-testid="owner-quote-heading" className="border-b border-estimate-line pb-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          {v.firstName && <p className="text-sm font-semibold">Hi {v.firstName}</p>}
          <h1 className="mt-2 font-display text-3xl font-extrabold leading-tight">{rebate > 0 ? <>You could save <span className="text-estimate-green">{aud(rebate)}</span> on ceiling insulation</> : "Your ceiling insulation quote"}</h1>
        </div>
        <OwnerHouse level={HOUSE_LEVEL.quote} size="sm" />
      </div>
      {v.address && <p className="mt-3 text-sm text-estimate-navy/80">{v.address}</p>}
      {!q && <div role="status" className="mt-6"><p className="font-semibold">Your exact price is being worked out.</p><p className="mt-1 text-sm">We'll let you know as soon as it's ready.</p></div>}
    </section>
    {q && <>
      <section className="rounded-[22px] bg-card p-5 shadow-sm">
        <h2 className="font-display text-xl font-extrabold">{ownerPriceTitle(v.agreed)}</h2>
        {agreedWithLabel(v.agreed) && <p className="mt-1 text-sm font-semibold" data-agreed-with>{agreedWithLabel(v.agreed)}</p>}
        <ul className="mt-3 divide-y divide-estimate-line text-sm">
          <li className="flex justify-between py-2"><span>Ready Check</span><span className="font-bold text-estimate-green">FREE</span></li>
          {q.lines.map((l: any, i: number) => <li key={i} className="flex justify-between gap-3 py-2"><span className="min-w-0 break-words">{l.description}</span><span className="shrink-0 font-semibold tabular-nums">{aud(l.amount)}</span></li>)}
          {q.rebate > 0 && <li className="flex justify-between py-2 text-estimate-green"><span>Government rebate (VEU)</span><span className="font-bold">−{aud(q.rebate)}</span></li>}
          <li className="flex justify-between py-3 font-display text-lg font-extrabold"><span>You pay (inc GST)</span><span>{aud(q.total)}</span></li>
        </ul>
      </section>
      <FixesNote />
      <section className="rounded-[22px] bg-estimate-mint p-5"><p className="font-display text-lg font-extrabold">You don't lift a finger</p><p className="mt-1 text-sm">We book the Pre Insulation Electrical Safety Assessment (PIESA), the install and do all the rebate paperwork for you.</p></section>
      <section className="rounded-[22px] bg-card p-5 shadow-sm">
        <h3 className="font-display text-lg font-extrabold">How you can pay</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {q.split && <li>{aud(q.split.deposit)} Pre Insulation Electrical Safety Assessment (PIESA) payment first</li>}
          {q.split && <li>Then {aud(q.split.firstHalf)} when your install is booked and {aud(q.split.secondHalf)} on install day</li>}
          <li>Or pay the full {aud(q.total)} now</li>
        </ul>
        <p className="mt-2 text-xs text-estimate-navy/70">{PAYMENT_OPTION_SUMMARY}</p>
        {q.status === "issued"
          ? <><AcceptQuote token={token} quote={q} /><DeclineQuote token={token} quoteId={q.id} /></>
          : q.status === "declined"
            ? <p data-quote-declined className="mt-4 rounded-2xl bg-estimate-mist px-4 py-3 text-sm">{OWNER_DECLINED_SCREEN}</p>
            : <p className="mt-4 rounded-full bg-estimate-mint px-4 py-3 text-center text-sm font-bold text-estimate-green">You said yes. Thanks!</p>}
      </section>
    </>}
  </>;
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
    <FixesNote />
    <BookPickers token={token} />
  </>;
}

function DoneScreen({ v, token }: { v: View; token: string }) {
  return <>
    {v.stage !== "complete" && <Back token={token} />}
    <Hero v={v} level={HOUSE_LEVEL.all_done} headline={ownerHeadline("all_done", v.numbers.rebate)} />
    <Numbers v={v} />
  </>;
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
