// Partner business file: onboarding checklist, details, credentials, team, electricians, bank, agreement, Xero.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAction } from "@/hooks/use-me";
import { Section } from "@/components/portal/panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  addCredential, addTeamMember, getBankDetails, getPartnerAgreementTemplate, getPartnerProfile, partnerFileUrl, partnerUploadUrl, removeTeamMember,
  saveBusiness, savePartnerMethod, reviewPartnerMethod, getMeasurementStandard, setMeasurementStandard, setBankDetails, setOnboardingStatus, setPartnerRelationship, signPartnerAgreement, syncXeroSupplier, verifyCredential,
} from "@/lib/pilot.functions";
import { credentialState, ONBOARDING_STATUSES } from "@/lib/pilot.core";
import { getHigherRates, requestHigherRates, reviewHigherRates } from "@/lib/rate-requests.functions";
import { openFileViewer } from "@/components/portal/file-viewer";
import { collectionNoticeLabel } from "@/lib/esc-collection-notice.core";
import { SendNoticeLinkInline } from "@/components/portal/worker-compliance";
import { proposeDeclaredCoverage } from "@/lib/declared-coverage-proposal.core";

const CRED_KINDS = ["public_liability_insurance", "workers_comp_insurance", "other_insurance", "electrical_licence", "rec_registration", "installer_certification", "business_registration", "other"] as const;
const csv = (a: string[] | null | undefined) => (a ?? []).join(", ");
const list = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

export function BusinessProfile({ businessId, isHivicAdmin }: { businessId?: string; isHivicAdmin: boolean }) {
  const load = useServerFn(getPartnerProfile);
  const { data, error, refetch } = useQuery({ queryKey: ["partner-profile", businessId ?? "mine"], queryFn: () => load({ data: businessId ? { businessId } : {} }) });
  if (error) return <p role="alert" className="rounded border border-danger p-3 text-sm text-danger">Business details and approval checks could not load. <Button size="sm" variant="outline" onClick={() => void refetch()}>Try again</Button></p>;
  if (data === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (data === null) return <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Your account isn't linked to a partner business yet. Ask Home Insulation Victoria to set up your business.</p>;
  const b = data.business as Record<string, unknown> & { id: string; name: string; onboarding_status: string };
  const canEdit = isHivicAdmin || data.myRole === "business_admin";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold">{b.name}</h2><Badge className="capitalize">{b.onboarding_status.replace("_", " ")}</Badge>{!!b["onboarding_notes"] && <span className="text-sm text-muted-foreground">{String(b["onboarding_notes"])}</span>}</div>
      <Checklist items={data.checklist} />
      {isHivicAdmin && (!Array.isArray(b["service_postcodes"]) || !b["service_postcodes"].length || !b["coverage_verified_at"]) && <p role="status" className="rounded border border-warning p-3 text-sm"><b>Work allocation needs verified coverage.</b> Review the business's declared service area, enter its service postcodes below and save the verified list. Declared suburbs or a travel radius do not establish verified postcode coverage.</p>}
      {isHivicAdmin && <p className="text-xs text-muted-foreground">Worker approval and current qualifications are checked separately during matching. <a className="font-semibold text-primary underline" href="/admin/workers">Review worker records</a>.</p>}
      {isHivicAdmin && <AdminControls businessId={b.id} status={b.onboarding_status} xero={{ status: String(b["xero_contact_status"] ?? ""), id: (b["xero_contact_id"] as string) ?? null, error: (b["xero_contact_error"] as string) ?? null }} onDone={refetch} />}
      {!isHivicAdmin && data.myRole === "business_admin" && ["draft", "needs_info"].includes(b.onboarding_status) && <SubmitForReview businessId={b.id} onDone={refetch} />}
      <Details b={b} canEdit={canEdit} isHivicAdmin={isHivicAdmin} onDone={refetch} />
      <Credentials businessId={b.id} creds={data.credentials} isHivicAdmin={isHivicAdmin} canAdd={canEdit || data.myRole === "member"} onDone={refetch} />
      <Team businessId={b.id} members={data.members} workers={data.workers} canEdit={canEdit} onDone={refetch} />
      {data.collectionNotice.length > 0 && <Section title="ESC privacy collection notice">
        <p className="mb-2 text-xs text-muted-foreground">Decision 130: every installer person gets their own secure link (text + email, reminders at 3 and 7 days) to read the Essential Services Commission's VEU Scheme Participant Privacy Collection Notice and acknowledge it themself. Until they do they can't be lead or crew on an installation. Approval is not blocked by this.</p>
        {data.collectionNotice.map((s) => (
          <div key={s.email} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0" data-esc-notice-state={s.state}>
            <span><b>{s.name}</b><span className="block text-xs text-muted-foreground">{s.email}{s.state === "acknowledged" && s.source ? ` · via ${s.source === "secure_link" ? "secure link" : s.source === "onboarding" ? "onboarding" : "My business"}` : ""}</span></span>
            <span className="flex items-center gap-2"><Badge variant={s.state === "acknowledged" ? "default" : "destructive"}>{collectionNoticeLabel(s)}</Badge>{isHivicAdmin && s.state !== "acknowledged" && s.workerId && <SendNoticeLinkInline workerId={s.workerId} />}</span>
          </div>
        ))}
      </Section>}
      <Electricians businessId={b.id} rels={data.relationships} options={data.electricianBusinesses.filter((e) => e.id !== b.id)} canEdit={canEdit} onDone={refetch} />
      <MeasurementMethods businessId={b.id} methods={data.measurementMethods as MethodRow[]} canEdit={canEdit} isHivicAdmin={isHivicAdmin} onDone={refetch} />
      <Section title="Rate cards">{data.rateCards.length === 0 ? <p className="text-sm text-muted-foreground">No agreed rate card on file yet – Home Insulation Victoria sets these up.</p> : data.rateCards.map((r) => <div key={r.id} className="text-sm">{r.name} · {r.kind} · v{r.version} · from {r.effective_from} {r.is_active && <Badge variant="outline">Active</Badge>}</div>)}</Section>
      <HigherRates businessId={b.id} canEdit={canEdit} isHivicAdmin={isHivicAdmin} />
      {b.onboarding_status === "approved" && <Bank businessId={b.id} canEdit={false} />}
      <Agreement businessId={b.id} agreements={data.agreements} canSign={data.myRole === "business_admin"} onDone={refetch} />
      <Section title="Xero supplier setup"><p className="text-sm">{String(b["xero_contact_status"]) === "synced" ? "Supplier contact set up in Xero." : String(b["xero_contact_status"]) === "ready" ? "Ready – Home Insulation Victoria will set up your supplier record." : "Available once your business is approved."}</p></Section>
    </div>
  );
}

function Checklist({ items }: { items: { key: string; label: string; done: boolean }[] }) {
  return <Section title="Onboarding checklist"><ul className="grid gap-1 text-sm sm:grid-cols-2">{items.map((i) => <li key={i.key} className={i.done ? "text-success" : "text-danger"}>{i.done ? "✓" : "○"} <span className="capitalize">{i.label}</span></li>)}</ul></Section>;
}

function SubmitForReview({ businessId, onDone }: { businessId: string; onDone: () => void }) {
  const set = useAction(setOnboardingStatus);
  return <Button size="field" className="w-full" onClick={async () => { await set({ businessId, status: "submitted" }, "Submitted to Home Insulation Victoria for review"); onDone(); }}>Submit for Home Insulation Victoria review</Button>;
}

function AdminControls({ businessId, status, xero, onDone }: { businessId: string; status: string; xero: { status: string; id: string | null; error: string | null }; onDone: () => void }) {
  const set = useAction(setOnboardingStatus);
  const sync = useAction(syncXeroSupplier);
  const [note, setNote] = useState("");
  return (
    <Section title="Home Insulation Victoria approval">
      <Input placeholder="Note to partner (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-2 flex flex-wrap gap-2">{ONBOARDING_STATUSES.map((s) => <Button key={s} size="sm" variant={status === s ? "default" : "outline"} className="capitalize" onClick={async () => { await set({ businessId, status: s, ...(note ? { note } : {}) }, `Marked ${s.replace("_", " ")}`); onDone(); }}>{s.replace("_", " ")}</Button>)}</div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3 text-sm">
        <span>Xero supplier: <span className="font-medium">{xero.status.replace("_", " ")}</span>{xero.id ? ` · ${xero.id}` : ""}{xero.error ? <span className="text-danger"> · {xero.error}</span> : null}</span>
        <Button size="sm" variant="outline" disabled={status !== "approved" || !!xero.id} onClick={async () => { await sync({ businessId }, "Xero supplier contact set up"); onDone(); }}>Set up in Xero</Button>
      </div>
    </Section>
  );
}

function Details({ b, canEdit, isHivicAdmin, onDone }: { b: Record<string, unknown> & { id: string; name: string }; canEdit: boolean; isHivicAdmin: boolean; onDone: () => void }) {
  const save = useAction(saveBusiness);
  const [confirmingCoverage, setConfirmingCoverage] = useState(false);
  const needsCoverage = !Array.isArray(b["service_postcodes"]) || !b["service_postcodes"].length || !b["coverage_verified_at"];
  const proposal = isHivicAdmin && needsCoverage ? proposeDeclaredCoverage(
    typeof b["declared_service_origin"] === "string" ? b["declared_service_origin"] : null,
    typeof b["declared_travel_radius_km"] === "number" ? b["declared_travel_radius_km"] : null,
  ) : null;
  const s = (k: string) => (b[k] == null ? "" : String(b[k]));
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => setF({
    name: s("name"), legal_name: s("legal_name"), trading_name: s("trading_name"), abn: s("abn"), acn: s("acn"), email: s("email"), phone: s("phone"), address: s("address"),
    service_postcodes: csv(b["service_postcodes"] as string[]), service_regions: csv(b["service_regions"] as string[]), lead_time_days: s("lead_time_days"),
    availability_notes: s("availability_notes"), rec_number: s("rec_number"), licence_number: s("licence_number"), logo_url: String((b["branding"] as { logo_url?: string } | null)?.logo_url ?? ""),
    default_comms_owner: s("default_comms_owner") || "installer", caps: csv(b["capabilities"] as string[]), gst: b["gst_registered"] === true ? "yes" : b["gst_registered"] === false ? "no" : "",
  }), [b.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const isElectrician = b["business_type"] === "rec" || ((b["capabilities"] as string[] | null) ?? []).includes("electrician");
  const field = (k: string, label: string, ph = "") => <label className="text-sm"><span className="text-muted-foreground">{label}</span><Input disabled={!canEdit} value={f[k] ?? ""} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  const onSave = async () => {
    await save({
      id: b.id, name: f["name"] ?? b.name, legal_name: f["legal_name"] || null, trading_name: f["trading_name"] || null, abn: f["abn"] || null, acn: f["acn"] || null, email: f["email"] || null, phone: f["phone"] || null, address: f["address"] || null,
      gst_registered: f["gst"] === "yes" ? true : f["gst"] === "no" ? false : null,
      service_postcodes: list(f["service_postcodes"] ?? ""), service_regions: list(f["service_regions"] ?? ""), verify_coverage: isHivicAdmin,
      lead_time_days: f["lead_time_days"] ? Number(f["lead_time_days"]) : null,
      availability_notes: f["availability_notes"] || null, rec_number: f["rec_number"] || null, licence_number: f["licence_number"] || null,
      ...(f["logo_url"] ? { branding: { logo_url: f["logo_url"] } } : {}), default_comms_owner: f["default_comms_owner"] === "hivic" ? "hivic" : "installer",
      ...(isHivicAdmin ? { capabilities: list(f["caps"] ?? "").filter((c): c is "installer" | "electrician" => c === "installer" || c === "electrician") } : {}),
    }, "Business details saved");
    onDone();
  };
  return (
    <Section title="Business details">
      {proposal && <div className="mb-3 space-y-2 text-sm">
        <p>{proposal.summary ?? proposal.reason}</p>
        {proposal.postcodes && <p className="max-h-32 overflow-y-auto break-words text-muted-foreground">{csv(proposal.postcodes)}</p>}
        {typeof b["declared_excluded_areas"] === "string" && b["declared_excluded_areas"].trim() && <p className="whitespace-pre-wrap">Exclusions: {b["declared_excluded_areas"]}</p>}
        {proposal.postcodes && <Button disabled={confirmingCoverage} onClick={async () => {
          if (!proposal.postcodes || confirmingCoverage) return;
          setConfirmingCoverage(true);
          try {
            const saved = await save({ id: b.id, name: b.name, service_postcodes: proposal.postcodes, verify_coverage: true }, "Coverage confirmed");
            if (saved) {
              setF((current) => ({ ...current, service_postcodes: csv(proposal.postcodes) }));
              onDone();
            }
          } finally { setConfirmingCoverage(false); }
        }}>Confirm coverage</Button>}
      </div>}
      <div className="grid gap-2 sm:grid-cols-2">
        {field("name", "Display name")}{field("legal_name", "Legal name")}{field("trading_name", "Trading name")}{field("abn", "ABN")}{field("acn", "ACN")}
        <label className="text-sm"><span className="text-muted-foreground">GST registered</span><select disabled={!canEdit} className="h-10 w-full rounded border bg-background px-2" value={f["gst"] ?? ""} onChange={(e) => setF({ ...f, gst: e.target.value })}><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select></label>
        {field("email", "Business email")}{field("phone", "Business phone")}{field("address", "Business address")}
        {field("service_postcodes", "Verified service postcodes", "3000, 3121, 31*")}{field("service_regions", "Declared suburbs / regions", "Brunswick, Coburg")}
        {field("lead_time_days", "Typical lead time (days)")}
        {field("rec_number", "REC number (electricians)")}{field("licence_number", "Licence number")}{field("logo_url", "Logo URL (co-branded quotes)", "https://…")}
        <label className="text-sm"><span className="text-muted-foreground">Routine customer contact on your jobs</span><select disabled={!canEdit} className="h-10 w-full rounded border bg-background px-2" value={f["default_comms_owner"]} onChange={(e) => setF({ ...f, default_comms_owner: e.target.value })}><option value="installer">We handle routine customer contact</option><option value="hivic">Home Insulation Victoria handles it</option></select></label>
        {isHivicAdmin && field("caps", "Capabilities (installer, electrician)")}
        <label className="text-sm sm:col-span-2"><span className="text-muted-foreground">Availability notes</span><Textarea disabled={!canEdit} value={f["availability_notes"] ?? ""} onChange={(e) => setF({ ...f, availability_notes: e.target.value })} /></label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Saving as Home Insulation Victoria confirms the postcode list after reviewing the partner's declared radius and exclusions. Regions alone never count as verified coverage. Payment route: full job invoiced by Home Insulation Victoria (pilot). Split invoicing is not available.</p>
      {canEdit && <Button className="mt-2" onClick={onSave}>Save details</Button>}
    </Section>
  );
}

export function Credentials({ businessId, creds, isHivicAdmin, canAdd, onDone }: { businessId: string; creds: { id: string; kind: string; label: string; number: string | null; issuer: string | null; expires_at: string | null; verification: string; document_path: string | null; critical: boolean }[]; isHivicAdmin: boolean; canAdd: boolean; onDone: () => void }) {
  const add = useAction(addCredential);
  const verify = useAction(verifyCredential);
  const upload = useServerFn(partnerUploadUrl);
  const open = useServerFn(partnerFileUrl);
  const [f, setF] = useState({ kind: "public_liability_insurance", label: "", number: "", issuer: "", expires_at: "" });
  const [file, setFile] = useState<File | null>(null);
  const submit = async () => {
    let document_path: string | null = null;
    if (file) {
      const { path, token } = await upload({ data: { businessId, folder: "credentials", fileName: file.name } });
      const { error } = await supabase.storage.from("job-files").uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (!error) document_path = path;
    }
    await add({ businessId, kind: f.kind as (typeof CRED_KINDS)[number], label: f.label || f.kind.replace(/_/g, " "), number: f.number || null, issuer: f.issuer || null, expires_at: f.expires_at || null, critical: true, document_path }, "Document added – Home Insulation Victoria will verify it");
    setF({ ...f, label: "", number: "", issuer: "", expires_at: "" }); setFile(null); onDone();
  };
  return (
    <Section title="Insurance, licences & certifications">
      <div className="space-y-2">
        {creds.length === 0 && <p className="text-sm text-muted-foreground">Nothing uploaded yet.</p>}
        {creds.map((c) => { const st = credentialState(c); return (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm">
            <div><div className="font-medium capitalize">{c.label}</div><div className="text-xs text-muted-foreground">{[c.number, c.issuer, c.expires_at && `expires ${c.expires_at}`].filter(Boolean).join(" · ")}</div></div>
            <div className="flex items-center gap-2">
              {st === "expired" ? <Badge variant="destructive">Expired</Badge> : st === "expiring" ? <Badge className="bg-warning-soft text-warning">Expiring soon</Badge> : null}
              <Badge variant="outline" className="capitalize">{c.verification}</Badge>
              {c.document_path && <Button size="sm" variant="ghost" onClick={async () => { const r = await open({ data: { businessId, path: c.document_path! } }); openFileViewer(r.url); }}>View</Button>}
              {isHivicAdmin && c.verification !== "verified" && <Button size="sm" onClick={async () => { await verify({ id: c.id, verification: "verified" }, "Verified"); onDone(); }}>Verify</Button>}
              {isHivicAdmin && c.verification !== "rejected" && <Button size="sm" variant="outline" onClick={async () => { await verify({ id: c.id, verification: "rejected" }, "Rejected"); onDone(); }}>Reject</Button>}
            </div>
          </div>
        ); })}
      </div>
      {canAdd && (
        <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-3">
          <select className="h-10 rounded border bg-background px-2 text-sm" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{CRED_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}</select>
          <Input placeholder="Name / description" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
          <Input placeholder="Policy / licence number" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
          <Input placeholder="Insurer / issuer" value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} />
          <Input type="date" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} />
          <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button className="sm:col-span-3" onClick={submit}>Add document</Button>
        </div>
      )}
    </Section>
  );
}

function Team({ businessId, members, workers, canEdit, onDone }: { businessId: string; members: { user_id: string; member_role: string; active: boolean; profiles: unknown }[]; workers: { id: string; profile_id: string | null; trade_role: "electrician" | "installer" | "property_manager"; full_legal_name: string; email: string | null; licence_number: string | null; qualification: string | null; account_status: string }[]; canEdit: boolean; onDone: () => void }) {
  const add = useAction(addTeamMember);
  const remove = useAction(removeTeamMember);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "business_admin">("member");
  const [trade, setTrade] = useState<"installer" | "electrician" | "none">("installer");
  return (
    <Section title="Team">
      {members.filter((m) => m.active).map((m) => { const p = m.profiles as { full_name: string | null; email: string | null } | null; return (
        <div key={m.user_id} className="flex items-center justify-between border-b py-1 text-sm last:border-0"><span>{p?.full_name ?? p?.email} <span className="text-muted-foreground">{m.member_role === "business_admin" ? "· Business admin" : ""}</span></span>{canEdit && <Button size="sm" variant="ghost" onClick={async () => { await remove({ businessId, userId: m.user_id }, "Removed"); onDone(); }}>Remove</Button>}</div>
      ); })}
      {workers.filter((worker) => worker.account_status !== "linked").map((worker) => (
        <div key={worker.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
          <span><b>{worker.full_legal_name}</b> · {worker.trade_role}<span className="block text-xs text-muted-foreground">{worker.email}{worker.licence_number ? ` · ${worker.licence_number}` : worker.qualification ? ` · ${worker.qualification}` : ""}</span></span>
          <Badge variant="outline">Awaiting account</Badge>
        </div>
      ))}
      {canEdit && (
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <Input className="sm:col-span-2" placeholder="Their sign-up email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="h-10 rounded border bg-background px-2 text-sm" value={trade} onChange={(e) => setTrade(e.target.value as typeof trade)}><option value="installer">Installer</option><option value="electrician">Electrician</option><option value="none">Office staff</option></select>
          <select className="h-10 rounded border bg-background px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as typeof role)}><option value="member">Team member</option><option value="business_admin">Business admin</option></select>
          <Button className="sm:col-span-4" disabled={!email.includes("@")} onClick={async () => { await add({ businessId, email, memberRole: role, tradeRole: trade }, "Team member added"); setEmail(""); onDone(); }}>Add team member</Button>
          <p className="text-xs text-muted-foreground sm:col-span-4">They need to sign in once with this email first. Trade workers must match someone listed in the approved onboarding. Team members only see assigned jobs; business admins see all business jobs.</p>
        </div>
      )}
    </Section>
  );
}

export function Electricians({ businessId, rels, options, canEdit, onDone }: { businessId: string; rels: { id: string; electrician_business_id: string; preferred: boolean; active: boolean; businesses: unknown }[]; options: { id: string; name: string; onboarding_status: string }[]; canEdit: boolean; onDone: () => void }) {
  const set = useAction(setPartnerRelationship);
  const [pick, setPick] = useState("");
  return (
    <Section title="Usual electrician">
      {rels.filter((r) => r.active).map((r) => { const e = r.businesses as { name: string; onboarding_status: string } | null; return (
        <div key={r.id} className="flex items-center justify-between border-b py-1 text-sm last:border-0">
          <span>{e?.name} <Badge variant="outline" className="ml-1 capitalize">{e?.onboarding_status.replace("_", " ")}</Badge></span>
          {canEdit && <label className="flex items-center gap-2 text-xs"><Checkbox checked={r.preferred} onCheckedChange={async (v) => { await set({ installerBusinessId: businessId, electricianBusinessId: r.electrician_business_id, preferred: !!v, active: true }, "Saved"); onDone(); }} /> Usual</label>}
        </div>
      ); })}
      {canEdit && !options.length && <p className="mt-2 text-xs text-muted-foreground">To add your own electrician, choose "Use my electrician" when you add a job and enter their name and mobile.</p>}
      {canEdit && options.length > 0 && <div className="mt-2 flex gap-2"><select className="h-10 flex-1 rounded border bg-background px-2 text-sm" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Add an electrician business…</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.onboarding_status})</option>)}</select><Button disabled={!pick} onClick={async () => { await set({ installerBusinessId: businessId, electricianBusinessId: pick, preferred: true, active: true }, "Usual electrician added"); setPick(""); onDone(); }}>Add</Button></div>}
    </Section>
  );
}

function Bank({ businessId, canEdit }: { businessId: string; canEdit: boolean }) {
  const get = useServerFn(getBankDetails);
  const save = useAction(setBankDetails);
  const { data, refetch } = useQuery({ queryKey: ["bank", businessId], queryFn: () => get({ data: { businessId } }) });
  const [f, setF] = useState({ account_name: "", bsb: "", account_number: "" });
  return (
    <Section title="Bank details">
      {data ? <p className="text-sm">{data.account_name} · BSB {data.bsb} · Acc {data.account_number}</p> : <p className="text-sm text-muted-foreground">Not provided.</p>}
      {canEdit && <div className="mt-2 grid gap-2 sm:grid-cols-4"><Input placeholder="Account name" value={f.account_name} onChange={(e) => setF({ ...f, account_name: e.target.value })} /><Input placeholder="BSB" value={f.bsb} onChange={(e) => setF({ ...f, bsb: e.target.value })} /><Input placeholder="Account number" value={f.account_number} onChange={(e) => setF({ ...f, account_number: e.target.value })} /><Button onClick={async () => { await save({ businessId, ...f }, "Bank details saved"); setF({ account_name: "", bsb: "", account_number: "" }); refetch(); }}>Save</Button></div>}
      <p className="mt-1 text-xs text-muted-foreground">Shown masked. Only Home Insulation Victoria admins can see full details.</p>
    </Section>
  );
}

function Agreement({ businessId, agreements, canSign, onDone }: { businessId: string; agreements: { version: string; signer_name: string; signed_at: string; snapshot_sha256: string }[]; canSign: boolean; onDone: () => void }) {
  const getT = useServerFn(getPartnerAgreementTemplate);
  const sign = useAction(signPartnerAgreement);
  const { data: t } = useQuery({ queryKey: ["partner-agreement-template"], queryFn: () => getT() });
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const signedCurrent = t && agreements.some((a) => a.version === t.version);
  return (
    <Section title="Home Insulation Victoria participation agreement">
      {agreements.map((a) => <p key={a.snapshot_sha256} className="text-sm">Signed v{a.version} by {a.signer_name} on {new Date(a.signed_at).toLocaleDateString("en-AU")}</p>)}
      {!t ? <p className="text-sm text-muted-foreground">Home Insulation Victoria hasn't published the agreement yet.</p> : !signedCurrent && canSign ? (
        <div className="mt-2">
          <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border bg-muted p-3 text-sm">{t.body}</div>
          <label className="mt-2 flex items-center gap-2 text-sm"><Checkbox checked={agree} onCheckedChange={(v) => setAgree(!!v)} /> I am authorised to sign for this business and agree.</label>
          <Input className="mt-2" placeholder="Type your full name to sign" value={name} onChange={(e) => setName(e.target.value)} />
          <Button className="mt-2 w-full" size="field" disabled={!agree || name.trim().length < 2} onClick={async () => { await sign({ businessId, signerName: name, agree: true }, "Agreement signed"); onDone(); }}>Sign agreement (v{t.version})</Button>
        </div>
      ) : null}
    </Section>
  );
}

type MethodRow = { id: string; version: string; method: string; description: string; tools: string | null; zone_breakdown: boolean; evidence_expected: string | null; exclusions_rule: string | null; status: string; approved_at: string | null; approval_reason: string | null };
const METHOD_OPTS = [["laser", "Laser"], ["tape", "Tape"], ["floorplan", "Floor plan"], ["other", "Other"]] as const;

/** Partner's documented measurement process. Once Home Insulation Victoria approves it, measurements using it can be reviewed faster. */
function MeasurementMethods({ businessId, methods, canEdit, isHivicAdmin, onDone }: { businessId: string; methods: MethodRow[]; canEdit: boolean; isHivicAdmin: boolean; onDone: () => void }) {
  const save = useAction(savePartnerMethod);
  const review = useAction(reviewPartnerMethod);
  const [f, setF] = useState({ version: "", method: "laser" as (typeof METHOD_OPTS)[number][0], description: "", tools: "", zone_breakdown: true, evidence_expected: "", exclusions_rule: "" });
  const [reason, setReason] = useState("");
  return (
    <Section title="Measurement method">
      <p className="mb-2 text-sm text-muted-foreground">How this business measures ceiling area. The AP measurement standard and this business's method require separate approval. Supplied measurements remain provisional until the applicable checks and job review are complete. Aerial / map estimates are never accepted as an onsite measurement.</p>
      {methods.length === 0 && <p className="text-sm">No method recorded yet.</p>}
      {methods.map((m) => (
        <div key={m.id} className="mb-2 rounded-lg border p-2 text-sm">
          <div className="flex flex-wrap items-center gap-2"><b>v{m.version}</b><span className="capitalize">{m.method}</span><Badge variant={m.status === "approved" ? "default" : "outline"} className="capitalize">{m.status}</Badge></div>
          <p className="whitespace-pre-wrap">{m.description}</p>
          {m.tools && <p className="text-xs text-muted-foreground">Tools: {m.tools}</p>}
          <p className="text-xs text-muted-foreground">Room/zone breakdown: {m.zone_breakdown ? "yes" : "no"}{m.evidence_expected ? ` · Evidence: ${m.evidence_expected}` : ""}{m.exclusions_rule ? ` · Exclusions: ${m.exclusions_rule}` : ""}</p>
          {m.approval_reason && <p className="text-xs">Home Insulation Victoria note: {m.approval_reason}</p>}
          {isHivicAdmin && m.status !== "retired" && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Input className="h-9 max-w-xs" placeholder="Reason (audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
              {m.status === "draft" && <Button size="sm" disabled={reason.trim().length < 5} onClick={async () => { await review({ id: m.id, action: "approve", reason }, "Method approved"); setReason(""); onDone(); }}>Approve method</Button>}
              <Button size="sm" variant="outline" disabled={reason.trim().length < 5} onClick={async () => { await review({ id: m.id, action: "retire", reason }, "Method retired"); setReason(""); onDone(); }}>Retire</Button>
            </div>
          )}
        </div>
      ))}
      {canEdit && (
        <details className="mt-2"><summary className="cursor-pointer text-sm font-medium">Describe a measurement method</summary>
          <div className="mt-2 grid gap-2">
            <Input placeholder="Version (e.g. 1.0)" value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} />
            <div className="grid grid-cols-4 gap-2">{METHOD_OPTS.map(([k, l]) => <Button key={k} type="button" size="sm" variant={f.method === k ? "default" : "outline"} onClick={() => setF({ ...f, method: k })}>{l}</Button>)}</div>
            <Textarea placeholder="How you measure: where you measure from, how rooms/zones are broken down, what you exclude" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            <Input placeholder="Tools (e.g. Leica laser)" value={f.tools} onChange={(e) => setF({ ...f, tools: e.target.value })} />
            <Input placeholder="Evidence you keep (sketch, photos, app export)" value={f.evidence_expected} onChange={(e) => setF({ ...f, evidence_expected: e.target.value })} />
            <Input placeholder="Excluded / non-ceiling areas rule" value={f.exclusions_rule} onChange={(e) => setF({ ...f, exclusions_rule: e.target.value })} />
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.zone_breakdown} onCheckedChange={(v) => setF({ ...f, zone_breakdown: !!v })} /> Room / zone breakdown recorded</label>
            <Button disabled={!f.version.trim() || f.description.trim().length < 10} onClick={async () => { await save({ businessId, ...f }, "Method saved for Home Insulation Victoria review"); onDone(); }}>Save for Home Insulation Victoria review</Button>
          </div>
        </details>
      )}
    </Section>
  );
}

/** Admin-only: Home Insulation Victoria AP measurement standard + optional pilot variance tolerance. */
export function MeasurementStandardCard() {
  const load = useServerFn(getMeasurementStandard);
  const { data, error, isPending, refetch } = useQuery({ queryKey: ["measurement-standard"], queryFn: () => load() });
  const set = useAction(setMeasurementStandard);
  const [version, setVersion] = useState("");
  const [tol, setTol] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => { if (data) { setVersion(data.measurement_standard_version ?? ""); setTol(data.measurement_variance_tolerance_pct == null ? "" : String(data.measurement_variance_tolerance_pct)); } }, [data]);
  if (error) return <Section title="AP measurement standard"><p role="alert" className="text-sm text-danger">The approval status could not load. <Button size="sm" variant="outline" onClick={() => void refetch()}>Try again</Button></p></Section>;
  if (isPending || !data) return <Section title="AP measurement standard"><p role="status" className="text-sm text-muted-foreground">Loading the recorded standard and approval…</p></Section>;
  const submit = async (approved: boolean) => { const result = await set({ version: version.trim() || null, approved, tolerancePct: tol === "" ? null : Number(tol), reason }, "Saved"); if (result?.ok) setReason(""); await refetch(); };
  return (
    <Section title="AP measurement standard">
      <p className="mb-2 text-sm">{data.measurement_standard_approved ? <>Approved standard <b>{data.measurement_standard_version}</b>. Measurements from partners with an approved method can be accepted after Home Insulation Victoria review.</> : <><b>AP standard not approved.</b> The AP needs to identify and approve the measurement method, evidence, exclusions and version. Installer-supplied measurements remain provisional under the existing review requirements.</>}</p>
      <p className="mb-2 text-xs text-muted-foreground">Variance tolerance is for pilot calibration only. Leave it empty until you've reviewed the pilot jobs – every variance is then shown without a pass/fail.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input placeholder="Standard version" value={version} onChange={(e) => setVersion(e.target.value)} />
        <Input type="number" inputMode="decimal" placeholder="Tolerance % (optional)" value={tol} onChange={(e) => setTol(e.target.value)} />
        <Input placeholder="Reason (audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={reason.trim().length < 5} onClick={() => submit(!!data.measurement_standard_approved)}>Save</Button>
        {!data.measurement_standard_approved ? <Button size="sm" disabled={reason.trim().length < 5 || !version.trim()} onClick={() => submit(true)}>Approve standard</Button>
          : <Button size="sm" variant="destructive" disabled={reason.trim().length < 5} onClick={() => submit(false)}>Withdraw approval</Button>}
      </div>
    </Section>
  );
}

const inc = (ex: number | null) => (ex == null ? "Not offered" : `$${(ex * 1.1).toFixed(2)}/m² inc GST`);
const num = (s: string) => (s.trim() === "" ? null : Number(s));

/** R6.0 / R7.0 / top-up supply & install rates: installer requests, office approves into a new rate card version. */
function HigherRates({ businessId, canEdit, isHivicAdmin }: { businessId: string; canEdit: boolean; isHivicAdmin: boolean }) {
  const load = useServerFn(getHigherRates);
  const { data, refetch } = useQuery({ queryKey: ["higher-rates", businessId], queryFn: () => load({ data: { businessId } }) });
  const request = useAction(requestHigherRates);
  const review = useAction(reviewHigherRates);
  const [r6, setR6] = useState(""); const [r7, setR7] = useState(""); const [topup, setTopup] = useState(""); const [vacuum, setVacuum] = useState(""); const [gst, setGst] = useState(true); const [note, setNote] = useState("");
  if (!data) return null;
  const pending = data.requests.find((r) => r.status === "pending");
  const bad = (s: string) => s.trim() !== "" && !(Number(s) > 0 && Number(s) <= 100000 && Math.round(Number(s) * 100) === Number(s) * 100);
  return (
    <Section title="Higher R-value, top-up and vacuum rates (R6.0 / R7.0 / top up to R5.0 / vacuum only)">
      <div className="space-y-1 text-sm">
        <div>R5.0 supply & install: {inc(data.r5Ex)}</div>
        <div>R6.0 supply & install: {inc(data.r6Ex)}</div>
        <div>R7.0 supply & install: {inc(data.r7Ex)}</div>
        <div>Top up to R5.0 over existing insulation: {inc(data.topupEx)}</div>
        <div>Dust / vermin vacuum only (no insulation removed): {inc(data.vacuumEx)}</div>
      </div>
      {pending && <div className="mt-3 rounded-md border bg-muted p-3 text-sm">
        <p className="font-semibold">Waiting for Home Insulation Victoria review</p>
        <p>R6.0: {pending.r6_rate == null ? "Not offered" : `$${pending.r6_rate}/m²`} · R7.0: {pending.r7_rate == null ? "Not offered" : `$${pending.r7_rate}/m²`} · Top up to R5.0: {pending.topup_r5_rate == null ? "Not offered" : `$${pending.topup_r5_rate}/m²`} · Vacuum only: {pending.vacuum_only_rate == null ? "Not offered" : `$${pending.vacuum_only_rate}/m²`} ({pending.gst_registered ? "inc GST" : "total rate"})</p>
        {isHivicAdmin && <div className="mt-2 space-y-2">
          <Input className="h-12" placeholder="Note (required to decline)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button onClick={async () => { await review({ requestId: pending.id, approve: true, note: note || undefined }, "Approved – new rate card version created"); setNote(""); refetch(); }}>Approve rates</Button>
            <Button variant="outline" onClick={async () => { await review({ requestId: pending.id, approve: false, note }, "Declined"); setNote(""); refetch(); }}>Decline</Button>
          </div>
        </div>}
      </div>}
      {canEdit && !isHivicAdmin && <div className="mt-3 space-y-2">
        <p className="text-sm text-muted-foreground">Optional — leave blank if you don't install this. Home Insulation Victoria reviews new rates before they apply.</p>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={gst} onCheckedChange={(v) => setGst(v === true)} /> GST registered (rates include GST)</label>
        <Input className="h-12" inputMode="decimal" placeholder="R6.0 supply & install $/m²" value={r6} onChange={(e) => setR6(e.target.value)} />
        <Input className="h-12" inputMode="decimal" placeholder="R7.0 supply & install $/m²" value={r7} onChange={(e) => setR7(e.target.value)} />
        <Input className="h-12" inputMode="decimal" placeholder="Top up to R5.0 over existing insulation $/m²" value={topup} onChange={(e) => setTopup(e.target.value)} />
        <Input className="h-12" inputMode="decimal" placeholder="Dust / vermin vacuum only $/m²" value={vacuum} onChange={(e) => setVacuum(e.target.value)} />
        {(bad(r6) || bad(r7) || bad(topup) || bad(vacuum)) && <p className="text-sm text-danger">Enter a valid rate per m² (above $0), or leave it blank.</p>}
        <Button size="field" className="w-full" disabled={bad(r6) || bad(r7) || bad(topup) || bad(vacuum) || !data.hasCard} onClick={async () => { await request({ businessId, r6: num(r6), r7: num(r7), topup: num(topup), vacuum: num(vacuum), gstRegistered: gst }, "Sent for review"); setR6(""); setR7(""); setTopup(""); setVacuum(""); refetch(); }}>Send rates for review</Button>
        {!data.hasCard && <p className="text-xs text-muted-foreground">Available once your agreed rate card is set up.</p>}
      </div>}
    </Section>
  );
}
