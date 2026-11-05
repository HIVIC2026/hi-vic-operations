// Needs me: five visible presentation sections; existing readers and guarded actions unchanged.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/portal/AppShell";
import { getMittiPickups, getMittiSyncProblems } from "@/lib/mitti-pickup.functions";
import { getNeedsMePage } from "@/lib/office-screens.functions";
import { checkedLabel } from "@/lib/office-needs-snapshot.core";
import { markOfficeChanged } from "@/lib/office-list-refresh";
import { BulkMatch, EmailActions } from "@/components/portal/email-match";
import { CoesActions } from "@/components/portal/coes-actions";
import { ageLabel, type NeedsRow, type SystemRow } from "@/lib/office-needs.core";
import { bulkMatchable, unavailableNote } from "@/lib/needs-cards.core";
import { btnClass } from "@/components/portal/kit";
import { pickupLabel } from "@/lib/mitti-pickup.core";
import { INSTALLER_WAITING_PATH, foldChooseInstaller } from "@/lib/installer-waiting-columns.core";
import { partitionNeeds, deadlineDisplay } from "@/lib/needs-sections.core";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/needs-me")({
  head: () => ({ meta: [{ title: "Needs me – Home Insulation Victoria" }, { name: "description", content: "Office deadlines, quotes, partners, installers and forms." }, { property: "og:title", content: "Needs me – Home Insulation Victoria" }, { property: "og:description", content: "Office deadlines, quotes, partners, installers and forms." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" }] }),
  validateSearch: (s: Record<string, unknown>): { test?: boolean } => (s["test"] === true || s["test"] === "true" ? { test: true } : {}),
  component: NeedsMe,
});

const today = () => new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Melbourne" });
// Kit buttons, taller on a phone (46px, as O1) so a thumb finds them.
const btn = (tone: "primary" | "secondary") => btnClass(tone, "min-h-[46px] whitespace-nowrap md:min-h-[42px]");
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
  // A48 batch 1 task 5: the certificate row is decided here (Tick / Reject), with Open job to see the certificate.
  if (row.kind === "coes_check") return (
    <li className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0" data-kind={row.kind}>
      {head}{why}
      <CoesActions row={row} onDone={onDone} />
    </li>
  );
  const open = row.jobId && row.button.to === "job";
  return (
    <li className="border-b border-line last:border-b-0" data-kind={row.kind}>
      {open ? (
        <Link to="/admin/jobs/$jobId" params={{ jobId: row.jobId ?? "" }} {...(row.button.to === "job" && row.button.section ? { hash: `stage-${row.button.section}` } : {})} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hiv-blue">
          <span className="grid min-w-0 flex-1 gap-0.5">{head}{why}</span>
          <span className={btn("primary")}>{row.button.label}</span>
        </Link>
      ) : <div className="grid gap-0.5 px-4 py-3">{head}{why}</div>}
    </li>
  );
}

function NeedsMe() {
  const { qaOffice } = Route.useRouteContext();
  const { test } = Route.useSearch();
  const includeTest = !!test;
  const qc = useQueryClient();
  const load = useServerFn(getNeedsMePage);
  const pickupsFn = useServerFn(getMittiPickups);
  const syncFn = useServerFn(getMittiSyncProblems);
  const pickups = useQuery({ queryKey: ["mitti-pickups"], queryFn: () => pickupsFn(), staleTime: 60_000, retry: 1, enabled: !qaOffice });
  const sync = useQuery({ queryKey: ["mitti-sync-problems"], queryFn: () => syncFn(), staleTime: 60_000, retry: 1, enabled: !qaOffice });
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const { data, error, refetch, isPending } = useQuery({
    queryKey: ["needs-me-v2", includeTest], queryFn: () => load({ data: { includeTest } }), staleTime: 60_000, retry: 1,
    refetchInterval: q => q.state.data?.refreshing ? 5_000 : 120_000,
  });
  useEffect(() => { setDone(new Set()); }, [data?.computedAt]);
  const refresh = (keys: string[] = []) => {
    if (keys.length) setDone(d => new Set([...d, ...keys]));
    markOfficeChanged();
    void load({ data: { includeTest, refresh: true } }).then(fresh => qc.setQueryData(["needs-me-v2", includeTest], fresh)).catch(() => undefined);
  };
  const rows = data ? Object.values(data.groups).flat().filter(r => !done.has(r.key)) : [];
  const mitti: SystemRow[] = qaOffice ? [] : [
    ...(pickups.data?.rows ?? []).map(p => ({ key: `pickup:${p.auditId}`, tag: "Mitti", who: p.business?.name ?? "Mitti user not matched", line: `${pickupLabel(p)} · Ready Check started, no portal job`, since: p.modifiedAt, button: "Link form", href: "/admin/jobs/installers" })),
    ...(sync.data?.rows ?? []).map(p => ({ key: `sync:${p.jobId}`, tag: "Mitti", who: `${p.jobNumber} ${p.owner ?? ""}`.trim(), line: `Mitti sync problem · ${p.message}`, since: p.since, button: "Open job", href: `/admin/jobs/${p.jobId}`, jobId: p.jobId })),
  ];
  const sections = partitionNeeds(rows, [...(data?.system ?? []), ...mitti], data?.now ?? Date.now());
  const waiting = foldChooseInstaller(rows).chooseInstaller;
  const oldest = waiting.reduce<string | null>((a, r) => !a || r.since < a ? r.since : a, null);
  return <AppShell>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
      <div><h1>Needs me</h1><p className="text-sm text-sub">{today()}{data ? ` · ${data.total} need you · Checked ${checkedLabel(data.computedAt, data.refreshing)}` : ""}</p></div>
      <Link to="/admin/needs-me" search={includeTest ? {} : { test: true }} className="inline-flex min-h-11 items-center text-sm font-semibold text-hiv-blue underline">{includeTest ? "Hide TEST jobs" : "Include TEST jobs"}</Link>
    </div>
    {error ? <div role="alert" className="text-danger">Needs me couldn't load — this does NOT mean nothing needs you. <Button variant="outline" onClick={() => void refetch()}>Try again</Button></div>
      : isPending || !data ? <p role="status" className="text-sub">Checking every job…</p> : <>
        {unavailableNote(data.unavailable) && <div role="alert" className="mb-4 text-danger">{unavailableNote(data.unavailable)} <Button variant="outline" onClick={() => refresh()}>Try again</Button></div>}
        {sections.map(section => <section key={section.key} aria-label={section.label} className="mb-8">
          <h2 className="mb-2 border-b border-line pb-2 text-sm font-bold uppercase text-ink">{section.label} <span className="text-sub">· {section.rows.length + section.system.length}</span></h2>
          {section.key === "forms" && <h3 className="mb-2 text-sm font-semibold text-sub">Sends and forms that failed</h3>}
          {section.key === "forms" && (pickups.isError || sync.isError) && <div role="alert" className="mb-3 text-sm text-danger">Mitti forms couldn't be checked — this does not mean nothing is waiting. <Button variant="outline" onClick={() => { if (pickups.isError) void pickups.refetch(); if (sync.isError) void sync.refetch(); }}>Try again</Button></div>}
          {section.key === "installers" ? waiting.length > 0 && <Link to={INSTALLER_WAITING_PATH} className="flex min-h-14 items-center gap-3 border-b border-line py-3"><span className="font-bold text-hiv-blue">{waiting.length}</span><span className="min-w-0 flex-1"><span className="block font-semibold">Choose installers</span><span className="text-xs text-sub">Spots saved, ready for you to choose (released ones not counted) · longest {oldest ? ageLabel(oldest, data.now) : ""}</span></span><span aria-hidden>›</span></Link>
            : <><BulkMatch rows={bulkMatchable(section.rows)} onDone={refresh} /><ul>{section.rows.map((r, index) => <li key={r.key} className="list-none">
              {section.key === "quotes" && r.kind !== "quote_check" && r.kind !== "fixes_quote_check" && (index === 0 || section.rows[index - 1]?.kind === "quote_check" || section.rows[index - 1]?.kind === "fixes_quote_check") && <h3 className="mt-3 text-sm font-semibold text-sub">Owner replies waiting</h3>}
              <ul><Row row={section.key === "deadlines" ? { ...r, line: deadlineDisplay(r, data.now) } : r} now={data.now} onDone={() => refresh([r.key])} /></ul>
            </li>)}</ul></>}
          <ul>{section.system.map(r => <li key={r.key} className="grid gap-1 border-b border-line py-3 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><span className="block font-semibold">{r.who}</span><span className="block break-words text-sm">{r.line}</span></div><a href={r.href} className={btn("secondary")}>{r.button}</a></li>)}</ul>
          {!section.rows.length && !section.system.length && <p className="py-2 text-sm text-sub">Nothing waiting{data.unavailable?.length ? " in the checks that loaded" : ""}.</p>}
        </section>)}
      </>}
  </AppShell>;
}
