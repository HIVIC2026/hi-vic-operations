// O1 Needs me (approved mock-up; decisions 220, 221, 240, 243, 245, 247): the office home. Three groups — Today /
// This week / Watch — one line per row (job · surname · suburb · one short line · age · one button), partner & system
// items folded into one line, Include TEST jobs. No numbers strip, no "Later", no dispatch switch, no "Send to all".
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
import { applyEmailChange, ignoreEmailChange, matchOutlookEmail } from "@/lib/email-office.functions";
import { ageLabel, NEEDS_GROUPS, type NeedsRow, type SystemRow } from "@/lib/office-needs.core";
import { pickupLabel } from "@/lib/mitti-pickup.core";
import { INSTALLER_WAITING_PATH, chooseInstallersLinkLabel, foldChooseInstaller } from "@/lib/installer-waiting-columns.core";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/needs-me")({
  head: () => ({ meta: [{ title: "Needs me – Home Insulation Victoria" }, { name: "description", content: "What needs the office today, this week, and what to watch." }, { property: "og:title", content: "Needs me – Home Insulation Victoria" }, { property: "og:description", content: "What needs the office today, this week, and what to watch." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" }] }),
  validateSearch: (s: Record<string, unknown>): { test?: boolean } => (s["test"] === true || s["test"] === "true" ? { test: true } : {}),
  component: NeedsMe,
});

const today = () => new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Melbourne" });
const btn = "inline-flex min-h-[38px] items-center justify-center whitespace-nowrap rounded-[10px] px-3.5 text-[13px] font-bold";

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
    try { await fn(); toast.success(ok); onDone(); } catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); } finally { setBusy(false); }
  };
  if (row.kind === "email_change") return (
    <div className="flex gap-2">
      <button type="button" disabled={busy} className={cn(btn, "bg-hiv-green text-white")} onClick={() => void run(async () => {
        await apply({ data: { eventId: row.eventId! } });
        // A day change is never applied to a booking: the office rearranges it on the job's Install card.
        if (row.intent === "reschedule" && row.jobId) void navigate({ to: "/admin/jobs/$jobId", params: { jobId: row.jobId }, hash: "stage-install" });
      }, row.intent === "cancel" ? "Job cancelled" : row.intent === "reschedule" ? "Noted — rearrange the day on the job" : "Applied")}>Apply</button>
      <button type="button" disabled={busy} className={cn(btn, "border border-line bg-paper text-hiv-blue")} onClick={() => void run(() => ignore({ data: { eventId: row.eventId! } }), "Ignored")}>Ignore</button>
    </div>
  );
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <button type="button" disabled={busy} className={cn(btn, "bg-hiv-green text-white")} onClick={() => row.jobId && !picking ? void run(() => match({ data: { messageEventId: row.eventId!, jobId: row.jobId! } }), `Matched to ${row.jobNumber}`) : setPicking(true)}>{row.jobId ? `Match to ${row.jobNumber}` : "Match"}</button>
        <button type="button" disabled={busy} className={cn(btn, "border border-line bg-paper text-hiv-blue")} onClick={() => void run(() => match({ data: { messageEventId: row.eventId!, jobId: null } }), "Marked not a customer")}>Not a customer</button>
      </div>
      {row.jobId && !picking && <button type="button" className="text-left text-xs font-semibold text-hiv-blue underline" onClick={() => setPicking(true)}>A different job…</button>}
      {picking && <div className="w-72"><OfficeSearch onPick={(j) => void run(() => match({ data: { messageEventId: row.eventId!, jobId: j.id } }), `Matched to ${j.jobNumber}`)} /></div>}
    </div>
  );
}

function Row({ row, now, onDone }: { row: NeedsRow; now: number; onDone: () => void }) {
  const email = row.kind === "email_change" || row.kind === "email_unmatched";
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 border-b border-line py-3 last:border-b-0 md:grid-cols-[86px_minmax(0,150px)_minmax(0,140px)_minmax(0,1fr)_48px_auto] md:items-center" data-kind={row.kind}>
      <span className="font-semibold text-ink">{row.jobNumber ?? "Email"}{row.isTest ? <span className="ml-1 rounded bg-warning-soft px-1 text-[10px] font-bold">TEST</span> : null}</span>
      <span className="truncate font-semibold">{row.surname || "—"}</span>
      <span className="truncate text-sub">{row.suburb ?? ""}</span>
      <span className="min-w-0 break-words text-ink">{row.line}</span>
      <span className="text-xs text-sub md:text-right">{ageLabel(row.since, now)}</span>
      <span className="mt-1 md:mt-0">
        {email ? <EmailActions row={row} onDone={onDone} />
          : row.jobId && row.button.to === "job"
            ? <Link to="/admin/jobs/$jobId" params={{ jobId: row.jobId }} {...(row.button.section ? { hash: `stage-${row.button.section}` } : {})} className={cn(btn, "w-full bg-hiv-green text-white md:w-auto")}>{row.button.label}</Link>
            : null}
      </span>
    </li>
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
              <a href={r.href} className={cn(btn, "border border-line bg-paper text-hiv-blue")}>{r.button}</a>
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
  const { data, error, refetch, isPending } = useQuery({
    queryKey: ["needs-me-v2", includeTest], queryFn: () => load({ data: { includeTest } }), staleTime: 60_000, retry: 1,
    refetchInterval: (q) => (q.state.data?.refreshing ? 5_000 : 120_000),
  });
  useEffect(() => { setDone(new Set()); }, [data?.computedAt]);
  const refresh = (key?: string) => {
    if (key) setDone((d) => new Set(d).add(key));
    void load({ data: { includeTest, refresh: true } }).then((fresh) => qc.setQueryData(["needs-me-v2", includeTest], fresh)).catch(() => undefined);
  };
  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-[30px] font-extrabold leading-tight text-ink">Needs me</h1>
          <p className="text-sm text-sub">{today()}{data ? ` · ${data.total} need${data.total === 1 ? "s" : ""} you. Most urgent first. Checked ${checkedLabel(data.computedAt, data.refreshing)}` : ""}</p>
        </div>
        <Link to="/admin/needs-me" search={includeTest ? {} : { test: true }} className="text-sm font-semibold text-hiv-blue underline">{includeTest ? "Hide TEST jobs" : "Include TEST jobs"}</Link>
      </div>
      {error ? (
        <div role="alert" className="rounded-[14px] border border-danger/40 bg-danger-soft p-4 text-sm text-danger">Needs me couldn't load — this does NOT mean nothing needs you. {(error as Error).message} <button type="button" className="font-semibold underline" onClick={() => void refetch()}>Try again</button></div>
      ) : isPending || !data ? <p className="text-sub">Checking every job…</p> : (
        <>
          {NEEDS_GROUPS.map((g) => {
            // Decision 378: "Spot saved · waiting for an installer" rows fold into ONE link to Jobs › Choose installer.
            const { rows, chooseInstaller } = foldChooseInstaller(data.groups[g.key].filter((r) => !done.has(r.key)));
            const total = rows.length + chooseInstaller.length;
            return (
              <section key={g.key} className="mb-6" aria-label={g.label} data-why={g.key === "today" ? "due or overdue now: 220 lapsed offer, 159 held quote, 123 consent, 195 ESC window, 213 final check, 245/247 email asks, send failed" : g.key === "week" ? "due within 7 days: 49 choose installer, 157 choose electrician, 119/121 VEEC Part A" : "alerts: 240 payments not in Xero, 2 ten-day clock, 215 second no-access, 120 VEEC day 10, lapsed window"}>
                <h2 className="mb-1 font-display text-lg font-bold text-ink">{g.label} · {total}</h2>
                {chooseInstaller.length > 0 && (
                  <Link to={INSTALLER_WAITING_PATH} data-why="decision 378: one link, no duplicated rows (one pile per job)" className="mb-2 flex items-center justify-between gap-3 rounded-[14px] border border-line bg-paper px-4 py-3 text-sm hover:bg-mist">
                    <span><span className="font-semibold text-ink">{chooseInstallersLinkLabel(chooseInstaller.length)}</span><span className="text-sub"> · spots saved, waiting for an installer · longest {ageLabel(chooseInstaller.reduce((a, r) => (r.since < a ? r.since : a), chooseInstaller[0]!.since), data.now)}</span></span>
                    <span className={cn(btn, "bg-hiv-green text-white")}>Open list</span>
                  </Link>
                )}
                {total === 0 ? <p className="rounded-[14px] border border-line bg-paper px-4 py-3 text-sm text-sub">Nothing {g.key === "watch" ? "to watch" : g.key === "week" ? "this week" : "today"}.</p> : rows.length === 0 ? null : (
                  <ul className="rounded-[14px] border border-line bg-paper px-4">{rows.map((r) => <Row key={r.key} row={r} now={data.now} onDone={() => refresh(r.key)} />)}</ul>
                )}
              </section>
            );
          })}
          <PartnerSystemFold rows={data.system} />
        </>
      )}
    </AppShell>
  );
}
