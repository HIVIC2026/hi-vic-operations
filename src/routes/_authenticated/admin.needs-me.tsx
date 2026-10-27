// O1 Needs me (approved mock-up; decisions 220, 221, 240, 243, 245, 247): the office home. Three groups — Today /
// This week / Watch — partner & system items folded into one line, Include TEST jobs. No numbers strip, no "Later",
// no dispatch switch, no "Send to all". Jo 26 Oct (design review): inside each group the rows sit in cards by kind
// (needs-cards.core), one open at a time; a job row is one tap to the job; the headline names the spots waiting for an
// installer apart from what needs the office today.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { getMittiPickups, getMittiSyncProblems } from "@/lib/mitti-pickup.functions";
import { getNeedsMePage, getOfficeJobPage } from "@/lib/office-screens.functions";
import { checkedLabel } from "@/lib/office-needs-snapshot.core";
import { markOfficeChanged } from "@/lib/office-list-refresh";
import { BulkMatch, EmailActions } from "@/components/portal/email-match";
import { ageLabel, NEEDS_GROUPS, type JobSection, type NeedsRow, type SystemRow } from "@/lib/office-needs.core";
import { bulkMatchable, needsCards, needsHeadline, systemFoldLabel, unavailableNote, type NeedsCard, type NeedsCardId } from "@/lib/needs-cards.core";
import type { CardKey } from "@/lib/office-stage-cards.core";
import { ContactHistory, JobHeader, MoneyCard, NextPanel, StageWorkspace } from "@/components/portal/office-job";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { btnClass } from "@/components/portal/kit";
import { pickupLabel } from "@/lib/mitti-pickup.core";
import { INSTALLER_WAITING_PATH, foldChooseInstaller } from "@/lib/installer-waiting-columns.core";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/needs-me")({
  head: () => ({ meta: [{ title: "Needs me – Home Insulation Victoria" }, { name: "description", content: "What needs the office today, this week, and what to watch." }, { property: "og:title", content: "Needs me – Home Insulation Victoria" }, { property: "og:description", content: "What needs the office today, this week, and what to watch." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" }] }),
  validateSearch: (s: Record<string, unknown>): { test?: boolean } => (s["test"] === true || s["test"] === "true" ? { test: true } : {}),
  component: NeedsMe,
});

const today = () => new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Melbourne" });
// Kit buttons, taller on a phone (46px, as O1) so a thumb finds them.
const btn = (tone: "primary" | "secondary") => btnClass(tone, "min-h-[46px] whitespace-nowrap md:min-h-[42px]");
/** Cards whose rows have a deadline or a broken send: the count chip is rose, the rest plain. */
const URGENT: NeedsCardId[] = ["offers", "deadlines", "failed"];

/** One row: job · surname · age on the first line, then where and why. A job row is one tap to the job (its one action
 *  named on the right); an email row keeps its two buttons, since nothing changes without that tap (245/247). */
function Row({ row, now, onDone }: { row: NeedsRow; now: number; onDone: () => void }) {
  const email = row.kind === "email_change" || row.kind === "email_unmatched";
  const head = (
    <span className="flex min-w-0 items-baseline gap-2">
      {row.jobNumber ? <span className="shrink-0 text-[13px] font-bold text-ink">{row.jobNumber}</span> : <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-sub">Unmatched email</span>}
      {row.surname ? <span className="min-w-0 truncate font-semibold text-ink">{row.surname}</span> : null}
      {row.isTest ? <span className="rounded bg-warning-soft px-1 text-[10px] font-bold">TEST</span> : null}
      <span className="ml-auto shrink-0 text-xs text-sub">{ageLabel(row.since, now)}</span>
    </span>
  );
  const why = <span className="block min-w-0 break-words text-sm text-ink">{row.suburb ? <span className="text-sub">{row.suburb} · </span> : null}{row.line}</span>;
  if (email) return (
    <li className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0" data-kind={row.kind}>
      {head}{why}
      <EmailActions row={row} onDone={onDone} />
    </li>
  );
  const open = row.jobId && row.button.to === "job";
  return (
    <li className="border-b border-line last:border-b-0" data-kind={row.kind}>
      {open ? (
        <Link to="/admin/jobs/$jobId" params={{ jobId: row.jobId! }} {...(row.button.to === "job" && row.button.section ? { hash: `stage-${row.button.section}` } : {})} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hiv-blue">
          <span className="grid min-w-0 flex-1 gap-0.5">{head}{why}</span>
          <span className={btn("primary")}>{row.button.label}</span>
        </Link>
      ) : <div className="grid gap-0.5 px-4 py-3">{head}{why}</div>}
    </li>
  );
}

type Peek = { jobId: string; section?: JobSection };

/**
 * Desktop side panel (Jo 26 Oct 2026): the job's next step and the stage card a Needs me row points at, using the job
 * page's own pieces (same guards and actions), so the office can act without leaving Needs me. "Open the full job"
 * goes to the job page for anything else.
 */
function JobPeek({ peek, onClose }: { peek: Peek | null; onClose: () => void }) {
  return (
    <Sheet open={!!peek} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="portal-theme w-full overflow-y-auto bg-background text-ink sm:max-w-[760px]">
        {peek && <PeekBody key={`${peek.jobId}:${peek.section ?? ""}`} peek={peek} />}
      </SheetContent>
    </Sheet>
  );
}

function PeekBody({ peek }: { peek: Peek }) {
  const load = useServerFn(getOfficeJobPage);
  const { data, error, refetch } = useQuery({ queryKey: ["office-job-page", peek.jobId], queryFn: () => load({ data: { jobId: peek.jobId } }), staleTime: 15_000 });
  const [k, setK] = useState<CardKey | "money" | "contact" | null>(peek.section ?? null);
  const navigate = useNavigate();
  return (
    <div className="grid gap-4 pt-6">
      <SheetTitle className="sr-only">Job</SheetTitle>
      <SheetDescription className="sr-only">The job's next step and the card this Needs me row is about.</SheetDescription>
      {error ? <div role="alert" className="rounded-[14px] border border-danger/40 bg-danger-soft p-4 text-sm text-danger">This job couldn't load here. <button type="button" className="font-semibold underline" onClick={() => void refetch()}>Try again</button> or <Link to="/admin/jobs/$jobId" params={{ jobId: peek.jobId }} className="font-semibold underline">open the full job</Link>.</div>
        : !data ? <p role="status" className="text-sub">Loading the job…</p> : (
        <>
          <JobHeader h={data.header} more={<Link to="/admin/jobs/$jobId" params={{ jobId: peek.jobId }} {...(peek.section ? { hash: `stage-${peek.section}` } : {})} className={btn("secondary")}>Open the full job</Link>} />
          <NextPanel next={data.next} onGo={(c) => setK(c)} />
          {k === "money" ? <MoneyCard jobId={peek.jobId} />
            : k === "contact" ? <ContactHistory jobId={peek.jobId} rows={data.contacts} waitingFor={data.waitingFor} onLog={() => void navigate({ to: "/admin/jobs/$jobId", params: { jobId: peek.jobId }, hash: "stage-contact" })} />
            : k ? <StageWorkspace jobId={peek.jobId} k={k} page={data} onGo={(c) => setK(c)} /> : null}
        </>
      )}
    </div>
  );
}

/** Desktop (lg+): the open card's rows in O1's columns — job · surname · suburb and why · age · action. */
function DeskRow({ row, now, onDone, onPeek }: { row: NeedsRow; now: number; onDone: () => void; onPeek: (p: Peek) => void }) {
  const email = row.kind === "email_change" || row.kind === "email_unmatched";
  return (
    <li className="grid grid-cols-[80px_minmax(0,130px)_minmax(0,1fr)_44px_auto] items-center gap-x-4 border-b border-line px-4 py-3 last:border-b-0" data-kind={row.kind}>
      {row.jobNumber && row.jobId && !email ? <Link to="/admin/jobs/$jobId" params={{ jobId: row.jobId }} className="text-[13px] font-bold text-ink underline-offset-2 hover:underline">{row.jobNumber}{row.isTest ? <span className="ml-1 rounded bg-warning-soft px-1 text-[10px] font-bold">TEST</span> : null}</Link> : row.jobNumber ? <span className="text-[13px] font-bold text-ink">{row.jobNumber}{row.isTest ? <span className="ml-1 rounded bg-warning-soft px-1 text-[10px] font-bold">TEST</span> : null}</span> : <span className="text-[11px] font-bold uppercase tracking-wide text-sub">Unmatched</span>}
      <span className="truncate font-semibold text-ink">{row.surname}</span>
      <span className="min-w-0 break-words text-sm text-ink">{row.suburb ? <span className="text-sub">{row.suburb} · </span> : null}{row.line}</span>
      <span className="text-right text-xs text-sub">{ageLabel(row.since, now)}</span>
      <span>
        {email ? <EmailActions row={row} onDone={onDone} />
          : row.jobId && row.button.to === "job"
            ? <button type="button" className={btn("primary")} onClick={() => onPeek({ jobId: row.jobId!, ...(row.button.to === "job" && row.button.section ? { section: row.button.section } : {}) })}>{row.button.label}</button>
            : null}
      </span>
    </li>
  );
}

/** A card of one kind: count, name, oldest age; tap to open its rows (one card open at a time). */
function Card({ card, now, open, selected, onToggle, onDone }: { card: NeedsCard; now: number; open: boolean; selected: boolean; onToggle: () => void; onDone: (keys: string[]) => void }) {
  const urgent = URGENT.includes(card.id);
  return (
    <div className={cn("overflow-hidden rounded-[14px] border bg-paper", selected ? "border-line lg:border-hiv-blue lg:ring-1 lg:ring-hiv-blue" : "border-line")} data-card={card.id}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hiv-blue">
        <span className={cn("grid h-7 min-w-8 shrink-0 place-items-center rounded-full px-2 text-sm font-bold", urgent ? "bg-pink text-rose" : "bg-mist text-hiv-blue")}>{card.rows.length}</span>
        <span className="grid min-w-0 flex-1"><span className="font-semibold text-ink">{card.title}</span><span className="text-xs text-sub">oldest {ageLabel(card.oldestSince, now)}</span></span>
        <span aria-hidden className="text-lg text-sub">{open ? <><span className="lg:hidden">▾</span><span className="hidden lg:inline">›</span></> : "›"}</span>
      </button>
      {open && <div className="border-t border-line lg:hidden">
        {card.id === "unmatched" && <BulkMatch rows={bulkMatchable(card.rows)} onDone={onDone} />}
        <ul>{card.rows.map((r) => <Row key={r.key} row={r} now={now} onDone={() => onDone([r.key])} />)}</ul>
      </div>}
    </div>
  );
}

/** Partner & system items as one fold line (decision 221). Mitti rows share the Jobs pile cache. They load with the page
 *  (not on opening) so the line's number is the full count before opening and never changes when it is opened. */
function PartnerSystemFold({ rows, rowsFailed }: { rows: SystemRow[]; rowsFailed: boolean }) {
  const [open, setOpen] = useState(false);
  const pickupsFn = useServerFn(getMittiPickups);
  const syncFn = useServerFn(getMittiSyncProblems);
  const pickups = useQuery({ queryKey: ["mitti-pickups"], queryFn: () => pickupsFn(), staleTime: 60_000, retry: 1 });
  const sync = useQuery({ queryKey: ["mitti-sync-problems"], queryFn: () => syncFn(), staleTime: 60_000, retry: 1 });
  const mitti: SystemRow[] = [
    ...(pickups.data?.rows ?? []).map((p) => ({ key: `pickup:${p.auditId}`, tag: "Mitti", who: p.business?.name ?? "Mitti user not matched", line: `${pickupLabel(p)} · Ready Check started, no portal job`, since: p.modifiedAt, button: "Link form", href: "/admin/jobs/active" })),
    ...(sync.data?.rows ?? []).map((p) => ({ key: `sync:${p.jobId}`, tag: "Mitti", who: `${p.jobNumber} ${p.owner ?? ""}`.trim(), line: `Mitti sync problem · ${p.message}`, since: p.since, button: "Open job", href: `/admin/jobs/${p.jobId}`, jobId: p.jobId })),
  ];
  const all = [...rows, ...mitti];
  const label = systemFoldLabel([{ status: rowsFailed ? "error" : "success", count: rows.length }, { status: pickups.status, count: pickups.data?.rows.length ?? 0 }, { status: sync.status, count: sync.data?.rows.length ?? 0 }]);
  const failed = pickups.isError || sync.isError;
  return (
    <div className="mt-6" data-why="decision 221: partner & system items as one fold line">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-sm font-semibold text-hiv-blue">
        {label} {open ? "▾" : "›"}
      </button>
      {open && (
        <ul className="mt-2 rounded-[14px] border border-line bg-paper px-4">
          {failed && <li role="alert" className="py-3 text-sm text-danger">{pickups.isError && sync.isError ? "Mitti forms and Mitti sync problems" : pickups.isError ? "Mitti forms" : "Mitti sync problems"} couldn't be checked just now — this does not mean nothing is waiting. <button type="button" className="font-semibold underline" onClick={() => { if (pickups.isError) void pickups.refetch(); if (sync.isError) void sync.refetch(); }}>Try again</button></li>}
          {all.length === 0 && !failed && !rowsFailed && <li className="py-3 text-sm text-sub">Nothing from partners or the system.</li>}
          {all.map((r) => (
            <li key={r.key} className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 border-b border-line py-3 last:border-b-0 md:grid-cols-[90px_minmax(0,180px)_minmax(0,1fr)_auto] md:items-center">
              <span className="text-xs font-bold uppercase text-sub">{r.tag}</span>
              <span className="truncate font-semibold">{r.who}</span>
              <span className="min-w-0 break-words text-sm">{r.line}</span>
              <a href={r.href} className={btn("secondary")}>{r.button}</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NeedsMe() {
  const { test } = Route.useSearch();
  const includeTest = !!test;
  const qc = useQueryClient();
  const load = useServerFn(getNeedsMePage);
  // Perf 25 Oct 2026: one retry (not three) for the heaviest office read, a 60 s fresh window so switching back from
  // Outlook doesn't reload it every time, and no polling while the tab is hidden (React Query's default).
  // Decision 382: the server answers from its saved copy at once and refreshes it after the response; while it says
  // `refreshing`, ask again in 5 s to pick up the new copy. After an action, ask it to refresh and hide the done row now.
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [openCard, setOpenCard] = useState<string | null>(null);
  const { data, error, refetch, isPending } = useQuery({
    queryKey: ["needs-me-v2", includeTest], queryFn: () => load({ data: { includeTest } }), staleTime: 60_000, retry: 1,
    refetchInterval: (q) => (q.state.data?.refreshing ? 5_000 : 120_000),
  });
  useEffect(() => { setDone(new Set()); }, [data?.computedAt]);
  const [peek, setPeek] = useState<Peek | null>(null);
  const refresh = (keys: string[] = []) => {
    if (keys.length) setDone((d) => new Set([...d, ...keys]));
    markOfficeChanged(); // decision 383: Jobs › Active and Enquiries work themselves out fresh on their next read
    void load({ data: { includeTest, refresh: true } }).then((fresh) => qc.setQueryData(["needs-me-v2", includeTest], fresh)).catch(() => undefined);
  };
  // Decision 378: "Spot saved · waiting for an installer" rows fold into ONE link to Jobs › Choose installer.
  const groups = data ? NEEDS_GROUPS.map((g) => ({ ...g, ...foldChooseInstaller(data.groups[g.key].filter((r) => !done.has(r.key))) })) : [];
  const todayCount = groups.find((g) => g.key === "today")?.rows.length ?? 0;
  const waiting = groups.reduce((n, g) => n + g.chooseInstaller.length, 0);
  // Desktop's right-hand panel: the picked card, else the most urgent one (first card of the first group that has one).
  const allCards = groups.flatMap((g) => needsCards(g.rows).map((card) => ({ id: `${g.key}:${card.id}`, card })));
  const shown = allCards.find((c) => c.id === openCard) ?? allCards[0] ?? null;
  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1>Needs me</h1>
          <p className="text-sm text-sub">{today()}{data ? ` · ${needsHeadline(todayCount, waiting)}. Checked ${checkedLabel(data.computedAt, data.refreshing)}` : ""}</p>
        </div>
        <Link to="/admin/needs-me" search={includeTest ? {} : { test: true }} className="inline-flex min-h-11 items-center text-sm font-semibold text-hiv-blue underline">{includeTest ? "Hide TEST jobs" : "Include TEST jobs"}</Link>
      </div>
      {error ? (
        <div role="alert" className="rounded-[14px] border border-danger/40 bg-danger-soft p-4 text-sm text-danger">Needs me couldn't load — this does NOT mean nothing needs you. <button type="button" className="font-semibold underline" onClick={() => void refetch()}>Try again</button></div>
      ) : isPending || !data ? <p role="status" className="text-sub">Checking every job…</p> : (
        <>
        {unavailableNote(data.unavailable) && <div role="alert" className="mb-4 rounded-[14px] border border-danger/40 bg-danger-soft p-4 text-sm text-danger">{unavailableNote(data.unavailable)} <button type="button" className="font-semibold underline" onClick={() => refresh()}>Try again</button></div>}
        <div className="lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div>
          {groups.map((g) => {
            const { rows, chooseInstaller } = g;
            const total = rows.length + chooseInstaller.length;
            return (
              <section key={g.key} className="mb-6 grid gap-2" aria-label={g.label} data-why={g.key === "today" ? "due or overdue now: 220 lapsed offer, 159 held quote, 123 consent, 195 ESC window, 213 final check, 245/247 email asks, send failed" : g.key === "week" ? "due within 7 days: 49 choose installer, 157 choose electrician, 119/121 VEEC Part A" : "alerts: 240 payments not in Xero, 2 ten-day clock, 215 second no-access, 120 VEEC day 10, lapsed window"}>
                <h2 className="border-b border-line pb-2 text-xs font-bold uppercase tracking-[1.1px] text-sub">{g.label}</h2>
                {chooseInstaller.length > 0 && (
                  <Link to={INSTALLER_WAITING_PATH} data-why="decision 378: one link, no duplicated rows (one pile per job)" className="flex min-h-14 items-center gap-3 rounded-[14px] border border-line bg-paper px-4 py-2.5 hover:bg-mist">
                    <span className="grid h-7 min-w-8 shrink-0 place-items-center rounded-full bg-mist px-2 text-sm font-bold text-hiv-blue">{chooseInstaller.length}</span>
                    <span className="grid min-w-0 flex-1"><span className="font-semibold text-ink">Choose installers</span><span className="text-xs text-sub">Spots saved, ready for you to choose (released ones not counted) · longest {ageLabel(chooseInstaller.reduce((a, r) => (r.since < a ? r.since : a), chooseInstaller[0]!.since), data.now)}</span></span>
                    <span aria-hidden className="text-lg text-sub">›</span>
                  </Link>
                )}
                {total === 0 ? <p className="rounded-[14px] border border-line bg-paper px-4 py-3 text-sm text-sub">Nothing {g.key === "watch" ? "to watch" : g.key === "week" ? "this week" : "today"}{data.unavailable?.length ? " that loaded — some checks couldn't load (see above)" : ""}.</p> : null}
                {needsCards(rows).map((c) => {
                  const id = `${g.key}:${c.id}`;
                  // Phone: an accordion (tap again to close). Desktop: a list that picks what the right-hand panel shows.
                  const pick = () => setOpenCard(window.matchMedia("(min-width: 1024px)").matches || openCard !== id ? id : null);
                  return <Card key={id} card={c} now={data.now} open={openCard === id} selected={shown?.id === id} onToggle={pick} onDone={refresh} />;
                })}
              </section>
            );
          })}
          <PartnerSystemFold rows={data.system} rowsFailed={!!data.unavailable?.includes("electrician links to installers")} />
        </div>
        <section aria-label={shown ? shown.card.title : "Needs me"} className="hidden lg:sticky lg:top-24 lg:block">
          {shown ? (
            <div className="overflow-hidden rounded-[14px] border border-line bg-paper">
              <h2 className="border-b border-line px-4 py-3 font-display text-lg font-bold text-ink">{shown.card.title} · {shown.card.rows.length}</h2>
              {shown.card.id === "unmatched" && <BulkMatch rows={bulkMatchable(shown.card.rows)} onDone={refresh} />}
              <ul>{shown.card.rows.map((r) => <DeskRow key={r.key} row={r} now={data.now} onDone={() => refresh([r.key])} onPeek={setPeek} />)}</ul>
            </div>
          ) : <p className="rounded-[14px] border border-line bg-paper px-4 py-6 text-sm text-sub">{data.unavailable?.length ? "Nothing else needs you — but some checks couldn't load (see above)." : "Nothing needs you right now."}</p>}
        </section>
        </div>
        </>
      )}
      <JobPeek peek={peek} onClose={() => { setPeek(null); refresh(); }} />
    </AppShell>
  );
}
