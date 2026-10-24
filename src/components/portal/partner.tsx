// Job-level pilot panels: electrician choice, appointment coordination, partner offers, partner price proposal.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAction } from "@/hooks/use-me";
import { Section } from "@/components/portal/panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  chooseElectrician, coordinationState, electricianOptions, markCannotAttend, offerToPartner, proposeTime, requestAnotherElectrician,
  respondToProposal, setRelationshipOwner, submitPartnerProposal, withdrawOffer,
} from "@/lib/pilot.functions";
import { createBooking, requestReassignment } from "@/lib/portal.functions";
import { EXTRA_CATEGORIES, supplierTotal, type PartnerLine } from "@/lib/pilot.core";

const when = (s: string) => new Date(s).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const slaTone: Record<string, string> = { ok: "bg-muted text-foreground", attention: "bg-warning-soft text-warning", exception: "bg-danger-soft text-danger", booked: "bg-success-soft text-success" };

export function SlaPill({ sla }: { sla: { state: string; message: string } | null }) {
  if (!sla) return null;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${slaTone[sla.state] ?? ""}`}>{sla.message}</span>;
}

/** Installer (or admin) chooses how the electrician is found. Never auto-selects. */
export function ElectricianChoicePanel({ jobId }: { jobId: string }) {
  const load = useServerFn(electricianOptions);
  const choose = useAction(chooseElectrician);
  const { data, refetch } = useQuery({ queryKey: ["elec-options", jobId], queryFn: () => load({ data: { jobId } }) });
  const [mode, setMode] = useState<"preferred" | "approved_other" | "nominated" | "hivic_organise">("preferred");
  const [pick, setPick] = useState<{ biz: string; user?: string } | null>(null);
  const [nom, setNom] = useState({ contact_name: "", business_name: "", email: "", phone: "", licence_number: "" });
  if (!data) return <Section title="Electrician"><p className="text-sm text-muted-foreground">Loading options…</p></Section>;
  const list = data.ranked.filter((r) => (mode === "preferred" ? r.preferred : mode === "approved_other" ? !r.preferred : false));
  const submit = async () => {
    if (mode === "nominated") await choose({ jobId, choice: mode, nomination: { ...nom, nominated_for: "installer", business_name: nom.business_name || null, email: nom.email || null, phone: nom.phone || null, licence_number: nom.licence_number || null } }, "Electrician nominated – Home Insulation Victoria will onboard them");
    else if (mode === "hivic_organise") await choose({ jobId, choice: mode }, "Home Insulation Victoria will organise an electrician");
    else if (pick) await choose({ jobId, choice: mode, businessId: pick.biz, ...(pick.user ? { userId: pick.user } : {}) }, "Electrician assigned");
    refetch();
  };
  return (
    <Section title="Choose the electrician">
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([["preferred", "My preferred electrician"], ["approved_other", "Another Home Insulation Victoria electrician"], ["nominated", "Nominate an electrician"], ["hivic_organise", "Home Insulation Victoria organise one"]] as const).map(([k, l]) => (
          <Button key={k} size="field" variant={mode === k ? "default" : "outline"} className="h-auto whitespace-normal py-2 text-sm" onClick={() => { setMode(k); setPick(null); }}>{l}</Button>
        ))}
      </div>
      {(mode === "preferred" || mode === "approved_other") && (
        <div className="space-y-2">
          {list.length === 0 && <p className="text-sm text-muted-foreground">{mode === "preferred" ? "No preferred electricians saved yet – add them on your business profile." : "No other electricians available."}</p>}
          {list.map((r) => (
            <div key={r.id} className={`rounded-lg border p-3 ${pick?.biz === r.id ? "border-primary" : ""} ${r.eligible ? "" : "opacity-60"}`}>
              <div className="flex items-center justify-between gap-2"><div className="font-medium">{r.name}</div>{r.eligible ? <Badge variant="outline">{r.inArea ? "In area" : "Out of area"}</Badge> : <Badge variant="destructive">Not available</Badge>}</div>
              <div className="text-xs text-muted-foreground">{r.blocker ?? r.reasons.join(" · ")}</div>
              {r.eligible && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.people.length === 0 ? <span className="text-xs text-muted-foreground">No electrician accounts in this business yet.</span> :
                    r.people.map((p) => <Button key={p.id} size="sm" variant={pick?.user === p.id ? "default" : "outline"} onClick={() => setPick({ biz: r.id, user: p.id })}>{p.name}</Button>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {mode === "nominated" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="Electrician name *" value={nom.contact_name} onChange={(e) => setNom({ ...nom, contact_name: e.target.value })} />
          <Input placeholder="Business name" value={nom.business_name} onChange={(e) => setNom({ ...nom, business_name: e.target.value })} />
          <Input placeholder="Email" value={nom.email} onChange={(e) => setNom({ ...nom, email: e.target.value })} />
          <Input placeholder="Phone" value={nom.phone} onChange={(e) => setNom({ ...nom, phone: e.target.value })} />
          <Input placeholder="Licence number" value={nom.licence_number} onChange={(e) => setNom({ ...nom, licence_number: e.target.value })} />
          <p className="text-xs text-muted-foreground sm:col-span-2">They must complete Home Insulation Victoria onboarding before doing any compliance work. No invitation is sent while customer communications are switched off.</p>
        </div>
      )}
      {mode === "hivic_organise" && <p className="text-sm text-muted-foreground">Home Insulation Victoria will match an approved electrician for this area.</p>}
      <Button className="mt-3 w-full" size="field" disabled={(mode === "preferred" || mode === "approved_other") ? !pick?.user : mode === "nominated" ? nom.contact_name.trim().length < 2 : false} onClick={submit}>Confirm</Button>
      {data.nominations.length > 0 && <div className="mt-3 text-sm">{data.nominations.map((n) => <div key={n.id}>Nominated: {n.contact_name}{n.business_name ? ` (${n.business_name})` : ""} – <span className="text-muted-foreground">{n.status.replace(/_/g, " ")}</span></div>)}</div>}
    </Section>
  );
}

// "Arrange the visit" (propose/accept/decline) was removed 24 Oct 2026 (decisions 52/61/80, audit removal 2).
/** Admin-only emergency path (decision 220): set the PIESA (assessment) or Ready Check visit directly. Needs a reason; permanently audited. */
export function AdminBookingOverride({ jobId, kind = "assessment" }: { jobId: string; kind?: "assessment" | "ready_check" }) {
  const book = useAction(createBooking);
  const [start, setStart] = useState("");
  const [reason, setReason] = useState("");
  const visit = kind === "ready_check" ? "Ready Check" : "assessment";
  return (
    <details className="rounded-xl border border-danger/30 p-3" open={kind === "ready_check" || undefined}>
      <summary className="cursor-pointer text-sm font-medium text-danger">Admin override / set booking directly</summary>
      <p className="mt-2 text-xs text-muted-foreground">Not the normal path – use only if the visit can't be arranged through proposals. Recorded permanently with your reason.</p>
      <div className="mt-2 grid gap-2">
        <Input type="datetime-local" aria-label="Override booking time" value={start} onChange={(e) => setStart(e.target.value)} className="h-10" />
        <Textarea placeholder="Reason for override (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button variant="destructive" disabled={!start || reason.trim().length < 5} onClick={async () => { await book({ jobId, kind, start: new Date(start).toISOString(), overrideReason: reason }, "Override booking saved"); setStart(""); setReason(""); }}>Set {visit} booking (override)</Button>
      </div>
    </details>
  );
}

// "Partner & relationship" / "Offer to partner" was removed 24 Oct 2026 (decisions 49/51/157, audit removals 3 and 9).
/** Assigned installer proposes scope/supplier price using their rate card + property extras. */
export function PartnerProposalForm({ jobId }: { jobId: string }) {
  const submit = useAction(submitPartnerProposal);
  const { data: prev, refetch } = useQuery({ queryKey: ["my-proposal", jobId], queryFn: async () => (await supabase.from("partner_quote_proposals").select("version, lines, supplier_total_ex_gst, created_at").eq("job_id", jobId).eq("status", "submitted").maybeSingle()).data });
  const blank: PartnerLine = { description: "", category: "installation", unit: "m2", quantity: 0, supplier_unit_ex_gst: 0, justification: "" };
  const [lines, setLines] = useState<PartnerLine[]>([blank]);
  const [reason, setReason] = useState("");
  const set = (i: number, p: Partial<PartnerLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <Section title="Your proposed scope & price">
      <p className="mb-2 text-xs text-muted-foreground">Your supplier price (ex GST). Home Insulation Victoria prepares the customer quote; the customer never sees these figures.</p>
      {prev && <p className="mb-2 text-sm">Current: v{prev.version} · ${Number(prev.supplier_total_ex_gst).toFixed(2)} ex GST</p>}
      {lines.map((l, i) => (
        <div key={i} className="mb-2 grid gap-2 rounded-lg border p-2 sm:grid-cols-6">
          <Input className="sm:col-span-2" placeholder="Description" value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
          <select className="h-10 rounded border bg-background px-2 text-sm" value={l.category} onChange={(e) => set(i, { category: e.target.value })}>{["installation", ...EXTRA_CATEGORIES].map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select>
          <Input type="number" placeholder="Qty" value={l.quantity || ""} onChange={(e) => set(i, { quantity: Number(e.target.value) })} />
          <Input placeholder="Unit" value={l.unit} onChange={(e) => set(i, { unit: e.target.value })} />
          <Input type="number" placeholder="$ ex GST / unit" value={l.supplier_unit_ex_gst || ""} onChange={(e) => set(i, { supplier_unit_ex_gst: Number(e.target.value) })} />
          {(l.category === "other" || l.category === "difficult_access") && <Input className="sm:col-span-6" placeholder="Why is this needed?" value={l.justification ?? ""} onChange={(e) => set(i, { justification: e.target.value })} />}
        </div>
      ))}
      <div className="flex items-center justify-between"><Button variant="outline" size="sm" onClick={() => setLines([...lines, blank])}>Add line</Button><span className="text-sm font-medium">Total ${supplierTotal(lines).toFixed(2)} ex GST</span></div>
      {prev && <Input className="mt-2" placeholder="Reason for the change (required)" value={reason} onChange={(e) => setReason(e.target.value)} />}
      <Button className="mt-2 w-full" size="field" onClick={async () => { const r = await submit({ jobId, lines: lines.map((l) => ({ ...l, code: l.code ?? null, justification: l.justification || null })), notes: null, reason: reason || null }, "Proposal sent to Home Insulation Victoria"); if (r) { setReason(""); refetch(); } }}>Send to Home Insulation Victoria</Button>
    </Section>
  );
}
