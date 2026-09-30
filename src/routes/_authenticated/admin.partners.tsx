import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/portal/AppShell";
import { useAction } from "@/hooks/use-me";
import { updatePartnerEnquiry } from "@/lib/portal.functions";
import { PARTNER_STATUSES, PARTNER_TYPES, PARTNER_TYPE_LABEL, type PartnerType } from "@/lib/partner.core";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Tables } from "@/integrations/supabase/types";

type Row = Tables<"partner_enquiries">;

export const Route = createFileRoute("/_authenticated/admin/partners")({
  head: () => ({ meta: [{ title: "Partner Enquiries – HI VIC Portal" }, { name: "description", content: "Property manager, installer and electrician partner enquiries." }, { property: "og:title", content: "Partner Enquiries – HI VIC Portal" }, { property: "og:description", content: "Property manager, installer and electrician partner enquiries." }] }),
  component: Partners,
});

const money = (n: number | null) => (n == null ? "—" : `$${Number(n).toFixed(2)} inc GST`);
const date = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-AU") : "—");

function Partners() {
  const [open, setOpen] = useState<Row | null>(null);
  const { data: rows = [] } = useQuery({
    queryKey: ["partner_enquiries"],
    queryFn: async () => (await supabase.from("partner_enquiries").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  const of = (t: PartnerType) => rows.filter((r) => r.enquiry_type === t);
  return (
    <AppShell wide>
      <h1 className="text-2xl font-bold tracking-tight">Partner Enquiries</h1>
      <p className="mb-4 text-sm text-muted-foreground">Businesses interested in working with HI VIC. These are not customer jobs and never appear in the Pipeline.</p>
      <Tabs defaultValue="property_manager">
        <TabsList>
          {PARTNER_TYPES.map((t) => (
            <TabsTrigger key={t} value={t}>{PARTNER_TYPE_LABEL[t]} <Badge variant="secondary" className="ml-2">{of(t).length}</Badge>
              {of(t).some((r) => r.status === "new") && <Badge className="ml-1">{of(t).filter((r) => r.status === "new").length} new</Badge>}
            </TabsTrigger>
          ))}
        </TabsList>
        {PARTNER_TYPES.map((t) => (
          <TabsContent key={t} value={t}>
            {of(t).length === 0 ? <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">No {PARTNER_TYPE_LABEL[t].toLowerCase()} enquiries yet.</p> : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {of(t).map((r) => (
                  <button key={r.id} onClick={() => setOpen(r)} className="rounded-xl border bg-card p-4 text-left text-sm hover:border-primary">
                    <div className="flex items-start justify-between gap-2"><div className="font-semibold">{r.company || r.name || "Unnamed"}</div><Badge variant="outline" className="capitalize">{r.status}</Badge></div>
                    <div className="text-muted-foreground">{r.name}{r.phone ? ` · ${r.phone}` : ""}</div>
                    <div className="truncate text-muted-foreground">{r.email}</div>
                    <div className="mt-2 space-y-0.5">
                      {t === "property_manager" && <div>Properties: {r.property_count ?? "—"}</div>}
                      {t === "installer" && <><div>CII: {r.cii_certification_status ?? "—"}</div><div>Areas: {r.service_areas?.join(", ") || "—"}</div><div>Indicative R5 rate: {r.estimated_r5_install_rate_per_sqm_inc_gst == null ? "—" : `$${r.estimated_r5_install_rate_per_sqm_inc_gst}/m² inc GST`}</div></>}
                      {t === "electrician_rec" && <><div>REC: {r.rec_registration_number ?? "—"} · ESV confirmed: {r.esv_licensed_electricians_confirmed == null ? "—" : r.esv_licensed_electricians_confirmed ? "Yes" : "No"}</div><div>Areas: {r.service_areas?.join(", ") || "—"}</div><div>PIESA fee: {money(r.estimated_piesa_fee_inc_gst)}</div><div>Services: {r.services?.join(", ") || "—"}</div></>}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">Submitted {date(r.source_created_at ?? r.created_at)}</div>
                  </button>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
      {open && <Detail row={rows.find((r) => r.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </AppShell>
  );
}

function Detail({ row, onClose }: { row: Row; onClose: () => void }) {
  const update = useAction(updatePartnerEnquiry);
  const qc = useQueryClient();
  const [notes, setNotes] = useState(row.internal_notes ?? "");
  const save = async (p: { status?: (typeof PARTNER_STATUSES)[number]; internal_notes?: string | null }, msg: string) => {
    await update({ id: row.id, ...p }, msg);
    await qc.invalidateQueries({ queryKey: ["partner_enquiries"] });
  };
  const f: [string, React.ReactNode][] = [
    ["Type", PARTNER_TYPE_LABEL[row.enquiry_type as PartnerType]], ["Company", row.company], ["Name", row.name], ["Email", row.email], ["Phone", row.phone],
    ["Submitted", date(row.source_created_at ?? row.created_at)], ["Website status", row.source_status], ["Source", row.source], ["Reference", row.external_id ?? row.submission_id],
    ["Service areas", row.service_areas?.join(", ")],
    ...(row.enquiry_type === "property_manager" ? [["Properties / portfolio", row.property_count]] as [string, React.ReactNode][] : []),
    ...(row.enquiry_type === "installer" ? [["CII certification", row.cii_certification_status], ["CII details", row.cii_certification_details], ["Indicative R5 rate", row.estimated_r5_install_rate_per_sqm_inc_gst == null ? null : `$${row.estimated_r5_install_rate_per_sqm_inc_gst}/m² inc GST`], ["Batts removal rate", row.estimated_batts_removal_rate_per_sqm_inc_gst == null ? null : `$${row.estimated_batts_removal_rate_per_sqm_inc_gst}/m² inc GST`], ["Loose fill removal rate", row.estimated_loose_fill_removal_rate_per_sqm_inc_gst == null ? null : `$${row.estimated_loose_fill_removal_rate_per_sqm_inc_gst}/m² inc GST`], ["Free quotes for HI VIC leads", row.free_quotes_for_hivic_leads == null ? null : row.free_quotes_for_hivic_leads ? "Yes" : "No"]] as [string, React.ReactNode][] : []),
    ...(row.enquiry_type === "electrician_rec" ? [["REC number", row.rec_registration_number], ["ESV-licensed electricians confirmed", row.esv_licensed_electricians_confirmed == null ? null : row.esv_licensed_electricians_confirmed ? "Yes" : "No"], ["Services", row.services?.join(", ")], ["Indicative PIESA fee", money(row.estimated_piesa_fee_inc_gst)], ["Indicative return visit fee", money(row.estimated_return_visit_fee_inc_gst)], ["Booking lead time", row.booking_lead_time], ["Weekly capacity", row.weekly_capacity]] as [string, React.ReactNode][] : []),
    ["Their message", row.notes],
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{row.company || row.name}</DialogTitle></DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {f.map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="whitespace-pre-wrap">{v ?? "—"}</dd></Fragment>)}
        </dl>
        <div>
          <div className="mb-1 text-sm font-semibold">Status</div>
          <div className="flex flex-wrap gap-2">
            {PARTNER_STATUSES.map((s) => <Button key={s} size="sm" variant={row.status === s ? "default" : "outline"} className="capitalize" onClick={() => save({ status: s }, `Marked ${s}`)}>{s}</Button>)}
          </div>
        </div>
        <div>
          <div className="mb-1 text-sm font-semibold">Internal notes</div>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
          <Button className="mt-2" size="sm" onClick={() => save({ internal_notes: notes || null }, "Notes saved")}>Save notes</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
