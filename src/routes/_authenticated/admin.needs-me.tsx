// O1 Needs me (approved mock-up; decisions 220, 221, 240, 243, 245, 247): the office home. Three groups — Today /
// This week / Watch — partner & system items folded into one line, Include TEST jobs. No numbers strip, no "Later",
// no dispatch switch, no "Send to all". Jo 26 Oct (design review): inside each group the rows sit in cards by kind
// (needs-cards.core), one open at a time; a job row is one tap to the job; the headline names the spots waiting for an
// installer apart from what needs the office today.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/portal/AppShell";
import { OfficeSearch } from "@/components/portal/office";
import { getMittiPickups, getMittiSyncProblems } from "@/lib/mitti-pickup.functions";
import { getNeedsMePage } from "@/lib/office-screens.functions";
import { checkedLabel } from "@/lib/office-needs-snapshot.core";
import { markOfficeChanged } from "@/lib/office-list-refresh";
import { applyEmailChange, ignoreEmailChange, matchOutlookEmail } from "@/lib/email-office.functions";
import { ageLabel, NEEDS_GROUPS, type NeedsRow, type SystemRow } from "@/lib/office-needs.core";
import { needsCards, needsHeadline, type NeedsCard, type NeedsCardId } from "@/lib/needs-cards.core";
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

/** Email rows (decisions 245/247): Apply / Ignore, Match / Not a customer. Nothing changes on a job without this tap. */
function EmailActions({ row, onDone }: { row: NeedsRow; onDone: () => void }) {
  const apply = useServerFn(applyEmailChange);
  const ignore = useServerFn(ignoreEmailChange);
  const match = useServerFn(matchOutlookEmail);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    // Plain words only: a server error's text can be raw JSON (design review 26 Oct); the detail goes to the console.
    try { await fn(); toast.success(ok); onDone(); } catch (e) { console.error("Needs me email action failed", e); toast.error("That didn't save. Try again, or open the job."); } finally { setBusy(false); }
  };
  if (row.kind === "email_change") return (
    <div className="grid grid-cols-2 gap-2 md:flex">
      <button type="button" disabled={busy} className={btn("primary")} onClick={() => void run(async () => {
        await apply({ data: { eventId: row.eventId! } });
        // A day change is never applied to a booking: the office rearranges it on the job's Install card.
        if (row.intent === "reschedule" && row.jobId) void navigate({ to: "/admin/jobs/$jobId", params: { jobId: row.jobId }, hash: "stage-install" });
      }, row.intent === "cancel" ? "Job cancelled" : row.intent === "reschedule" ? "Noted — rearrange the day on the job" : row.intent === "reply" ? "Marked replied" : "Applied")}>{busy ? "Saving…" : row.intent === "reply" ? "Done" : "Apply"}</button>
      <button type="button" disabled={busy} className={btn("secondary")} onClick={() => void run(() => ignore({ data: { eventId: row.eventId! } }), "Ignored")}>Ignore</button>
    </div>
  );
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2 md:flex">
        <button type="button" disabled={busy} className={btn("primary")} onClick={() => row.jobId && !picking ? void run(() => match({ data: { messageEventId: row.eventId!, jobId: row.jobId! } }), `Matched to ${row.jobNumber}`) : setPicking(true)}>{row.jobId ? `Match to ${row.jobNumber}` : "Match"}</button>
        <button type="button" disabled={busy} className={btn("secondary")} onClick={() => void run(() => match({ data: { messageEventId: row.eventId!, jobId: null } }), "Marked not a customer")}>Not a customer</button>
      </div>
      {row.jobId && !picking && <button type="button" className="min-h-11 text-left text-sm font-semibold text-hiv-blue underline" onClick={() => setPicking(true)}>A different job…</button>}
      {picking && <div className="w-full md:w-72"><OfficeSearch onPick={(j) => void run(() => match({ data: { messageEventId: row.eventId!, jobId: j.id } }), `Matched to ${j.jobNumber}`)} /></div>}
    </div>
  );
}

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

/** A card of one kind: count, name, oldest age; tap to open its rows (one card open at a time). */
function Card({ card, now, open, onToggle, onDone }: { card: NeedsCard; now: number; open: boolean; onToggle: () => void; onDone: (key: string) => void }) {
  const urgent = URGENT.includes(card.id);
  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-paper" data-card={card.id}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hiv-blue">
        <span className={cn("grid h-7 min-w-8 shrink-0 place-items-center rounded-full px-2 text-sm font-bold", urgent ? "bg-pink text-rose" : "bg-mist text-hiv-blue")}>{card.rows.length}</span>
        <span className="grid min-w-0 flex-1"><span className="font-semibold text-ink">{card.title}</span><span className="text-xs text-sub">oldest {ageLabel(card.oldestSince, now)}</span></span>
        <span aria-hidden className="text-lg text-sub">{open ? "▾" : "›"}</span>
      </button>
      {open && <ul className="border-t border-line">{card.rows.map((r) => <Row key={r.key} row={r} now={now} onDone={() => onDone(r.key)} />)}</ul>}
    </div>
  );
}

/** Partner & system items as one fold line (decision 221). Mitti rows share the Jobs pile cache. */
function PartnerSystemFold({ rows }: { rows: SystemRow[] }) {
  const [open, setOpen] = useState(false);
  const pickupsFn = useServerFn(getMittiPickups);
  const syncFn = useServerFn(getMittiSyncProblems);
  const pickups = useQuery({ queryKey: ["mitti-pickups"], queryFn: () => pickupsFn(), staleTime: 60_000, retry: 1, enabled: open });
  const sync = useQuery({ queryKey: ["mitti-sync-problems"], queryFn: () => syncFn(), staleTime: 60_000, enabled: open });
  const mitti: SystemRow[] = [
    ...(pickups.data?.rows ?? []).map((p) => ({ key: `pickup:${p.auditId}`, tag: "Mitti", who: p.business?.name ?? "Mitti user not matched", line: `${pickupLabel(p)} · Ready Check started, no portal job`, since: p.modifiedAt, button: "Link form", href: "/admin/jobs/active" })),
    ...(sync.data?.rows ?? []).map((p) => ({ key: `sync:${p.jobId}`, tag: "Mitti", who: `${p.jobNumber} ${p.owner ?? ""}`.trim(), line: `Mitti sync problem · ${p.message}`, since: p.since, button: "Open job", href: `/admin/jobs/${p.jobId}`, jobId: p.jobId })),
  ];
  const all = [...rows, ...mitti];
  return (
    <div className="mt-6" data-why="decision 221: partner & system items as one fold line">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-sm font-semibold text-hiv-blue">
        {rows.length}{open && mitti.length ? ` + ${mitti.length}` : ""} partner &amp; system item{rows.length === 1 ? "" : "s"} {open ? "▾" : "›"}
      </button>
      {open && (
        <ul className="mt-2 rounded-[14px] border border-line bg-paper px-4">
          {pickups.isError && <li className="py-3 text-sm text-danger">Mitti could not be checked just now — this does not mean nothing is waiting.</li>}
          {all.length === 0 && <li className="py-3 text-sm text-sub">Nothing from partners or the system.</li>}
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
  const refresh = (key?: string) => {
    if (key) setDone((d) => new Set(d).add(key));
    markOfficeChanged(); // decision 383: Jobs › Active and Enquiries work themselves out fresh on their next read
    void load({ data: { includeTest, refresh: true } }).then((fresh) => qc.setQueryData(["needs-me-v2", includeTest], fresh)).catch(() => undefined);
  };
  // Decision 378: "Spot saved · waiting for an installer" rows fold into ONE link to Jobs › Choose installer.
  const groups = data ? NEEDS_GROUPS.map((g) => ({ ...g, ...foldChooseInstaller(data.groups[g.key].filter((r) => !done.has(r.key))) })) : [];
  const todayCount = groups.find((g) => g.key === "today")?.rows.length ?? 0;
  const waiting = groups.reduce((n, g) => n + g.chooseInstaller.length, 0);
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
          {groups.map((g) => {
            const { rows, chooseInstaller } = g;
            const total = rows.length + chooseInstaller.length;
            return (
              <section key={g.key} className="mb-6 grid gap-2" aria-label={g.label} data-why={g.key === "today" ? "due or overdue now: 220 lapsed offer, 159 held quote, 123 consent, 195 ESC window, 213 final check, 245/247 email asks, send failed" : g.key === "week" ? "due within 7 days: 49 choose installer, 157 choose electrician, 119/121 VEEC Part A" : "alerts: 240 payments not in Xero, 2 ten-day clock, 215 second no-access, 120 VEEC day 10, lapsed window"}>
                <h2 className="border-b border-line pb-2 text-xs font-bold uppercase tracking-[1.1px] text-sub">{g.label}</h2>
                {chooseInstaller.length > 0 && (
                  <Link to={INSTALLER_WAITING_PATH} data-why="decision 378: one link, no duplicated rows (one pile per job)" className="flex min-h-14 items-center gap-3 rounded-[14px] border border-line bg-paper px-4 py-2.5 hover:bg-mist">
                    <span className="grid h-7 min-w-8 shrink-0 place-items-center rounded-full bg-mist px-2 text-sm font-bold text-hiv-blue">{chooseInstaller.length}</span>
                    <span className="grid min-w-0 flex-1"><span className="font-semibold text-ink">Choose installers</span><span className="text-xs text-sub">Spots saved, waiting for an installer · longest {ageLabel(chooseInstaller.reduce((a, r) => (r.since < a ? r.since : a), chooseInstaller[0]!.since), data.now)}</span></span>
                    <span aria-hidden className="text-lg text-sub">›</span>
                  </Link>
                )}
                {total === 0 ? <p className="rounded-[14px] border border-line bg-paper px-4 py-3 text-sm text-sub">Nothing {g.key === "watch" ? "to watch" : g.key === "week" ? "this week" : "today"}.</p> : null}
                {needsCards(rows).map((c) => {
                  const id = `${g.key}:${c.id}`;
                  return <Card key={id} card={c} now={data.now} open={openCard === id} onToggle={() => setOpenCard(openCard === id ? null : id)} onDone={(key) => refresh(key)} />;
                })}
              </section>
            );
          })}
          <PartnerSystemFold rows={data.system} />
        </>
      )}
    </AppShell>
  );
}
