// O4 Enquiries (approved mock-up; decisions 216, 225, 228, 238, 239): every enquiry before a spot is saved, in exactly
// one of two piles — Fix details · Waiting on owner. Filters on every column, every column sortable, a visible
// priority (1 = hottest: no insulation, size known, recent contact, covered area), inline Fix details (capitalisation
// tidied + address split automatically, applied on save), New enquiry (phone), Actions ▾ Cancel / Remove.
// Gone: photo review, the "New / never contacted" pile, Quotes to check and Quote approvals links, the office tools strip.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAction } from "@/hooks/use-me";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { bulkCancelOfficeJobs, getEnquiriesList, saveEnquiryFixDetails } from "@/lib/office-screens.functions";
import { removeLeadsFn } from "@/lib/enquiry-groups.functions";
import { createEnquiry } from "@/lib/portal.functions";
import { DETAILS_PROBLEM_LABEL, fixDetailsErrors, tidyEnquiryDetails } from "@/lib/name-address-tidy.core";
import { ENQUIRY_PILES, type EnquiryPile } from "@/lib/office-jobs.core";
import { HEARD_CHIPS, INSULATION_CHIPS, INSULATION_LABEL, LAST_HEARD_LABEL, REGION_CHIPS, REGION_LABEL, SIZE_CHIPS, SIZE_LABEL, SOURCE_CHIPS, SOURCE_LABEL, type ChipFilters, type SortDir } from "@/lib/office-filters.core";
import type { EnquiryListRow } from "@/lib/office-lists.server";
import { ActionsMenu, ChipGroup, FilterPanel, Pager, ReasonDialog, SortHead, heardLabel } from "@/components/portal/office-lists";

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
          <DialogHeader><DialogTitle>New enquiry (phone)</DialogTitle><DialogDescription>Full name and address are tidied the same way as website enquiries.</DialogDescription></DialogHeader>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
            e.preventDefault();
            const out = await create({ full_name: tidy.fullName, email: f.email, phone: f.phone || null, address_line: tidy.street || f.address_line, suburb: tidy.suburb || null, postcode: tidy.postcode || null, occupancy: f.occupancy, estimated_area_m2: f.unknown || !f.area ? null : Number(f.area), area_unknown: f.unknown || !f.area, life_support: f.life === "yes", life_support_status: f.life }, "Enquiry created");
            if (out) setOpen(false);
          }}>
            <label className="text-sm font-semibold">Full name<Input value={f.full_name} onChange={set("full_name")} required className="mt-1" /></label>
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
            {tidy.problems.length > 0 && f.full_name && f.address_line && <p className="text-xs text-rose sm:col-span-2">Still to fix: {tidy.problems.map((p) => DETAILS_PROBLEM_LABEL[p]).join(", ")}.</p>}
            <button type="submit" className={cn(btn, "bg-hiv-green text-white sm:col-span-2")}>Create enquiry</button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Inline Fix details (decision 216): pre-filled with the automatic tidy; you only fill what the website couldn't. */
function FixForm({ row, onDone }: { row: EnquiryListRow; onDone: () => void }) {
  const save = useServerFn(saveEnquiryFixDetails);
  const [v, setV] = useState({ fullName: row.ownerName, street: row.street, suburb: row.suburb, postcode: row.postcode });
  const [busy, setBusy] = useState(false);
  const errors = fixDetailsErrors(v);
  return (
    <div className="border-b border-line bg-mist px-3 py-3 text-sm" id={`fix-${row.id}`}>
      <p className="mb-2 font-semibold">Fix details · {row.jobNumber} · website said “{row.websiteSaid}”</p>
      <div className="grid gap-2 sm:grid-cols-[1.2fr_1.4fr_1fr_90px_auto] sm:items-end">
        <label className="font-semibold">Full name<Input value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} className="mt-1 bg-paper" /></label>
        <label className="font-semibold">Street<Input value={v.street} onChange={(e) => setV({ ...v, street: e.target.value })} className="mt-1 bg-paper" /></label>
        <label className="font-semibold">Suburb<Input value={v.suburb} onChange={(e) => setV({ ...v, suburb: e.target.value })} className="mt-1 bg-paper" /></label>
        <label className="font-semibold">Postcode<Input value={v.postcode} inputMode="numeric" onChange={(e) => setV({ ...v, postcode: e.target.value })} className="mt-1 bg-paper" /></label>
        <button type="button" disabled={busy || errors.length > 0} className={cn(btn, "bg-hiv-green text-white")} onClick={async () => { setBusy(true); try { await save({ data: { jobId: row.id, ...v } }); toast.success("Details saved"); onDone(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); } }}>Save</button>
      </div>
      <p className="mt-2 text-xs text-sub">Capitalisation tidied and the address split automatically · you only fill what the website couldn’t{row.phone ? ` · ${row.phone}` : ""}{row.email ? ` · ${row.email}` : ""}{errors.length ? ` · still to fix: ${errors.join(", ")}` : ""}</p>
    </div>
  );
}

export function EnquiriesScreen() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const load = useServerFn(getEnquiriesList);
  const [pile, setPile] = useState<EnquiryPile>("waiting_owner");
  const [f, setF] = useState<ChipFilters>({});
  const [sort, setSort] = useState<{ k: string; d: SortDir }>({ k: "", d: "asc" });
  const [page, setPage] = useState(1);
  const [fixing, setFixing] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["office-enquiries", pile, f, sort, page], queryFn: () => load({ data: { pile, search: "", sort: sort.k, dir: sort.d, page, filters: f } }), placeholderData: keepPreviousData, staleTime: 30_000 });
  const cancel = useAction(bulkCancelOfficeJobs);
  const remove = useAction(removeLeadsFn);
  const d = q.data;
  const ids = [...picked];
  const set = (patch: Partial<ChipFilters>) => { setF({ ...f, ...patch }); setPage(1); };
  const active = !!(f.insulation?.length || f.size?.length || f.region?.length || f.source?.length || f.heard?.length);
  const total = d ? d.counts.fix_details + d.counts.waiting_owner : null;
  const refresh = () => { setPicked(new Set()); void qc.invalidateQueries({ queryKey: ["office-enquiries"] }); };
  // Literal class names (Tailwind only sees whole strings).
  const cols = "grid-cols-[28px_32px_80px_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_56px_minmax(0,1.3fr)_minmax(0,1fr)_auto]";
  const colsLg = "lg:grid-cols-[28px_32px_80px_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_56px_minmax(0,1.3fr)_minmax(0,1fr)_auto]";
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[30px] font-extrabold leading-tight text-ink">Enquiries</h1>
          <p className="text-sm text-sub">{total != null ? `${total.toLocaleString("en-AU")} open · ` : ""}every enquiry in one pile · saving a spot makes it a job · estimate-only leads are reminded automatically and close themselves.</p>
        </div>
        <NewEnquiryDialog />
      </div>
      <div className="mb-3 flex gap-1" role="tablist" aria-label="Enquiry piles" data-why="decision 239 two piles; 216 Fix details; 238 Waiting on owner">
        {ENQUIRY_PILES.map((p) => <button key={p.key} role="tab" type="button" aria-selected={pile === p.key} onClick={() => { setPile(p.key); setPage(1); setPicked(new Set()); setFixing(null); }} className={cn("rounded-[10px] px-4 py-2 text-sm font-bold", pile === p.key ? "bg-ink text-white" : "bg-paper text-sub")}>{p.label} {d ? d.counts[p.key].toLocaleString("en-AU") : ""}</button>)}
      </div>
      <FilterPanel note="Pick as many as you like · every column is sortable · 1 = hottest: no insulation, size known, recent contact, in a covered area." active={active} onClear={() => { setF({}); setPage(1); }}>
        <ChipGroup label="Insulation" options={INSULATION_CHIPS} labels={INSULATION_LABEL} value={f.insulation ?? []} onChange={(v) => set({ insulation: v })} />
        <ChipGroup label="Size" options={SIZE_CHIPS} labels={SIZE_LABEL} value={f.size ?? []} onChange={(v) => set({ size: v })} />
        <ChipGroup label="Suburb / area" options={REGION_CHIPS} labels={REGION_LABEL} value={f.region ?? []} onChange={(v) => set({ region: v })} />
        <ChipGroup label="Source" options={SOURCE_CHIPS} labels={SOURCE_LABEL} value={f.source ?? []} onChange={(v) => set({ source: v })} />
        <ChipGroup label="Last heard" options={HEARD_CHIPS} labels={LAST_HEARD_LABEL} value={f.heard ?? []} onChange={(v) => set({ heard: v })} />
      </FilterPanel>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-sub">{d ? `${ENQUIRY_PILES.find((p) => p.key === pile)!.label} · ${d.total.toLocaleString("en-AU")} · showing ${d.rows.length}` : "Loading…"}{q.isFetching && d ? " · updating…" : ""}</span>
        <ActionsMenu selected={picked.size} onPick={setDialog} actions={[{ key: "cancel", label: "Cancel", danger: true }, { key: "remove", label: "Remove (duplicate / junk)", danger: true }]} />
      </div>
      <p className="mb-2 text-xs text-sub">{pile === "fix_details" ? "Names or addresses that need a hand before anything goes out." : "Spot offered or the three questions asked · reminders are automatic · nothing for us to do until they answer."}</p>
      {q.isError ? <div role="alert" className="rounded-[14px] border border-danger/40 bg-danger-soft p-4 text-sm">Enquiries could not load — this does not mean there are none. {(q.error as Error).message} <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Try again</button></div> : (
        <div className="overflow-hidden rounded-[14px] border border-line bg-paper">
          <div className={cn("hidden gap-x-3 border-b border-line bg-mist px-3 py-2 lg:grid", cols)}>
            <input type="checkbox" aria-label="Select all on this page" checked={!!d?.rows.length && d.rows.every((r) => picked.has(r.id))} onChange={(e) => setPicked(e.target.checked ? new Set(d?.rows.map((r) => r.id)) : new Set())} />
            {([["#", "priority"], ["Job", "job"], ["Owner", "owner"], ["Street", "street"], ["Suburb", "suburb"], ["Post", "postcode"], [pile === "fix_details" ? "What they told us" : "Waiting on", pile === "fix_details" ? "told" : "waiting"], ["Last heard", "heard"]] as const).map(([l, k]) => <SortHead key={k} label={l} k={k} sort={sort.k || "priority"} dir={sort.d} onSort={(kk, dd) => { setSort({ k: kk, d: dd }); setPage(1); }} />)}
            <span />
          </div>
          {!d ? <p className="p-6 text-center text-sm text-sub">Loading enquiries…</p> : d.rows.length === 0 ? <p className="p-6 text-center text-sm text-sub">{pile === "fix_details" ? "Nothing to fix — every name and address is tidy." : "No enquiries waiting on owners."}</p> : (
            <ul>
              {d.rows.map((r) => (
                <li key={r.id}>
                  {fixing === r.id && <FixForm row={r} onDone={() => { setFixing(null); refresh(); }} />}
                  <div className={cn("grid grid-cols-[28px_32px_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-b border-line px-3 py-2.5 text-[13px] lg:items-center", colsLg)}>
                    <input type="checkbox" aria-label={`Select ${r.jobNumber}`} checked={picked.has(r.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(r.id); else n.delete(r.id); setPicked(n); }} />
                    <span className="font-bold text-ink" title="Priority: 1 = hottest">{r.priority}</span>
                    <span className="font-semibold">{r.jobNumber}</span>
                    <span className={cn("col-start-3 truncate lg:col-auto", r.problems.some((p) => p.startsWith("name")) && "text-rose")}>{r.ownerName || "—"}</span>
                    <span className={cn("col-start-3 truncate lg:col-auto", r.problems.includes("street_missing") && "text-rose")}>{r.street || "—"}</span>
                    <span className={cn("col-start-3 truncate lg:col-auto", r.problems.includes("suburb_missing") && "text-rose")}>{r.suburb || "blank"}</span>
                    <span className={cn("col-start-3 lg:col-auto", r.problems.includes("postcode_missing") && "text-rose")}>{r.postcode || "—"}</span>
                    <span className="col-start-3 min-w-0 break-words lg:col-auto">{pile === "fix_details" ? r.told : r.waitingOn}</span>
                    <span className="col-start-3 text-sub lg:col-auto">{heardLabel(r.lastHeardAt, r.lastHeardChannel)}</span>
                    <span className="col-start-3 lg:col-auto">{pile === "fix_details"
                      ? <button type="button" className={cn(btn, "border border-line bg-paper text-hiv-blue")} onClick={() => setFixing(fixing === r.id ? null : r.id)}>{fixing === r.id ? "Close" : "Fix details"}</button>
                      : <button type="button" className={cn(btn, "border border-line bg-paper text-hiv-blue")} onClick={() => void navigate({ to: "/admin/jobs/$jobId", params: { jobId: r.id } })}>Open</button>}</span>
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
