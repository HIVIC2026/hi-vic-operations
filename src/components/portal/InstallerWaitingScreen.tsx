// Decision 378 (Jo 25 Oct 2026): Jobs › Choose installer — our-lead jobs with a saved spot waiting for the office to pick
// an installer, in ONE table with the Enquiries interaction (281/283/285/286): every heading sorts AND filters from a
// small popover, one search box, no chip panel. Columns Job · Owner · Suburb (postcode) · Size · Insulation · Estimate ·
// Waiting since · Coverage, then "Choose installer" (the ChooseInstallerPanel in a dialog; decision 389: its button is
// Release — the owner confirms first; a pending release shows its status and can't be released again). On a
// phone each row is a card with the same fields and the same heading buttons sit above the cards. Needs me folds its
// "Spot saved · waiting for an installer" rows into one link here, so a job is in one Needs me pile only.
// Task 6 (Jo 2 Nov 2026): To release shows each saved spot's area batch status ("Waiting for owner (sent for X)" /
// "X said yes · free Ready Check"); Jo ticks up to 10 plain saved spots, picks an installer who covers them all and taps
// Send — the existing batch Send (each owner gets the quick taps text and email). Not for the TEST office login.
// Saved spots by area (Jo 3 Nov 2026): To release opens on "By area" (saved-spots-by-area.tsx); this table is the
// "Table" view, unchanged. Ticks are shared by both views and feed the one Send bar. The Suggested batches box is gone.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isLastCopy, useRememberLastCopy } from "@/lib/office-last-copy";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { BatchesReadyToSend, ChooseInstallerPanel, SendResultList, type SendResults } from "@/components/portal/choose-installer";
import { ColumnHead, Pager, type ColumnFilterValue } from "@/components/portal/office-lists";
import { Pill, PillTabs, btnClass, listCard } from "@/components/portal/kit";
import { installerWaitingKey } from "@/lib/office-list-keys.core";
import { getInstallerWaitingList } from "@/lib/installer-waiting.functions";
import { batchRowLine, showAreaBatches, tickSendBlocker } from "@/lib/area-batch.core";
import { getInstallersForHomesFn, sendAreaBatchFn } from "@/lib/area-batch.functions";
import { InHouseHandoff } from "@/components/portal/in-house-handoff";
import { SavedSpotsByArea } from "@/components/portal/saved-spots-by-area";
import { useMe } from "@/hooks/use-me";
import { REGION_LABEL, pageOf, type SortDir } from "@/lib/office-filters.core";
import {
  INSTALLER_WAITING_COLUMNS, NO_INSTALLER_NOTE, activeWaitingFilters, areaCounts, coverageGap, inArea, inWaitingTab, isWaitingOwner, noInstallerExplain, recruitAreas, tickableForSend,
  spotFields, suburbLabel, waitingCountLine, waitingCounts, waitingView,
  type InstallerWaitingRow, type WaitingArea, type WaitingCoverage, type WaitingFilters, type WaitingTab,
} from "@/lib/installer-waiting-columns.core";

const btn = "inline-flex min-h-[38px] items-center justify-center whitespace-nowrap rounded-[10px] px-3.5 text-[13px] font-bold disabled:opacity-50";

/** Jo 27 Oct 2026: one soft tag. Green when an installer AND an electrician cover the area; pink names what's missing. */
function CoverageTag({ c }: { c: WaitingCoverage }) {
  const gap = coverageGap(c);
  return gap ? <Pill tone="rose">{gap} nearby</Pill> : <Pill tone="green">Installer + electrician nearby</Pill>;
}

/** Saved spots with nobody nearby, by suburb, so the office knows where to find partners. */
function RecruitCard({ rows }: { rows: InstallerWaitingRow[] }) {
  const places = recruitAreas(rows);
  return (
    <aside className="rounded-[18px] border border-rose/30 bg-[#fff8fb] p-4" aria-label="Areas to recruit in">
      <h2 className="font-display text-[17px] font-bold text-ink">Areas to recruit in</h2>
      {places.length === 0 ? <p className="mt-1 text-sm text-sub">Every saved spot has an installer and an electrician nearby.</p> : (
        <>
          <p className="mt-1 text-[13px] text-sub">Saved spots with no installer or electrician close by.</p>
          <ul className="mt-3 space-y-2">
            {places.slice(0, 8).map((p) => (
              <li key={p.place} className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0 flex-1"><span className="font-semibold text-ink">{p.place}</span><span className="block text-[12px] text-rose">{p.missing}</span></span>
                <span className="shrink-0 tabular-nums text-sub">{p.n} {p.n === 1 ? "job" : "jobs"}</span>
              </li>
            ))}
          </ul>
          {places.length > 8 && <p className="mt-2 text-[12px] text-sub">and {places.length - 8} more {places.length - 8 === 1 ? "place" : "places"}</p>}
        </>
      )}
      <Link to="/admin/partners" search={{ tab: "coverage" }} className="mt-3 inline-block text-sm font-semibold text-hiv-blue">Find partners for these areas ›</Link>
    </aside>
  );
}

/** The existing Choose installer flow, unchanged. With no installer covering the area it explains that first. */
function ChooseDialog({ row, onClose }: { row: InstallerWaitingRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [anyway, setAnyway] = useState(false);
  useEffect(() => setAnyway(false), [row?.id]);
  const close = () => { onClose(); void qc.invalidateQueries({ queryKey: ["installer-waiting"] }); };
  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose installer · {row?.jobNumber}</DialogTitle>
          <DialogDescription>{row ? `${row.ownerName || "Owner"} · ${suburbLabel(row)}` : ""}</DialogDescription>
        </DialogHeader>
        {row && !row.coverage.installer && !anyway ? (
          <div className="space-y-3 text-sm" data-why="decision 378: no empty list — say why">
            <p className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 font-semibold text-danger">{NO_INSTALLER_NOTE}</p>
            <p className="text-sub">{noInstallerExplain(row)}</p>
            <div className="flex flex-wrap gap-2">
              <Link to="/admin/partners" search={{ tab: "coverage" }} className={cn(btn, "bg-hiv-green text-white")}>Open Partners › Coverage</Link>
              <button type="button" className={cn(btn, "border border-line bg-paper text-hiv-blue")} onClick={() => setAnyway(true)}>Show installers anyway</button>
            </div>
          </div>
        ) : row ? <ChooseInstallerPanel jobId={row.id} reportLoad /> : null}
        {row && <Link to="/admin/jobs/$jobId" params={{ jobId: row.id }} className="text-xs font-semibold text-hiv-blue underline">Open the job page</Link>}
      </DialogContent>
    </Dialog>
  );
}

/** Task 6: the To release Send bar — how many are ticked, the installers who cover every ticked home, Send. Nothing goes
 *  until Jo taps Send; 0 or more than 10 ticked says why and sends nothing. */
function TickSendBar({ ticked, numbers, onSent, updating }: { ticked: string[]; numbers: Record<string, string>; onSent: () => void; updating: boolean }) {
  const qc = useQueryClient();
  const loadInstallers = useServerFn(getInstallersForHomesFn);
  const send = useServerFn(sendAreaBatchFn);
  const [picked, setPicked] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ results: SendResults; numbers: Record<string, string> } | null>(null);
  const jobIds = [...ticked].sort();
  const blocker = tickSendBlocker(jobIds.length);
  const iq = useQuery({ queryKey: ["installers-for-homes", jobIds], queryFn: () => loadInstallers({ data: { jobIds } }), enabled: !blocker, staleTime: 30_000 });
  const installers = blocker ? [] : iq.data?.installers ?? [];
  const choice = installers.some((i) => i.id === picked) ? picked : installers.length === 1 ? installers[0]!.id : "";
  const chosen = installers.find((i) => i.id === choice);
  useEffect(() => setNote(null), [jobIds.length]);
  const go = async () => {
    if (busy || updating) return;
    const why = tickSendBlocker(jobIds.length);
    if (why) { setNote(why); return; }
    if (!chosen) return;
    setNote(null);
    setBusy(true);
    const sentNumbers = Object.fromEntries(jobIds.map((id) => [id, numbers[id] ?? "Home"]));
    try {
      const r = await send({ data: { jobIds, businessId: chosen.id } });
      toast.success(`Sent to ${r.homes} ${r.homes === 1 ? "owner" : "owners"} for ${chosen.name}${r.held ? ` · ${r.held} text${r.held === 1 ? "" : "s"} held (see the job)` : ""}`);
      setLast({ results: r.results, numbers: sentNumbers });
      setPicked("");
      onSent();
      void qc.invalidateQueries({ queryKey: ["installer-waiting"] });
      void qc.invalidateQueries({ queryKey: ["area-batches"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "That didn't work"); }
    finally { setBusy(false); }
  };
  const shownNote = note ?? (jobIds.length > 10 ? blocker : null);
  return (
    <div className="mb-3 rounded-[14px] border border-line bg-paper p-3" aria-label="Send ticked saved spots" data-tick-send>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{jobIds.length} ticked</span>
        {!blocker && (iq.isError
          ? <span role="alert" className="text-[13px] text-danger">Couldn't load installers. {(iq.error as Error).message} <button type="button" className="font-semibold underline" onClick={() => void iq.refetch()}>Try again</button></span>
          : !iq.data ? <span className="text-[13px] text-sub">Loading installers…</span>
          : installers.length === 0 ? <span className="text-[13px] text-rose">No installer covers every ticked home.</span>
          : (
            <select aria-label="Installer" className="h-10 min-w-0 flex-1 rounded-[10px] border border-line bg-paper px-2 text-sm" value={choice} onChange={(e) => setPicked(e.target.value)}>
              {installers.length > 1 && <option value="">Pick an installer</option>}
              {installers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          ))}
        <button type="button" className={btnClass("primary")} disabled={busy || updating || (!blocker && !chosen)} onClick={() => void go()}>{busy ? "Sending…" : updating ? "Updating…" : "Send"}</button>
      </div>
      {shownNote && <p role="alert" className="mt-2 text-[13px] font-semibold text-rose">{shownNote}</p>}
      {last && <div className="mt-3"><p className="mb-1 text-[13px] font-semibold text-ink">Last Send</p><SendResultList results={last.results} label={(id) => last.numbers[id] ?? "Home"} /></div>}
    </div>
  );
}

export function InstallerWaitingScreen() {
  const load = useServerFn(getInstallerWaitingList);
  const { data: me } = useMe();
  const [includeTest, setIncludeTest] = useState(false);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<WaitingFilters>({});
  const [sort, setSort] = useState<{ k: string; d: SortDir }>({ k: "waiting", d: "asc" });
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<WaitingTab>("to_release");
  const [area, setArea] = useState<WaitingArea>("everywhere");
  const [choosing, setChoosing] = useState<InstallerWaitingRow | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [layout, setLayout] = useState<"area" | "table">("area");
  useEffect(() => { const t = setTimeout(() => { setSearch(typed.trim()); setPage(1); }, 200); return () => clearTimeout(t); }, [typed]);
  const q = useQuery({ queryKey: installerWaitingKey(includeTest), queryFn: () => load({ data: { includeTest } }), staleTime: 30_000 });
  // Task 9: the last copy kept on this device shows at once; Send waits until the fresh copy has arrived.
  const listKey = installerWaitingKey(includeTest);
  useRememberLastCopy(me?.user.id, "installer-waiting", !includeTest, listKey, q);
  const lastCopy = !!q.data && isLastCopy(listKey, q.dataUpdatedAt);
  const d = q.data;
  const now = d?.now ?? Date.now();
  // Jo 27 Oct 2026: released spots get their own tab; the area pills group the rest by where they are.
  const inTab = d ? d.rows.filter((r) => inWaitingTab(r, tab)) : [];
  const areas = areaCounts(inTab);
  const view = d ? waitingView(inTab.filter((r) => inArea(r, area)), { search, filters, sort: sort.k, dir: sort.d }, now) : [];
  const shown = pageOf(view, page);
  const active = activeWaitingFilters(filters);
  const noInstaller = d?.rows.filter((r) => !r.coverage.installer).length ?? 0;
  const waitingOwner = d?.rows.filter(isWaitingOwner).length;
  const onFilter = (k: string, v: ColumnFilterValue) => { setFilters({ ...filters, [k]: v } as WaitingFilters); setPage(1); };
  const onSort = (k: string, dd: SortDir) => { setSort({ k, d: dd }); setPage(1); };
  // Task 6: ticks only on To release, and not for the TEST office login (the batch Send isn't on its allowlist). A tick
  // whose row is no longer a plain, releasable saved spot (after a refresh) drops out.
  const ticks = tab === "to_release" && showAreaBatches(me?.roles);
  const tickable = new Map((d?.rows ?? []).filter((r) => inWaitingTab(r, "to_release") && tickableForSend(r)).map((r) => [r.id, r.jobNumber]));
  const tickedNow = ticked.filter((id) => tickable.has(id));
  const toggleTick = (id: string) => setTicked(tickedNow.includes(id) ? tickedNow.filter((x) => x !== id) : [...tickedNow, id]);
  // By area is To release only; Waiting for owner keeps the table.
  const byArea = tab === "to_release" && layout === "area";
  const pickTab = (t: WaitingTab) => { setTab(t); setArea("everywhere"); setPage(1); };
  const pickArea = (a: WaitingArea) => { setArea(a); setPage(1); };
  const heads = (className?: string) => INSTALLER_WAITING_COLUMNS.map((c) => <ColumnHead key={c.key} col={c} sort={sort.k} dir={sort.d} value={filters[c.key] as ColumnFilterValue} onSort={onSort} onFilter={onFilter} {...(className ? { className } : {})} />);
  // Literal class names (Tailwind only sees whole strings).
  const plainCols = "lg:grid-cols-[76px_minmax(0,1fr)_minmax(0,1.1fr)_96px_78px_88px_minmax(0,1fr)_minmax(0,1fr)_auto]";
  const tickCols = "lg:grid-cols-[28px_76px_minmax(0,1fr)_minmax(0,1.1fr)_96px_78px_88px_minmax(0,1fr)_minmax(0,1fr)_auto]";
  const cols = ticks ? tickCols : plainCols;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[30px] font-extrabold leading-tight text-ink">Choose installer</h1>
          <p className="mt-1 text-sm text-sub">{d ? `${waitingCountLine(waitingCounts(d.rows))}${noInstaller ? ` · ${noInstaller.toLocaleString("en-AU")} with no installer able to take the area` : ""}` :"Our leads with a saved spot, waiting for you to pick an installer"}</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link to="/admin/jobs/ours" className="font-semibold text-hiv-blue">Our jobs ›</Link>
          <button type="button" className="font-semibold text-hiv-blue underline" onClick={() => setIncludeTest(!includeTest)}>{includeTest ? "Hide TEST jobs" : "Include TEST jobs"}</button>
        </div>
      </div>
      {lastCopy && !q.isError && <p data-last-copy-updating className="mb-2 text-xs text-sub">Updating…</p>}
      {/* A48 batch 2: not for the TEST office login (its functions are not on the TEST office allowlist). */}
      {showAreaBatches(me?.roles) && <BatchesReadyToSend includeTest={includeTest} />}
      {showAreaBatches(me?.roles) && <InHouseHandoff />}
      <PillTabs<WaitingTab> label="Saved spots" value={tab} onChange={pickTab} options={[
        { value: "to_release", label: "To release", count: d ? d.rows.length - (waitingOwner ?? 0) : null },
        { value: "waiting_owner", label: "Waiting for owner", count: waitingOwner ?? null },
      ]} />
      {tab === "to_release" && (
        <PillTabs<"area" | "table"> label="View" className="mt-2" value={layout} onChange={setLayout} options={[
          { value: "area", label: "By area" },
          { value: "table", label: "Table" },
        ]} />
      )}
      {!byArea && areas.length > 0 && (
        <PillTabs<WaitingArea> label="Area" className="mt-2" value={area} onChange={pickArea} options={[
          { value: "everywhere", label: "Everywhere", count: inTab.length },
          ...areas.map((a) => ({ value: a.area as WaitingArea, label: REGION_LABEL[a.area], count: a.n })),
        ]} />
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <section className="min-w-0">
          {byArea ? (
            <>
              <p className="mb-3 text-[13px] text-sub">Saved spots grouped by area, best first. Tick any you want to send.</p>
              {ticks && d && <TickSendBar ticked={tickedNow} numbers={Object.fromEntries(tickable)} onSent={() => setTicked([])} updating={lastCopy} />}
              {q.isError ? <div role="alert" className="rounded-[14px] border border-danger/40 bg-danger-soft p-4 text-sm">The list could not load — this does not mean no job is waiting. {(q.error as Error).message} <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Try again</button></div>
                : !d ? <div className={listCard}><p className="p-6 text-center text-sm text-sub">Loading…</p></div>
                : <SavedSpotsByArea list={d} ticked={tickedNow} onToggle={toggleTick} canTick={ticks} />}
            </>
          ) : (<>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2" data-why="decision 378: one search box; headings sort and filter; no chip panel">
            <p className="text-[13px] text-sub">{tab === "waiting_owner" ? "Released to an installer. The owner confirms first; a reminder goes on day 2 and the release lapses on day 5." : "Saved a spot and ready for you to pick an installer."}</p>
            <Input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search owner, suburb, postcode or job" aria-label="Search jobs waiting for an installer" className="h-11 w-full max-w-[320px] rounded-[12px] bg-paper" />
          </div>
          <div className="mb-2 flex items-center justify-end gap-3">
            <span className="text-sm text-sub">{d ? `${view.length.toLocaleString("en-AU")} · showing ${shown.rows.length}` : "Loading…"}{q.isFetching && d && !lastCopy ? " · updating…" : ""}</span>
            {active.length > 0 && <button type="button" className="text-sm font-semibold text-hiv-blue underline" onClick={() => { setFilters({}); setPage(1); }}>Clear {active.length} filter{active.length === 1 ? "" : "s"}</button>}
          </div>
          {/* Phone: the same heading buttons (sort + filter) above the cards. */}
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-2 rounded-[12px] border border-line bg-paper px-3 py-2 lg:hidden" aria-label="Sort or filter">{heads()}</div>
          {ticks && d && <TickSendBar ticked={tickedNow} numbers={Object.fromEntries(tickable)} onSent={() => setTicked([])} updating={lastCopy} />}
          {q.isError ? <div role="alert" className="rounded-[14px] border border-danger/40 bg-danger-soft p-4 text-sm">The list could not load — this does not mean no job is waiting. {(q.error as Error).message} <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Try again</button></div> : (
            <div className={listCard}>
              <div className={cn("hidden gap-x-3 border-b border-line bg-[#fafbfe] px-5 py-2.5 lg:grid", cols)}>{ticks && <span />}{heads()}<span /></div>
              {!d ? <p className="p-6 text-center text-sm text-sub">Loading…</p> : shown.rows.length === 0 ? <p className="p-6 text-center text-sm text-sub">{search || active.length || area !== "everywhere" ? "No job matches that search." : tab === "waiting_owner" ? "No released spot is waiting for the owner." : "No saved spot is waiting for an installer."}</p> : (
                <ul>
                  {shown.rows.map((r) => {
                    const f = spotFields(r, now);
                    const batchLine = batchRowLine(r.batch ?? null, r.ownerName);
                    return (
                      <li key={r.id} className={cn("grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-[#eef1f6] px-4 py-3.5 text-[14px] last:border-b-0 lg:min-h-[54px] lg:items-center lg:gap-y-0 lg:px-5 lg:py-2.5", cols)} data-job={r.jobNumber}>
                        {ticks && (
                          <span className="col-span-2 flex items-center lg:col-span-1">
                            <input type="checkbox" className="h-5 w-5 accent-hiv-green disabled:opacity-40" aria-label={`Tick ${r.jobNumber} for Send`} disabled={!tickableForSend(r)} checked={tickedNow.includes(r.id)} onChange={() => toggleTick(r.id)} />
                          </span>
                        )}
                        <span className="col-span-2 flex items-center gap-2 text-sub lg:col-span-1">
                          <Link to="/admin/jobs/$jobId" params={{ jobId: r.id }} className="hover:underline">{r.jobNumber}</Link>
                          {r.isTest && <span className="rounded bg-warning-soft px-1 text-[10px] font-bold text-foreground">TEST</span>}
                        </span>
                        <span className="text-sub lg:hidden">Owner</span><span className="truncate font-semibold text-ink">{f.owner}</span>
                        <span className="text-sub lg:hidden">Suburb</span><span className="truncate">{f.suburb}</span>
                        <span className="text-sub lg:hidden">Size</span><span>{f.size}</span>
                        <span className="text-sub lg:hidden">Insulation</span><span>{f.insulation}</span>
                        <span className="text-sub lg:hidden">Estimate</span><span className="font-display text-[16px] font-bold text-ink">{f.estimate}</span>
                        <span className="text-sub lg:hidden">Waiting since</span><span className="text-[13px] text-sub">{f.waiting}{r.lastOffer && <span className="block text-[12px]">Last offer {r.lastOffer.status === "declined" ? `declined${r.lastOffer.name ? ` by ${r.lastOffer.name}` : ""}` : `lapsed${r.lastOffer.name ? ` (${r.lastOffer.name})` : ""}`}</span>}{r.release?.line && <span className={cn("block text-[12px] font-semibold", r.release.state === "lapsed" ? "text-rose" : "text-hiv-blue")} data-release={r.release.state}>{r.release.line}</span>}{batchLine && <span className={cn("block text-[12px] font-semibold", r.batch?.kind === "said_yes" ? "text-hiv-green" : "text-hiv-blue")} data-batch={r.batch?.kind}>{batchLine}</span>}</span>
                        <span className="text-sub lg:hidden">Nearby</span>
                        <span><CoverageTag c={r.coverage} /></span>
                        <span className="col-span-2 mt-1 lg:col-span-1 lg:mt-0">
                          {r.release && !r.release.releasable
                            ? <button type="button" disabled className={cn(btn, "w-full border border-line bg-paper text-sub lg:w-auto")} title={r.release.line ?? undefined}>Released</button>
                            : <button type="button" className={cn(btn, "w-full lg:w-auto", r.coverage.installer ? "bg-hiv-green text-white" : "border border-rose/40 bg-paper text-rose")} onClick={() => setChoosing(r)} title={r.coverage.installer ? undefined : NO_INSTALLER_NOTE}>Choose installer</button>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {d && <Pager page={shown.page} totalPages={shown.totalPages} total={shown.total} shown={shown.rows.length} onPage={setPage} />}
          </>)}
        </section>
        {d && <RecruitCard rows={d.rows} />}
      </div>
      <ChooseDialog row={choosing} onClose={() => setChoosing(null)} />
    </div>
  );
}
