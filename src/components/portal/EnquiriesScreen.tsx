// O4 Enquiries (decisions 216, 225, 228, 238, 281, 283, 285, 286; redesigned with Jo 26 Oct 2026): the website leads,
// grouped by where each one is up to (enquiry-categories.core): offered a spot, email didn't send, opted out, gone
// quiet (no questions step: Jo 26 Oct, "we don't ask for answers"). Saved spots are jobs (Jobs › Choose installer) and
// not-eligible leads are closed (Jobs › Closed): the screen links there. Emails live in the Inbox, not here. Inside a
// group the rows sort hottest first (the rank is never shown, 283); on a computer the columns Job · Owner · Address ·
// Size (m²) · Insulation · Estimate ($) · Last heard sort AND filter from their headings (286); one search box (285).
// A row opens the job beside the list (the Needs me side panel); "Wrote to us" marks an owner email we haven't
// answered. Gone quiet and Opted out can be closed in one go (they move to Jobs › Closed with the reason; history
// kept, reopen any time). New enquiry (phone), Actions ▾ Cancel / Remove.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAction } from "@/hooks/use-me";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { bulkCancelOfficeJobs, getEnquiriesList } from "@/lib/office-screens.functions";
import { checkedLabel, isDefaultListView } from "@/lib/office-needs-snapshot.core";
import { readOfficeList } from "@/lib/office-list-refresh";
import { removeLeadsFn } from "@/lib/enquiry-groups.functions";
import { createEnquiry } from "@/lib/portal.functions";
import { tidyEnquiryDetails } from "@/lib/name-address-tidy.core";
import { INSULATION_LABEL, type InsulationChip, type SortDir } from "@/lib/office-filters.core";
import { ENQUIRY_COLUMNS, activeColumnFilters, estimateLabel, sizeLabel, type ColumnFilters } from "@/lib/enquiry-columns.core";
import { CLOSABLE, ENQUIRY_CATEGORIES, type CategoryCounts, type EnquiryView } from "@/lib/enquiry-categories.core";
import { INSTALLER_WAITING_PATH } from "@/lib/installer-waiting-columns.core";
import { ActionsMenu, ColumnHead, Pager, ReasonDialog, heardLabel, type ColumnFilterValue } from "@/components/portal/office-lists";
import { JobPeek, type Peek } from "@/components/portal/job-peek";
import { Pill, PillTabs, btnClass, listCard } from "@/components/portal/kit";
import { ageLabel } from "@/lib/office-needs.core";

const INSULATION_WORDS: Record<InsulationChip, string> = { no: "no insulation", some: "some insulation", not_sure: "insulation not sure" };

/** New enquiry (phone) — the existing guarded createEnquiry (moved here from the retired Pipeline board). */
function NewEnquiryDialog() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ full_name: "", email: "", phone: "", address_line: "", suburb: "", postcode: "", occupancy: "owner_occupied" as "owner_occupied" | "rental", area: "", unknown: false, life: "unknown" as "yes" | "no" | "unknown" });
  const create = useAction(createEnquiry);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const tidy = tidyEnquiryDetails({ fullName: f.full_name, addressLine: f.address_line, suburb: f.suburb || null, postcode: f.postcode || null });
  return (
    <>
      <button type="button" className={btnClass("primary")} onClick={() => setOpen(true)}>New enquiry (phone)</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New enquiry (phone)</DialogTitle><DialogDescription>Name and address are tidied the same way as website enquiries; a missing suburb or postcode is looked up automatically.</DialogDescription></DialogHeader>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
            e.preventDefault();
            const out = await create({ full_name: tidy.fullName, email: f.email, phone: f.phone || null, address_line: tidy.street || f.address_line, suburb: tidy.suburb || null, postcode: tidy.postcode || null, occupancy: f.occupancy, estimated_area_m2: f.unknown || !f.area ? null : Number(f.area), area_unknown: f.unknown || !f.area, life_support: f.life === "yes", life_support_status: f.life }, "Enquiry created");
            if (out) setOpen(false);
          }}>
            <label className="text-sm font-semibold">Name<Input value={f.full_name} onChange={set("full_name")} required className="mt-1" /></label>
            <label className="text-sm font-semibold">Email<Input type="email" value={f.email} onChange={set("email")} required className="mt-1" /></label>
            <label className="text-sm font-semibold">Phone<Input value={f.phone} onChange={set("phone")} className="mt-1" /></label>
            <label className="text-sm font-semibold">Occupancy<select className="mt-1 h-10 w-full rounded-[9px] border border-line bg-background px-2 text-sm" value={f.occupancy} onChange={(e) => setF({ ...f, occupancy: e.target.value as "owner_occupied" | "rental" })}><option value="owner_occupied">Owner-occupied</option><option value="rental">Rental</option></select></label>
            <label className="text-sm font-semibold sm:col-span-2">Street<Input value={f.address_line} onChange={set("address_line")} required className="mt-1" /></label>
            <label className="text-sm font-semibold">Suburb<Input value={f.suburb} onChange={set("suburb")} className="mt-1" /></label>
            <label className="text-sm font-semibold">Postcode<Input value={f.postcode} onChange={set("postcode")} className="mt-1" /></label>
            <label className="text-sm font-semibold">Ceiling area m²<Input type="number" value={f.area} onChange={set("area")} disabled={f.unknown} className="mt-1" /></label>
            <div className="flex flex-col justify-end gap-2 text-sm">
              <label className="flex items-center gap-2"><Checkbox checked={f.unknown} onCheckedChange={(v) => setF({ ...f, unknown: !!v })} /> Area not known</label>
              <label className="font-semibold">Life support<select className="mt-1 h-10 w-full rounded-[9px] border border-line bg-background px-2 text-sm" value={f.life} onChange={(e) => setF({ ...f, life: e.target.value as "yes" | "no" | "unknown" })}><option value="unknown">Not asked</option><option value="yes">Yes</option><option value="no">No</option></select></label>
            </div>
            {tidy.problems.length > 0 && f.address_line && <p className="text-xs text-sub sm:col-span-2">Suburb / postcode not given — the portal looks them up from the street once saved.</p>}
            <button type="submit" className={btnClass("primary", "sm:col-span-2")}>Create enquiry</button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The groups as one row of pill tabs (tabs start with Offered a spot — Jo 28 Oct 2026: In play removed as a duplicate).
 *  Then each group, then every open enquiry. Saved spots and not-eligible leads are links into Jobs. A failed read shows "–", never 0. */
function Groups({ view, counts, onPick }: { view: EnquiryView; counts: CategoryCounts | null; onPick: (v: EnquiryView) => void }) {
  const c = (k: keyof CategoryCounts) => (counts ? counts[k] : null);
  return (
    <div className="grid gap-2 lg:flex lg:items-center lg:justify-between lg:gap-4">
      <PillTabs label="Enquiry groups" value={view} onChange={onPick} options={[
        ...ENQUIRY_CATEGORIES.map((x) => ({ value: x.key as EnquiryView, label: x.label, count: c(x.key), ...(x.key === "not_sent" ? { tone: "rose" as const } : {}) })),
        { value: "all" as EnquiryView, label: "All open", count: c("all") },
      ]} />
      <span className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-[13px] font-semibold">
        <Link to={INSTALLER_WAITING_PATH} className="text-hiv-blue hover:underline">Saved spots are in Jobs ›</Link>
        <Link to="/admin/jobs/closed" className="text-sub hover:underline">Not eligible ›</Link>
      </span>
    </div>
  );
}

export function EnquiriesScreen() {
  const qc = useQueryClient();
  const load = useServerFn(getEnquiriesList);
  const [view, setView] = useState<EnquiryView>("offered");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<{ k: string; d: SortDir }>({ k: "", d: "asc" });
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<string | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  // Search as you type (decision 285): a short pause, then the list refreshes from page 1.
  useEffect(() => { const t = setTimeout(() => { setSearch(typed.trim()); setPage(1); }, 250); return () => clearTimeout(t); }, [typed]);
  // Decision 383: the opening view (Offered a spot) comes from the server's saved copy (worked out now after an office action
  // in this tab); while the server refreshes it, ask again in 5 s. One retry, not three.
  const q = useQuery({
    queryKey: ["office-enquiries", view, search, filters, sort, page],
    queryFn: () => {
      const v = { search, sort: sort.k, dir: sort.d, page, filters, view };
      return readOfficeList("enquiries", isDefaultListView(v), (refresh) => load({ data: { ...v, refresh } }));
    },
    placeholderData: keepPreviousData, staleTime: 30_000, retry: 1, refetchInterval: (x) => (x.state.data?.refreshing ? 5_000 : false),
  });
  const cancel = useAction(bulkCancelOfficeJobs);
  const remove = useAction(removeLeadsFn);
  const d = q.data;
  const counts = (d?.counts as { byCategory?: CategoryCounts } | undefined)?.byCategory ?? null;
  const ids = [...picked];
  const active = activeColumnFilters(filters);
  const refresh = () => { setPicked(new Set()); void qc.invalidateQueries({ queryKey: ["office-enquiries"] }); };
  const onFilter = (k: string, v: ColumnFilterValue) => { setFilters({ ...filters, [k]: v } as ColumnFilters); setPage(1); };
  const pick = (v: EnquiryView) => { setView(v); setPage(1); setPicked(new Set()); };
  const meta = view === "all" ? { label: "Every open enquiry", hint: "Everything before a spot is saved, in one list." }
    : ENQUIRY_CATEGORIES.find((x) => x.key === view)!;
  const closeReason = view === "all" ? undefined : CLOSABLE[view === "active" ? "offered" : view];
  const viewCount = counts && view !== "all" ? counts[view === "active" ? "offered" : view] : null;
  // Literal class names (Tailwind only sees whole strings). Decision 286 columns: Job · Owner · Address · Size · Insulation · Estimate · Last heard.
  const cols = "lg:grid-cols-[24px_76px_minmax(0,1.3fr)_minmax(0,1.4fr)_76px_92px_92px_minmax(0,1fr)]";
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[30px] font-extrabold leading-tight text-ink">Enquiries</h1>
          <p className="text-sm text-sub">Website leads, by where they're up to · saving a spot makes it a job</p>
        </div>
        <NewEnquiryDialog />
      </div>
      <Groups view={view} counts={counts} onPick={pick} />
      <section aria-label={meta.label} className="mt-4 min-w-0">
          {closeReason && !!viewCount && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[14px] border border-mist-line bg-mist p-3 text-sm">
              <span className="min-w-0 flex-1 text-ink">Close all {viewCount.toLocaleString("en-AU")}? They move to Jobs › Closed with “{closeReason}”, reminders stop, history is kept and any can be reopened.</span>
              <button type="button" className={btnClass("secondary")} onClick={() => setDialog("close-all")}>Close all {viewCount.toLocaleString("en-AU")}</button>
            </div>
          )}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2" data-why="decision 285 one search box; 286 headings sort and filter; 283 no priority number; Jo 26-27 Oct groups and look">
            <p className="w-full text-[13px] text-sub lg:w-auto lg:flex-1">{meta.hint}</p>
            <Input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search owner name, address or job number" aria-label="Search enquiries" className="h-11 w-full rounded-[12px] bg-paper sm:max-w-[320px]" />
            <div className="flex items-center gap-3">
              <span className="text-sm text-sub">{d ? `${d.total.toLocaleString("en-AU")} · showing ${d.rows.length}` : "Loading…"}{d?.fromCopy ? ` · checked ${checkedLabel(d.computedAt, false)}` : ""}{(q.isFetching || d?.refreshing) && d ? " · updating…" : ""}</span>
              {active.length > 0 && <button type="button" className="text-sm font-semibold text-hiv-blue underline" onClick={() => { setFilters({}); setPage(1); }}>Clear {active.length} filter{active.length === 1 ? "" : "s"}</button>}
              <ActionsMenu selected={picked.size} onPick={setDialog} actions={[{ key: "cancel", label: "Cancel", danger: true }, { key: "remove", label: "Remove (duplicate / junk)", danger: true }]} />
            </div>
          </div>
          {q.isError ? <div role="alert" className="rounded-[14px] border border-danger/40 bg-danger-soft p-4 text-sm">Enquiries could not load — this does not mean there are none. {(q.error as Error).message} <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Try again</button></div> : (
            <div className={listCard}>
              <div className={cn("hidden gap-x-3 border-b border-line bg-table-head px-5 py-2.5 lg:grid", cols)}>
                <input type="checkbox" className="h-4 w-4 self-center accent-[var(--hiv-blue)]" aria-label="Select all on this page" checked={!!d?.rows.length && d.rows.every((r) => picked.has(r.id))} onChange={(e) => setPicked(e.target.checked ? new Set(d?.rows.map((r) => r.id)) : new Set())} />
                {ENQUIRY_COLUMNS.map((c) => <ColumnHead key={c.key} col={c} sort={sort.k} dir={sort.d} value={filters[c.key]} onSort={(k, dd) => { setSort({ k, d: dd }); setPage(1); }} onFilter={onFilter} />)}
              </div>
              {!d ? <p role="status" className="p-6 text-center text-sm text-sub">Loading enquiries…</p> : d.rows.length === 0 ? <p className="p-6 text-center text-sm text-sub">{search || active.length ? "No enquiry matches that search." : "Nothing in this group."}</p> : (
                <ul>
                  {d.rows.map((r) => {
                    const open = () => setPeek({ jobId: r.id });
                    // The owner emailed and we haven't written since: the email is on the job (open it to reply).
                    const wrote = r.ownerWroteAt ? <Pill tone="green" className="shrink-0 gap-1"><Mail className="h-3 w-3" aria-hidden />Wrote to us · {ageLabel(r.ownerWroteAt, Date.now())}</Pill> : null;
                    const est = estimateLabel({ dollars: r.estimateDollars, kind: r.estimateKind });
                    const sel = (
                      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[var(--hiv-blue)] lg:mt-0" aria-label={`Select ${r.jobNumber}`} checked={picked.has(r.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(r.id); else n.delete(r.id); setPicked(n); }} />
                    );
                    return (
                      <li key={r.id} className="border-b border-[#eef1f6] last:border-b-0">
                        {/* Phone: name and price, where and what, then where it's up to; the tag only when they wrote. */}
                        <div className="flex gap-3 px-4 py-3.5 lg:hidden">
                          {sel}
                          <button type="button" onClick={open} className="grid min-w-0 flex-1 gap-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hiv-blue">
                            <span className="flex items-baseline gap-2"><strong className="truncate text-[15px] font-semibold text-ink">{r.ownerName || r.jobNumber}</strong><span className="ml-auto shrink-0 font-display text-[16px] font-bold text-ink">{est}</span></span>
                            <span className="truncate text-[13px] text-sub">{[r.suburb || r.address, r.areaM2 ? sizeLabel(r.areaM2) : null, INSULATION_WORDS[r.insulation]].filter(Boolean).join(" · ")}</span>
                            <span className="truncate text-[13px] text-sub">{r.waitingOn}</span>
                            {wrote && <span className="mt-1">{wrote}</span>}
                          </button>
                        </div>
                        {/* Computer: the decision 286 columns; the owner opens the side panel. */}
                        <div className={cn("hidden min-h-[54px] items-center gap-x-3 px-5 py-2.5 text-[14px] hover:bg-mist/50 lg:grid", cols)}>
                          {sel}
                          <span className="text-[13px] text-sub">{r.jobNumber}</span>
                          <span className="grid min-w-0"><button type="button" onClick={open} className="truncate text-left font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hiv-blue">{r.ownerName || "—"}</button><span className="flex min-w-0 items-center gap-1.5">{wrote}<span className="truncate text-xs text-sub">{r.waitingOn}</span></span></span>
                          <span className={cn("truncate", r.problems.length > 0 && "text-sub")} title={r.problems.length ? "Suburb / postcode looked up automatically" : undefined}>{r.address || "—"}</span>
                          <span>{sizeLabel(r.areaM2)}</span>
                          <span>{INSULATION_LABEL[r.insulation]}</span>
                          <span className="font-display text-[16px] font-bold">{est}</span>
                          <span className="text-[13px] text-sub">{heardLabel(r.lastHeardAt, r.lastHeardChannel)}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {d && <Pager page={d.page} totalPages={d.totalPages} total={d.total} shown={d.rows.length} onPage={setPage} />}
        </section>
      <JobPeek peek={peek} onClose={() => { setPeek(null); refresh(); }} />
      <ReasonDialog open={dialog === "cancel"} title={`Cancel ${ids.length} enquir${ids.length === 1 ? "y" : "ies"}`} description="Each moves to Jobs › Closed; reminders stop; history is kept." action="Cancel" danger presets={["Owner changed mind", "Not eligible", "No response", "Owner opted out", "Duplicate"]} onOpenChange={(v) => setDialog(v ? "cancel" : null)} run={async (reason) => { const r = await cancel({ jobIds: ids, reason }); if (!r) return false; if (r.failed.length) toast.error(`${r.done} cancelled; ${r.failed.length} not: ${r.failed[0]!.error}`); else toast.success(`${r.done} cancelled`); refresh(); return true; }} />
      <ReasonDialog open={dialog === "remove"} title={`Remove ${ids.length}`} description="For duplicates and junk. Website enquiries only; they move to Jobs › Closed › Removed / test, history kept." action="Remove" danger presets={["Duplicate", "Junk / spam", "Test"]} onOpenChange={(v) => setDialog(v ? "remove" : null)} run={async (reason) => { const r = await remove({ ids, reason }, "Removed"); refresh(); return !!r; }} />
      {closeReason && (
        <ReasonDialog open={dialog === "close-all"} title={`Close all ${(viewCount ?? 0).toLocaleString("en-AU")} in ${meta.label}`} description="Each moves to Jobs › Closed with this reason; reminders stop; history is kept and any can be reopened." action="Close them" danger presets={[closeReason]} onOpenChange={(v) => setDialog(v ? "close-all" : null)} run={async (reason) => {
          // Every id in this group as the server sees it now, closed 200 at a time with the same audited cancel.
          const all = await load({ data: { search: "", sort: "", dir: "asc", page: 1, filters: {}, view, wantIds: true } }) as { ids?: string[] };
          const list = all.ids ?? [];
          let done = 0, failed = 0;
          const t = toast.loading(`Closing 0 of ${list.length.toLocaleString("en-AU")}…`);
          for (let i = 0; i < list.length; i += 200) {
            const r = await cancel({ jobIds: list.slice(i, i + 200), reason, closeAll: true });
            if (!r) { failed += Math.min(200, list.length - i); continue; }
            done += r.done; failed += r.failed.length;
            toast.loading(`Closing ${(done + failed).toLocaleString("en-AU")} of ${list.length.toLocaleString("en-AU")}…`, { id: t });
          }
          if (failed) toast.error(`Closed ${done.toLocaleString("en-AU")}. ${failed} didn't close and stay here.`, { id: t });
          else toast.success(`Closed ${done.toLocaleString("en-AU")}`, { id: t });
          refresh();
          return true;
        }} />
      )}
    </div>
  );
}
