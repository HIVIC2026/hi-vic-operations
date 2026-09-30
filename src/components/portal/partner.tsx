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

/**
 * The ONE normal scheduling path for assessment visits: propose / accept / suggest another time.
 * Accepting writes the real booking through the central booking gate. Rescheduling = a new proposal.
 */
export function AppointmentPanel({ jobId, kind = "assessment" }: { jobId: string; kind?: "assessment" | "rectification" | "installation" }) {
  const load = useServerFn(coordinationState);
  const { data, refetch } = useQuery({ queryKey: ["coord", jobId], queryFn: () => load({ data: { jobId } }) });
  const propose = useAction(proposeTime);
  const respond = useAction(respondToProposal);
  const another = useAction(requestAnotherElectrician);
  const review = useAction(requestReassignment);
  const cannot = useAction(markCannotAttend);
  const [start, setStart] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [showCantAgree, setShowCantAgree] = useState(false);
  if (!data) return null;
  const open = data.proposals.filter((p) => p.kind === kind && p.status === "proposed");
  const hist = data.proposals.filter((p) => p.kind === kind && p.status !== "proposed").slice(0, data.role === "admin" ? 30 : 6);
  const booked = data.confirmed.find((b) => b.kind === kind);
  const sla = data.electrician?.sla ?? null;
  const isOwner = data.role === "owner";
  const releaseAllowed = kind === "assessment" && data.electrician && data.role !== "electrician" && (sla?.canRequestAnother || data.role === "admin");
  const statusLine = booked ? null : isOwner && sla?.state === "attention" ? sla.message : sla && sla.state !== "ok" ? sla.message : null;
  return (
    <Section title="Arrange the visit" action={<SlaPill sla={booked ? { state: "booked", message: "Confirmed" } : sla} />}>
      {!data.electrician && kind === "assessment" ? <p className="text-sm text-muted-foreground">Waiting for electrician – Home Insulation Victoria is arranging one.</p> : <>
        {data.electrician && <p className="mb-2 text-sm">Electrician: <span className="font-medium">{data.electrician.name}</span></p>}
        {booked && <p className="mb-2 rounded-lg bg-success-soft p-3 text-sm font-medium text-success">Confirmed: {when(booked.scheduled_start)}</p>}
        {statusLine && <p className={`mb-2 rounded-lg p-3 text-sm font-medium ${sla?.state === "exception" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"}`}>{statusLine}</p>}
        {data.openRequests.length > 0 && <p className="mb-2 rounded-lg bg-muted p-3 text-sm">Home Insulation Victoria is reviewing a request to change electrician. {data.role === "admin" ? `Reason: ${data.openRequests.map((r) => r.reason).join("; ")}` : "Your electrician stays booked in until Home Insulation Victoria decides."}</p>}
        {open.map((p) => (
          <div key={p.id} className="mb-2 rounded-lg border p-3">
            <div className="font-medium">{when(p.starts_at)}</div>
            <div className="text-xs text-muted-foreground">Suggested by {p.proposer_role === data.role ? "you" : p.proposer_role}{p.note ? ` – ${p.note}` : ""}</div>
            {p.proposer_role !== data.role ? <div className="mt-2 grid grid-cols-2 gap-2">
              <Button size="field" onClick={async () => { await respond({ proposalId: p.id, action: "accept" }, "Confirmed"); refetch(); }}>Accept this time</Button>
              <Button size="field" variant="outline" onClick={async () => { await respond({ proposalId: p.id, action: "decline" }, "Declined"); refetch(); }}>Decline</Button>
            </div> : <div className="mt-1 text-xs text-muted-foreground">Waiting for the other party to respond.</div>}
          </div>
        ))}
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input type="datetime-local" aria-label="Proposed time" value={start} onChange={(e) => setStart(e.target.value)} className="h-12" />
          <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="h-12" />
          <Button size="field" disabled={!start} onClick={async () => { await propose({ jobId, kind, start: new Date(start).toISOString(), note: note || null }, "Time proposed"); setStart(""); setNote(""); refetch(); }}>{open.length || booked ? "Suggest another time" : "Propose a time"}</Button>
        </div>
        {booked && <p className="mt-1 text-xs text-muted-foreground">Need to change the confirmed time? Suggest another time – the current booking stays until the new time is accepted.</p>}
        {hist.length > 0 && <details className="mt-2 text-sm" open={data.role === "admin"}><summary className="cursor-pointer text-muted-foreground">{data.role === "admin" ? "Coordination history" : "Earlier times"}</summary>{hist.map((p) => <div key={p.id}>{when(p.starts_at)} – {p.status} ({p.proposer_role}){p.response_note ? ` – ${p.response_note}` : ""}</div>)}</details>}
        {data.role === "electrician" && kind === "assessment" && !booked && (
          <div className="mt-3 border-t pt-3">
            <Textarea placeholder="Can't attend in time? Tell Home Insulation Victoria why" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button className="mt-2 w-full" variant="outline" size="field" disabled={reason.trim().length < 3} onClick={async () => { await cannot({ jobId, reason }, "Home Insulation Victoria notified"); setReason(""); refetch(); }}>I can't attend in time</Button>
          </div>
        )}
        {releaseAllowed && (
          <div className="mt-3 border-t pt-3">
            <Textarea placeholder="Why do you need another electrician?" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button className="mt-2 w-full" variant="outline" size="field" disabled={reason.trim().length < 3} onClick={async () => { await another({ jobId, reason }, "Another electrician requested"); setReason(""); refetch(); }}>Request another electrician</Button>
          </div>
        )}
        {isOwner && kind === "assessment" && data.electrician && !releaseAllowed && !booked && data.openRequests.length === 0 && (
          <div className="mt-3 border-t pt-3">
            {!showCantAgree ? <Button variant="ghost" className="w-full" onClick={() => setShowCantAgree(true)}>We can't agree on a suitable time</Button> : <>
              <Textarea placeholder="Tell Home Insulation Victoria what's happening" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button className="mt-2 w-full" variant="outline" size="field" disabled={reason.trim().length < 5} onClick={async () => { await review({ jobId, role: "electrician", reason, cantAgreeTime: true }, "Sent to Home Insulation Victoria for review"); setReason(""); setShowCantAgree(false); refetch(); }}>Ask Home Insulation Victoria to review</Button>
              <p className="mt-1 text-xs text-muted-foreground">Your electrician stays assigned while Home Insulation Victoria reviews this.</p>
            </>}
          </div>
        )}
      </>}
    </Section>
  );
}

/** Admin-only emergency path: set an assessment booking directly. Needs a reason; permanently audited. */
export function AdminBookingOverride({ jobId }: { jobId: string }) {
  const book = useAction(createBooking);
  const [start, setStart] = useState("");
  const [reason, setReason] = useState("");
  return (
    <details className="rounded-xl border border-danger/30 p-3">
      <summary className="cursor-pointer text-sm font-medium text-danger">Admin override / set booking directly</summary>
      <p className="mt-2 text-xs text-muted-foreground">Not the normal path – use only if the visit can't be arranged through proposals. Recorded permanently with your reason.</p>
      <div className="mt-2 grid gap-2">
        <Input type="datetime-local" aria-label="Override booking time" value={start} onChange={(e) => setStart(e.target.value)} className="h-10" />
        <Textarea placeholder="Reason for override (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button variant="destructive" disabled={!start || reason.trim().length < 5} onClick={async () => { await book({ jobId, kind: "assessment", start: new Date(start).toISOString(), overrideReason: reason }, "Override booking saved"); setStart(""); setReason(""); }}>Set assessment booking (override)</Button>
      </div>
    </details>
  );
}

/** Admin: offer a Home Insulation Victoria job to an approved partner installer; set relationship owner. */
export function AdminPartnerPanel({ jobId }: { jobId: string }) {
  const offer = useAction(offerToPartner);
  const withdraw = useAction(withdrawOffer);
  const setOwner = useAction(setRelationshipOwner);
  const [biz, setBiz] = useState("");
  const [reason, setReason] = useState("");
  const { data, refetch } = useQuery({
    queryKey: ["partner-panel", jobId],
    queryFn: async () => {
      const [{ data: j }, { data: offers }, { data: partners }, { data: props }] = await Promise.all([
        supabase.from("jobs").select("channel, customer_relationship_owner, source_system, external_refs, electrician_choice").eq("id", jobId).single(),
        supabase.from("partner_offers").select("id, status, offered_at, responded_at, decline_reason, businesses(name)").eq("job_id", jobId).order("offered_at", { ascending: false }),
        supabase.from("businesses").select("id, name, onboarding_status, business_type, capabilities").eq("onboarding_status", "approved"),
        supabase.from("partner_quote_proposals").select("id, version, supplier_total_ex_gst, status, change_reason, created_at, lines").eq("job_id", jobId).order("version", { ascending: false }),
      ]);
      return { j, offers: offers ?? [], partners: (partners ?? []).filter((p) => p.business_type === "eec_installer" || p.capabilities?.includes("installer")), props: props ?? [] };
    },
  });
  if (!data?.j) return null;
  const pending = data.offers.find((o) => o.status === "pending");
  return (
    <Section title="Partner & relationship">
      <dl className="grid grid-cols-2 gap-1 text-sm">
        <dt className="text-muted-foreground">Acquisition channel</dt><dd>{data.j.channel === "installer_sourced" ? "Installer-sourced" : "Home Insulation Victoria-sourced"}</dd>
        <dt className="text-muted-foreground">Customer relationship</dt><dd>{data.j.customer_relationship_owner === "installer" ? "Installer partner" : "Home Insulation Victoria"}</dd>
        {data.j.source_system && <><dt className="text-muted-foreground">Imported from</dt><dd>{data.j.source_system}</dd></>}
        {data.j.electrician_choice && <><dt className="text-muted-foreground">Electrician route</dt><dd>{data.j.electrician_choice.replace(/_/g, " ")}</dd></>}
      </dl>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input placeholder="Reason to change relationship owner" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button variant="outline" disabled={reason.trim().length < 5} onClick={async () => { await setOwner({ jobId, owner: data.j!.customer_relationship_owner === "installer" ? "hivic" : "installer", reason }, "Relationship owner changed"); setReason(""); refetch(); }}>Switch to {data.j.customer_relationship_owner === "installer" ? "Home Insulation Victoria" : "installer"}</Button>
      </div>
      {data.j.channel === "hivic_sourced" && (
        <div className="mt-3 border-t pt-3">
          <div className="mb-1 text-sm font-semibold">Offer to partner</div>
          {pending ? <div className="flex items-center justify-between text-sm"><span>Pending with {(pending.businesses as { name: string } | null)?.name}</span><Button size="sm" variant="outline" onClick={async () => { await withdraw({ offerId: pending.id }, "Offer withdrawn"); refetch(); }}>Withdraw</Button></div> : (
            <div className="flex gap-2">
              <select className="h-10 flex-1 rounded border bg-background px-2 text-sm" value={biz} onChange={(e) => setBiz(e.target.value)}><option value="">Choose approved installer…</option>{data.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <Button disabled={!biz} onClick={async () => { await offer({ jobId, businessId: biz, expiresInDays: 3 }, "Offer sent to partner dashboard"); refetch(); }}>Offer</Button>
            </div>
          )}
          {data.offers.filter((o) => o.status !== "pending").map((o) => <div key={o.id} className="text-xs text-muted-foreground">{(o.businesses as { name: string } | null)?.name}: {o.status}{o.decline_reason ? ` – ${o.decline_reason}` : ""}</div>)}
        </div>
      )}
      {data.props.length > 0 && (
        <div className="mt-3 border-t pt-3 text-sm">
          <div className="mb-1 font-semibold">Installer proposed scope / supplier price (internal)</div>
          {data.props.map((p) => <div key={p.id}>v{p.version} · ${Number(p.supplier_total_ex_gst).toFixed(2)} ex GST · {p.status}{p.change_reason ? ` – ${p.change_reason}` : ""}</div>)}
        </div>
      )}
    </Section>
  );
}

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
