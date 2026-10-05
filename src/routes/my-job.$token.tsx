import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronRight, FileText, MessageSquare, Phone, AlertCircle } from "lucide-react";
import { z } from "zod";
import { getOwnerMyJob } from "@/lib/owner-myjob.functions";
import { OwnerHouse } from "@/components/owner/OwnerHouse";
import { CUSTOMER_BRAND } from "@/lib/customer-quote-system";
import { HOUSE_LEVEL } from "@/lib/owner-house.core";
import { ownerHeadline, quoteKicker } from "@/lib/owner-headlines.core";
import { earliestInstall, installDeadline, TWO_HOUR_WINDOWS, visitPill, type OwnerScreen } from "@/lib/owner-myjob.core";
import { PAYMENT_OPTION_SUMMARY } from "@/lib/payment-gate.core";

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
const aud = (v: number | null | undefined) => `$${Math.floor(Math.max(0, Number(v ?? 0))).toLocaleString("en-AU")}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Melbourne" });

function MyJobPage() {
  const { token } = Route.useParams();
  const { screen = "home" } = Route.useSearch();
  const load = useServerFn(getOwnerMyJob);
  const { data, isLoading } = useQuery({ queryKey: ["my-job", token], queryFn: () => load({ data: { token } }) as Promise<View | null>, retry: false, refetchOnWindowFocus: false });
  return (
    <div className="min-h-screen bg-estimate-canvas pb-10 text-estimate-navy">
      <header className="mx-auto flex max-w-[480px] items-center justify-between px-5 py-4">
        <img src={CUSTOMER_BRAND.logoUrl} alt={CUSTOMER_BRAND.name} className="h-10 w-auto max-w-[130px] object-contain" />
        {data?.jobNumber && <span className="rounded-full bg-estimate-blush px-3 py-1 text-xs font-bold">{data.jobNumber}</span>}
      </header>
      <main className="mx-auto max-w-[480px] space-y-4 px-4">
        {isLoading ? <div className="h-48 animate-pulse rounded-[26px] bg-estimate-mist" />
          : !data ? <Unavailable />
          : screen === "quote" ? <QuoteScreen v={data} token={token} />
          : screen === "book" ? <BookScreen v={data} token={token} />
          : screen === "done" || data.stage === "complete" ? <DoneScreen v={data} token={token} />
          : screen === "spot" ? <SpotScreen v={data} token={token} />
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
    <section className="rounded-[26px] bg-estimate-mist p-5">
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
    <Numbers v={v} />
    <BottomList />
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

function BottomList() {
  const row = (Icon: typeof FileText, label: string) => <li className="flex h-12 items-center justify-between px-4 text-sm font-semibold"><span className="flex items-center gap-2"><Icon className="h-4 w-4" />{label}</span><ChevronRight className="h-4 w-4" /></li>;
  return <ul className="divide-y divide-estimate-line overflow-hidden rounded-[22px] bg-card shadow-sm">{row(FileText, "Documents")}{row(MessageSquare, "Got a question? Message us")}{row(AlertCircle, "Something wrong? Tell us")}</ul>;
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
  return <>
    <Back token={token} />
    <Hero v={v} level={HOUSE_LEVEL.quote} size="sm" headline={quoteKicker(q?.rebate ?? v.numbers.rebate)} />
    {!q ? <section className="rounded-[22px] bg-card p-5 shadow-sm"><p className="font-bold">Your exact price is being worked out.</p><p className="mt-1 text-sm">We'll let you know as soon as it's ready.</p></section> : <>
      <section className="rounded-[22px] bg-card p-5 shadow-sm">
        <h2 className="font-display text-xl font-extrabold">Your price</h2>
        <ul className="mt-3 divide-y divide-estimate-line text-sm">
          <li className="flex justify-between py-2"><span>Home Insulation Ready Check</span><span className="font-bold text-estimate-green">FREE</span></li>
          {q.lines.map((l: any, i: number) => <li key={i} className="flex justify-between gap-3 py-2"><span>{l.description}</span><span className="font-semibold">{aud(l.amount)}</span></li>)}
          {q.rebate > 0 && <li className="flex justify-between py-2 text-estimate-green"><span>Government rebate (VEU)</span><span className="font-bold">−{aud(q.rebate)}</span></li>}
          <li className="flex justify-between py-3 font-display text-lg font-extrabold"><span>You pay (inc GST)</span><span>{aud(q.total)}</span></li>
        </ul>
      </section>
      <section className="rounded-[22px] bg-estimate-mint p-5"><p className="font-display text-lg font-extrabold">You don't lift a finger</p><p className="mt-1 text-sm">We book the safety check, the install and do all the rebate paperwork for you.</p></section>
      <section className="rounded-[22px] bg-card p-5 shadow-sm">
        <h3 className="font-display text-lg font-extrabold">How you can pay</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {q.split && <li>Deposit of {aud(q.split.deposit)} now, the rest on install day</li>}
          <li>Pay it all now</li>
          <li>3 instalments</li>
        </ul>
        <p className="mt-2 text-xs text-estimate-navy/70">{PAYMENT_OPTION_SUMMARY}</p>
        {q.status === "issued"
          ? <a href="/auth" className="mt-4 flex h-12 items-center justify-center rounded-full bg-estimate-green font-bold text-estimate-canvas">Say yes and sign</a>
          : <p className="mt-4 rounded-full bg-estimate-mint px-4 py-3 text-center text-sm font-bold text-estimate-green">You said yes. Thanks!</p>}
      </section>
    </>}
  </>;
}

function BookScreen({ v, token }: { v: View; token: string }) {
  const today = new Date().toISOString().slice(0, 10);
  return <>
    <Back token={token} />
    <Hero v={v} level={HOUSE_LEVEL.book_visits} size="sm" headline={ownerHeadline("booking_visits", v.numbers.rebate)} />
    <section className="rounded-[22px] bg-card p-5 shadow-sm">
      <h2 className="font-display text-xl font-extrabold">Book your safety check and install</h2>
      <p className="mt-1 text-sm">First the electrician does a quick safety check. Your install can be from {v.piesaInstallGapDays} days after that, and must be within 30 days.</p>
      <p className="mt-2 text-sm">For example, a safety check on {day(today)} means an install between {day(earliestInstall(today, v.piesaInstallGapDays))} and {day(installDeadline(today))}.</p>
      <p className="mt-2 text-sm">Pick 2-hour windows that suit you: {TWO_HOUR_WINDOWS.join(", ")}.</p>
      <a href="/auth" className="mt-4 flex h-12 items-center justify-center rounded-full bg-estimate-green font-bold text-estimate-canvas">Pick my times</a>
    </section>
  </>;
}

function DoneScreen({ v, token }: { v: View; token: string }) {
  return <>
    {v.stage !== "complete" && <Back token={token} />}
    <Hero v={v} level={HOUSE_LEVEL.all_done} headline={ownerHeadline("all_done", v.numbers.rebate)} />
    <Numbers v={v} />
    <BottomList />
  </>;
}
