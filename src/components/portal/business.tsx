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
  saveBusiness, setBankDetails, setOnboardingStatus, setPartnerRelationship, signPartnerAgreement, syncXeroSupplier, verifyCredential,
} from "@/lib/pilot.functions";
import { credentialState, ONBOARDING_STATUSES } from "@/lib/pilot.core";

const CRED_KINDS = ["public_liability_insurance", "workers_comp_insurance", "other_insurance", "electrical_licence", "rec_registration", "installer_certification", "business_registration", "other"] as const;
const csv = (a: string[] | null | undefined) => (a ?? []).join(", ");
const list = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

export function BusinessProfile({ businessId, isHivicAdmin }: { businessId?: string; isHivicAdmin: boolean }) {
  const load = useServerFn(getPartnerProfile);
  const { data, refetch } = useQuery({ queryKey: ["partner-profile", businessId ?? "mine"], queryFn: () => load({ data: businessId ? { businessId } : {} }) });
  if (data === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (data === null) return <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Your account isn't linked to a partner business yet. Ask HI VIC to set up your business.</p>;
  const b = data.business as Record<string, unknown> & { id: string; name: string; onboarding_status: string };
  const canEdit = isHivicAdmin || data.myRole === "business_admin";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold">{b.name}</h2><Badge className="capitalize">{b.onboarding_status.replace("_", " ")}</Badge>{!!b["onboarding_notes"] && <span className="text-sm text-muted-foreground">{String(b["onboarding_notes"])}</span>}</div>
      <Checklist items={data.checklist} />
      {isHivicAdmin && <AdminControls businessId={b.id} status={b.onboarding_status} xero={{ status: String(b["xero_contact_status"] ?? ""), id: (b["xero_contact_id"] as string) ?? null, error: (b["xero_contact_error"] as string) ?? null }} onDone={refetch} />}
      {!isHivicAdmin && data.myRole === "business_admin" && ["draft", "needs_info"].includes(b.onboarding_status) && <SubmitForReview businessId={b.id} onDone={refetch} />}
      <Details b={b} canEdit={canEdit} isHivicAdmin={isHivicAdmin} onDone={refetch} />
      <Credentials businessId={b.id} creds={data.credentials} isHivicAdmin={isHivicAdmin} canAdd={canEdit || data.myRole === "member"} onDone={refetch} />
      <Team businessId={b.id} members={data.members} canEdit={canEdit} onDone={refetch} />
      <Electricians businessId={b.id} rels={data.relationships} options={data.electricianBusinesses.filter((e) => e.id !== b.id)} canEdit={canEdit} onDone={refetch} />
      <Section title="Rate cards">{data.rateCards.length === 0 ? <p className="text-sm text-muted-foreground">No agreed rate card on file yet – HI VIC sets these up.</p> : data.rateCards.map((r) => <div key={r.id} className="text-sm">{r.name} · {r.kind} · v{r.version} · from {r.effective_from} {r.is_active && <Badge variant="outline">Active</Badge>}</div>)}</Section>
      <Bank businessId={b.id} canEdit={canEdit} />
      <Agreement businessId={b.id} agreements={data.agreements} canSign={data.myRole === "business_admin"} onDone={refetch} />
      <Section title="Xero supplier setup"><p className="text-sm">{String(b["xero_contact_status"]) === "synced" ? "Supplier contact set up in Xero." : String(b["xero_contact_status"]) === "ready" ? "Ready – HI VIC will set up your supplier record." : "Available once your business is approved."}</p></Section>
    </div>
  );
}

function Checklist({ items }: { items: { key: string; label: string; done: boolean }[] }) {
  return <Section title="Onboarding checklist"><ul className="grid gap-1 text-sm sm:grid-cols-2">{items.map((i) => <li key={i.key} className={i.done ? "text-success" : "text-danger"}>{i.done ? "✓" : "○"} <span className="capitalize">{i.label}</span></li>)}</ul></Section>;
}

function SubmitForReview({ businessId, onDone }: { businessId: string; onDone: () => void }) {
  const set = useAction(setOnboardingStatus);
  return <Button size="field" className="w-full" onClick={async () => { await set({ businessId, status: "submitted" }, "Submitted to HI VIC for review"); onDone(); }}>Submit for HI VIC review</Button>;
}

function AdminControls({ businessId, status, xero, onDone }: { businessId: string; status: string; xero: { status: string; id: string | null; error: string | null }; onDone: () => void }) {
  const set = useAction(setOnboardingStatus);
  const sync = useAction(syncXeroSupplier);
  const [note, setNote] = useState("");
  return (
    <Section title="HI VIC approval">
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
  const s = (k: string) => (b[k] == null ? "" : String(b[k]));
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => setF({
    name: s("name"), legal_name: s("legal_name"), trading_name: s("trading_name"), abn: s("abn"), acn: s("acn"), email: s("email"), phone: s("phone"), address: s("address"),
    service_postcodes: csv(b["service_postcodes"] as string[]), service_regions: csv(b["service_regions"] as string[]), weekly_capacity: s("weekly_capacity"), lead_time_days: s("lead_time_days"),
    availability_notes: s("availability_notes"), rec_number: s("rec_number"), licence_number: s("licence_number"), logo_url: String((b["branding"] as { logo_url?: string } | null)?.logo_url ?? ""),
    default_comms_owner: s("default_comms_owner") || "installer", caps: csv(b["capabilities"] as string[]), gst: b["gst_registered"] === true ? "yes" : b["gst_registered"] === false ? "no" : "",
  }), [b.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const field = (k: string, label: string, ph = "") => <label className="text-sm"><span className="text-muted-foreground">{label}</span><Input disabled={!canEdit} value={f[k] ?? ""} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  const onSave = async () => {
    await save({
      id: b.id, name: f["name"] ?? b.name, legal_name: f["legal_name"] || null, trading_name: f["trading_name"] || null, abn: f["abn"] || null, acn: f["acn"] || null, email: f["email"] || null, phone: f["phone"] || null, address: f["address"] || null,
      gst_registered: f["gst"] === "yes" ? true : f["gst"] === "no" ? false : null,
      service_postcodes: list(f["service_postcodes"] ?? ""), service_regions: list(f["service_regions"] ?? ""),
      weekly_capacity: f["weekly_capacity"] ? Number(f["weekly_capacity"]) : null, lead_time_days: f["lead_time_days"] ? Number(f["lead_time_days"]) : null,
      availability_notes: f["availability_notes"] || null, rec_number: f["rec_number"] || null, licence_number: f["licence_number"] || null,
      ...(f["logo_url"] ? { branding: { logo_url: f["logo_url"] } } : {}), default_comms_owner: f["default_comms_owner"] === "hivic" ? "hivic" : "installer",
      ...(isHivicAdmin ? { capabilities: list(f["caps"] ?? "").filter((c): c is "installer" | "electrician" => c === "installer" || c === "electrician") } : {}),
    }, "Business details saved");
    onDone();
  };
  return (
    <Section title="Business details">
      <div className="grid gap-2 sm:grid-cols-2">
        {field("name", "Display name")}{field("legal_name", "Legal name")}{field("trading_name", "Trading name")}{field("abn", "ABN")}{field("acn", "ACN")}
        <label className="text-sm"><span className="text-muted-foreground">GST registered</span><select disabled={!canEdit} className="h-10 w-full rounded border bg-background px-2" value={f["gst"] ?? ""} onChange={(e) => setF({ ...f, gst: e.target.value })}><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select></label>
        {field("email", "Business email")}{field("phone", "Business phone")}{field("address", "Business address")}
        {field("service_postcodes", "Service postcodes", "3000, 3121, 31*")}{field("service_regions", "Service suburbs / regions", "Brunswick, Coburg")}
        {field("weekly_capacity", "Weekly capacity (jobs)")}{field("lead_time_days", "Typical lead time (days)")}
        {field("rec_number", "REC number (electricians)")}{field("licence_number", "Licence number")}{field("logo_url", "Logo URL (co-branded quotes)", "https://…")}
        <label className="text-sm"><span className="text-muted-foreground">Routine customer contact on your jobs</span><select disabled={!canEdit} className="h-10 w-full rounded border bg-background px-2" value={f["default_comms_owner"]} onChange={(e) => setF({ ...f, default_comms_owner: e.target.value })}><option value="installer">We handle routine customer contact</option><option value="hivic">HI VIC handles it</option></select></label>
        {isHivicAdmin && field("caps", "Capabilities (installer, electrician)")}
        <label className="text-sm sm:col-span-2"><span className="text-muted-foreground">Availability notes</span><Textarea disabled={!canEdit} value={f["availability_notes"] ?? ""} onChange={(e) => setF({ ...f, availability_notes: e.target.value })} /></label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Payment route: full job invoiced by HI VIC (pilot). Split invoicing is not available. Changing legal name, ABN, ACN, licence or REC details on an approved business sends it back to HI VIC for re-approval.</p>
      {canEdit && <Button className="mt-2" onClick={onSave}>Save details</Button>}
    </Section>
  );
}

function Credentials({ businessId, creds, isHivicAdmin, canAdd, onDone }: { businessId: string; creds: { id: string; kind: string; label: string; number: string | null; issuer: string | null; expires_at: string | null; verification: string; document_path: string | null; critical: boolean }[]; isHivicAdmin: boolean; canAdd: boolean; onDone: () => void }) {
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
    await add({ businessId, kind: f.kind as (typeof CRED_KINDS)[number], label: f.label || f.kind.replace(/_/g, " "), number: f.number || null, issuer: f.issuer || null, expires_at: f.expires_at || null, critical: true, document_path }, "Document added – HI VIC will verify it");
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
              {c.document_path && <Button size="sm" variant="ghost" onClick={async () => { const r = await open({ data: { businessId, path: c.document_path! } }); window.open(r.url, "_blank", "noopener"); }}>View</Button>}
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

function Team({ businessId, members, canEdit, onDone }: { businessId: string; members: { user_id: string; member_role: string; active: boolean; profiles: unknown }[]; canEdit: boolean; onDone: () => void }) {
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
      {canEdit && (
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <Input className="sm:col-span-2" placeholder="Their sign-up email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="h-10 rounded border bg-background px-2 text-sm" value={trade} onChange={(e) => setTrade(e.target.value as typeof trade)}><option value="installer">Installer</option><option value="electrician">Electrician</option><option value="none">Office staff</option></select>
          <select className="h-10 rounded border bg-background px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as typeof role)}><option value="member">Team member</option><option value="business_admin">Business admin</option></select>
          <Button className="sm:col-span-4" disabled={!email.includes("@")} onClick={async () => { await add({ businessId, email, memberRole: role, tradeRole: trade }, "Team member added"); setEmail(""); onDone(); }}>Add team member</Button>
          <p className="text-xs text-muted-foreground sm:col-span-4">They need a portal account first. Team members only see jobs they're assigned to; business admins see all of your business's jobs.</p>
        </div>
      )}
    </Section>
  );
}

function Electricians({ businessId, rels, options, canEdit, onDone }: { businessId: string; rels: { id: string; electrician_business_id: string; preferred: boolean; active: boolean; businesses: unknown }[]; options: { id: string; name: string; onboarding_status: string }[]; canEdit: boolean; onDone: () => void }) {
  const set = useAction(setPartnerRelationship);
  const [pick, setPick] = useState("");
  return (
    <Section title="Preferred electricians">
      {rels.filter((r) => r.active).map((r) => { const e = r.businesses as { name: string; onboarding_status: string } | null; return (
        <div key={r.id} className="flex items-center justify-between border-b py-1 text-sm last:border-0">
          <span>{e?.name} <Badge variant="outline" className="ml-1 capitalize">{e?.onboarding_status.replace("_", " ")}</Badge></span>
          {canEdit && <label className="flex items-center gap-2 text-xs"><Checkbox checked={r.preferred} onCheckedChange={async (v) => { await set({ installerBusinessId: businessId, electricianBusinessId: r.electrician_business_id, preferred: !!v, active: true }, "Saved"); onDone(); }} /> Preferred</label>}
        </div>
      ); })}
      {canEdit && <div className="mt-2 flex gap-2"><select className="h-10 flex-1 rounded border bg-background px-2 text-sm" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Add an electrician business…</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.onboarding_status})</option>)}</select><Button disabled={!pick} onClick={async () => { await set({ installerBusinessId: businessId, electricianBusinessId: pick, preferred: true, active: true }, "Preferred electrician added"); setPick(""); onDone(); }}>Add</Button></div>}
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
      <p className="mt-1 text-xs text-muted-foreground">Shown masked. Only HI VIC admins can see full details.</p>
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
    <Section title="HI VIC participation agreement">
      {agreements.map((a) => <p key={a.snapshot_sha256} className="text-sm">Signed v{a.version} by {a.signer_name} on {new Date(a.signed_at).toLocaleDateString("en-AU")}</p>)}
      {!t ? <p className="text-sm text-muted-foreground">HI VIC hasn't published the agreement yet.</p> : !signedCurrent && canSign ? (
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
