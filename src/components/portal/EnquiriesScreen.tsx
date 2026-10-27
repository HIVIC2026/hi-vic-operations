// O4 Enquiries (approved mock-up; decisions 216, 225, 228, 238, 281, 283, 285, 286): every enquiry before a spot is
// saved, in ONE list, sorted hottest first (no insulation, size known, recent contact, covered area — the rank is never
// shown, 283). Columns Job · Owner · Address · Size (m²) · Insulation · Estimate ($) · Last heard; every heading sorts
// AND filters from a small popover (286); one search box at the top (owner, address, job number); no chip panel (285).
// Suburb / postcode blanks are completed by the address lookup itself (281) — no fix-it pile, no buttons: what is
// still blank shows as stored and is edited on the job page like any other field. New enquiry (phone), Actions ▾ Cancel / Remove.
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
import { INSULATION_LABEL, type SortDir } from "@/lib/office-filters.core";
import { ENQUIRY_COLUMNS, activeColumnFilters, estimateLabel, sizeLabel, type ColumnFilters } from "@/lib/enquiry-columns.core";
import { ActionsMenu, ColumnHead, Pager, ReasonDialog, heardLabel, type ColumnFilterValue } from "@/components/portal/office-lists";

const btn = "inline-flex min-h-[38px] items-center justify-center rounded-[10px] px-3.5 text-[13px] font-bold disabled:opacity-50";

/** New enquiry (phone) — the existing guarded createEnquiry (moved here from the retired Pipeline board). */
function NewEnquiryDialog() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ full_name: "", email: "", phone: "", address_line: "", suburb: "", postcode: "", occupancy: "owner_occupied" as "owner_occupied" | "rental", area: "", unknown: false, life: "unknown" as "yes" | "no" | "unknown" });
  const create = useAction(createEnquiry);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const tidy = tidyEnquiryDetails({ fullName: f.full_name, addressLine: f.address_line, suburb: f.suburb || null, postcode: f.postcode || null });
  return (
    <>
      <button type="button" className={cn(btn, "bg-hiv-green text-white")} onClick={() => setOpen(true)}>New enquiry (phone)</button>
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
            <button type="submit" className={cn(btn, "bg-hiv-green text-white sm:col-span-2")}>Create enquiry</button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EnquiriesScreen() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const load = useServerFn(getEnquiriesList);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<{ k: string; d: SortDir }>({ k: "", d: "asc" });
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<string | null>(null);
  // Search as you type (decision 285): a short pause, then the list refreshes from page 1.
  useEffect(() => { const t = setTimeout(() => { setSearch(typed.trim()); setPage(1); }, 250); return () => clearTimeout(t); }, [typed]);
  // Decision 383: the opening view comes from the server's saved copy (worked out now after an office action in this
  // tab); while the server refreshes it, ask again in 5 s. One retry, not three.
  const q = useQuery({
    queryKey: ["office-enquiries", search, filters, sort, page],
    queryFn: () => {
      const view = { search, sort: sort.k, dir: sort.d, page, filters };
      return readOfficeList("enquiries", isDefaultListView(view), (refresh) => load({ data: { ...view, refresh } }));
    },
    placeholderData: keepPreviousData, staleTime: 30_000, retry: 1, refetchInterval: (x) => (x.state.data?.refreshing ? 5_000 : false),
  });
  const cancel = useAction(bulkCancelOfficeJobs);
  const remove = useAction(removeLeadsFn);
  const d = q.data;
  const ids = [...picked];
  const active = activeColumnFilters(filters);
  const refresh = () => { setPicked(new Set()); void qc.invalidateQueries({ queryKey: ["office-enquiries"] }); };
  const onFilter = (k: string, v: ColumnFilterValue) => { setFilters({ ...filters, [k]: v } as ColumnFilters); setPage(1); };
  // Literal class names (Tailwind only sees whole strings). Decision 286 columns: Job · Owner · Address · Size · Insulation · Estimate · Last heard.
  const cols = "grid-cols-[28px_80px_minmax(0,1fr)_minmax(0,1.6fr)_84px_90px_110px_minmax(0,1fr)_auto]";
  const colsLg = "lg:grid-cols-[28px_80px_minmax(0,1fr)_minmax(0,1.6fr)_84px_90px_110px_minmax(0,1fr)_auto]";
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[30px] font-extrabold leading-tight text-ink">Enquiries</h1>
          <p className="text-sm text-sub">{d ? `${d.counts.open.toLocaleString("en-AU")} open · ` : ""}saving a spot makes it a job</p>
        </div>
        <NewEnquiryDialog />
      </div>
      {/* Jo 27 Oct 2026 (decision 414): "Emails to match" moved to the office Emails tab. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2" data-why="decision 285 one search box; 286 headings sort and filter; 283 no priority number; 281 one list">
        <Input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search owner name, address or job number" aria-label="Search enquiries" className="h-10 w-full max-w-[420px] bg-paper" />
        <div className="flex items-center gap-3">
          <span className="text-sm text-sub">{d ? `${d.total.toLocaleString("en-AU")} · showing ${d.rows.length}` : "Loading…"}{d?.fromCopy ? ` · checked ${checkedLabel(d.computedAt, false)}` : ""}{(q.isFetching || d?.refreshing) && d ? " · updating…" : ""}</span>
          {active.length > 0 && <button type="button" className="text-sm font-semibold text-hiv-blue underline" onClick={() => { setFilters({}); setPage(1); }}>Clear {active.length} filter{active.length === 1 ? "" : "s"}</button>}
          <ActionsMenu selected={picked.size} onPick={setDialog} actions={[{ key: "cancel", label: "Cancel", danger: true }, { key: "remove", label: "Remove (duplicate / junk)", danger: true }]} />
        </div>
      </div>
      {q.isError ? <div role="alert" className="rounded-[14px] border border-danger/40 bg-danger-soft p-4 text-sm">Enquiries could not load — this does not mean there are none. {(q.error as Error).message} <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Try again</button></div> : (
        <div className="overflow-hidden rounded-[14px] border border-line bg-paper">
          <div className={cn("hidden gap-x-3 border-b border-line bg-mist px-3 py-2 lg:grid", cols)}>
            <input type="checkbox" aria-label="Select all on this page" checked={!!d?.rows.length && d.rows.every((r) => picked.has(r.id))} onChange={(e) => setPicked(e.target.checked ? new Set(d?.rows.map((r) => r.id)) : new Set())} />
            {ENQUIRY_COLUMNS.map((c) => <ColumnHead key={c.key} col={c} sort={sort.k} dir={sort.d} value={filters[c.key]} onSort={(k, dd) => { setSort({ k, d: dd }); setPage(1); }} onFilter={onFilter} />)}
            <span />
          </div>
          {!d ? <p role="status" className="p-6 text-center text-sm text-sub">Loading enquiries…</p> : d.rows.length === 0 ? <p className="p-6 text-center text-sm text-sub">{search || active.length ? "No enquiry matches that search." : "No open enquiries."}</p> : (
            <ul>
              {d.rows.map((r) => (
                <li key={r.id}>
                  <div className={cn("grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-b border-line px-3 py-2.5 text-[13px] lg:items-center", colsLg)}>
                    <input type="checkbox" aria-label={`Select ${r.jobNumber}`} checked={picked.has(r.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(r.id); else n.delete(r.id); setPicked(n); }} />
                    <span className="font-semibold">{r.jobNumber}</span>
                    <span className="col-start-2 truncate lg:col-auto">{r.ownerName || "—"}</span>
                    <span className={cn("col-start-2 truncate lg:col-auto", r.problems.length > 0 && "text-sub")} title={r.problems.length ? "Suburb / postcode looked up automatically" : undefined}>{r.address || "—"}</span>
                    <span className="col-start-2 lg:col-auto">{sizeLabel(r.areaM2)}</span>
                    <span className="col-start-2 lg:col-auto">{INSULATION_LABEL[r.insulation]}</span>
                    <span className="col-start-2 lg:col-auto">{estimateLabel({ dollars: r.estimateDollars, kind: r.estimateKind })}</span>
                    <span className="col-start-2 text-sub lg:col-auto">{heardLabel(r.lastHeardAt, r.lastHeardChannel)}</span>
                    <span className="col-start-2 lg:col-auto"><button type="button" className={cn(btn, "border border-line bg-paper text-hiv-blue")} onClick={() => void navigate({ to: "/admin/jobs/$jobId", params: { jobId: r.id } })}>Open</button></span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {d && <Pager page={d.page} totalPages={d.totalPages} total={d.total} shown={d.rows.length} onPage={setPage} />}
      <ReasonDialog open={dialog === "cancel"} title={`Cancel ${ids.length} enquir${ids.length === 1 ? "y" : "ies"}`} description="Each moves to Jobs › Closed; reminders stop; history is kept (decision 227)." action="Cancel" danger presets={["Owner changed mind", "Not eligible", "No response", "Duplicate"]} onOpenChange={(v) => setDialog(v ? "cancel" : null)} run={async (reason) => { const r = await cancel({ jobIds: ids, reason }); if (!r) return false; if (r.failed.length) toast.error(`${r.done} cancelled; ${r.failed.length} not: ${r.failed[0]!.error}`); else toast.success(`${r.done} cancelled`); refresh(); return true; }} />
      <ReasonDialog open={dialog === "remove"} title={`Remove ${ids.length}`} description="For duplicates and junk. Website enquiries only; they move to Jobs › Closed › Removed / test, history kept." action="Remove" danger presets={["Duplicate", "Junk / spam", "Test"]} onOpenChange={(v) => setDialog(v ? "remove" : null)} run={async (reason) => { const r = await remove({ ids, reason }, "Removed"); refresh(); return !!r; }} />
    </div>
  );
}
