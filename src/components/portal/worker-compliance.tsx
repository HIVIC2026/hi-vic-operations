import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { addLicenceExpiry, myTeamCompliance, officeEecFileUrl, officeVerifyEec, officeWorkerCompliance } from "@/lib/worker-compliance.functions";
import { createWorkerCompletionLink } from "@/lib/worker-invite.functions";
import { sendCollectionNoticeLink } from "@/lib/trade-view.functions";
import { EEC_TEAM_LABEL } from "@/lib/worker-compliance.core";

type Row = { id: string; name: string; role: string; missing: ("licence_expiry" | "esc_notice")[]; warning: string | null; eec: string; licenceExpiry: string | null; selfProfile?: boolean };

/** Trade My business: "missing" items with a one-tap Add it, plus licence lapse warnings. */
export function TeamCompliancePrompts() {
  const load = useServerFn(myTeamCompliance);
  const { data } = useQuery({ queryKey: ["team-compliance"], queryFn: () => load() as Promise<Row[]> });
  const rows = (data ?? []).filter((r) => r.missing.length || r.warning || r.eec === "awaiting_check" || r.eec === "missing");
  if (!rows.length) return null;
  return (
    <section data-testid="team-compliance" className="mb-4 space-y-3">
      {rows.map((r) => <PromptCard key={r.id} r={r} />)}
    </section>
  );
}

function PromptCard({ r }: { r: Row }) {
  const [open, setOpen] = useState<null | "licence_expiry">(null);
  const qc = useQueryClient();
  const done = () => { setOpen(null); void qc.invalidateQueries({ queryKey: ["team-compliance"] }); };
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="font-semibold">{r.name}</p>
      {r.warning && <p className="mt-1 flex items-start gap-2 text-sm text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{r.warning}</p>}
      {r.missing.includes("licence_expiry") && <MissingLine label="Electrical licence expiry date: missing" onAdd={() => setOpen("licence_expiry")} />}
      {r.missing.includes("esc_notice") && <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm"><span>ESC privacy collection notice: not acknowledged — can't be lead or crew until it is.</span>{r.selfProfile ? <a href="/field/business/esc-notice" className="font-bold text-estimate-blue">Read and acknowledge</a> : <SendNoticeLinkInline workerId={r.id} />}</div>}
      {r.eec === "awaiting_check" && <p className="mt-2 text-sm text-muted-foreground">{EEC_TEAM_LABEL.awaiting_check}</p>}
      {r.eec === "verified" && <p className="mt-2 text-sm font-bold text-estimate-green">{EEC_TEAM_LABEL.verified}</p>}
      {r.eec === "missing" && <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm"><span>{EEC_TEAM_LABEL.missing}</span><CertLinkInline workerId={r.id} name={r.name} /></div>}
      {r.warning && !r.missing.length && open !== "licence_expiry" && <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen("licence_expiry")}>Add new expiry date</Button>}
      {open === "licence_expiry" && <LicenceForm workerId={r.id} onDone={done} />}
    </div>
  );
}

/** Business owner / office: text + email the person their own ESC notice link again (guarded senders; never ticks for them). */
export function SendNoticeLinkInline({ workerId }: { workerId: string }) {
  const send = useServerFn(sendCollectionNoticeLink);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (msg) return <span className="text-xs font-semibold">{msg}</span>;
  return <Button size="sm" variant="outline" className="h-10" disabled={busy} onClick={async () => { setBusy(true); try { const r = await send({ data: { workerId } }); setMsg(`Link sent: text ${r.sms.status}, email ${r.email.status}`); } catch (e) { setMsg(e instanceof Error ? e.message : "Please try again."); } finally { setBusy(false); } }}>{busy ? "Sending…" : "Send notice link"}</Button>;
}

function MissingLine({ label, onAdd }: { label: string; onAdd: () => void }) {
  return <div className="mt-2 flex items-center justify-between gap-3 text-sm"><span>{label}</span><Button size="sm" className="h-10" onClick={onAdd}>Add it</Button></div>;
}

function LicenceForm({ workerId, onDone }: { workerId: string; onDone: () => void }) {
  const save = useServerFn(addLicenceExpiry);
  const [v, setV] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  return (
    <div className="mt-3 space-y-2">
      <label className="block text-sm font-medium">Electrical licence expiry date<Input type="date" className="mt-1 h-12" value={v} onChange={(e) => setV(e.target.value)} /></label>
      <Button className="h-12 w-full" disabled={!v || busy} onClick={async () => { setBusy(true); setErr(""); try { await save({ data: { workerId, expiry: v } }); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : "Please try again."); } finally { setBusy(false); } }}>Save</Button>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

/** Office: licence flags across all trades, plus certificate checks. */
export function OfficeWorkerCompliance() {
  const load = useServerFn(officeWorkerCompliance);
  const eecFile = useServerFn(officeEecFileUrl);
  const { data, refetch } = useQuery({ queryKey: ["office-worker-compliance"], queryFn: () => load() });
  const [err, setErr] = useState("");
  if (!data?.length) return null;
  return (
    <section data-testid="office-worker-compliance" className="mb-6 rounded-2xl border border-border bg-card p-4">
      <h2 className="font-display text-lg font-bold">Licences</h2>
      <ul className="mt-3 divide-y divide-border">{data.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div><p className="font-semibold">{r.name} <span className="font-normal text-muted-foreground">· {r.role}{r.business ? ` · ${r.business}` : ""}</span></p>
            <p className="text-muted-foreground">{[...r.flags, ...(r.warning && !r.flags.length ? [r.warning] : [])].join(" · ")}</p></div>
          {(r as { escNotice?: boolean | null }).escNotice === false && <SendNoticeLinkInline workerId={r.id} />}
          {(r.eec === "awaiting_check" || (r.eec === "verified" && r.cii && !r.cii.cleared)) && <div className="flex flex-wrap items-end gap-2">
            <Button size="sm" variant="outline" onClick={async () => { const u = await eecFile({ data: { workerId: r.id } }); if (u.url) window.open(u.url, "_blank", "noopener"); }}>View certificate</Button>
            <VerifyEecInline workerId={r.id} certNumber={r.certNumber} renewal={r.eec === "verified"} onDone={async () => { setErr(""); await refetch(); }} onError={setErr} />
          </div>}
        </li>))}</ul>
      {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
    </section>
  );
}

/** Decision 153: the office verifies the CII certificate AND records its level + expiry from the check in one go — that recorded
 *  check is what clears the person for crews/offers. `renewal` = already verified but no current level (record the renewed one). */
function VerifyEecInline({ workerId, certNumber, renewal, onDone, onError }: { workerId: string; certNumber: string | null; renewal: boolean; onDone: () => Promise<void>; onError: (m: string) => void }) {
  const verifyEec = useServerFn(officeVerifyEec);
  const [number, setNumber] = useState(certNumber ?? "");
  const [level, setLevel] = useState<"full" | "provisional">("full");
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const field = "h-9 rounded-md border border-input bg-background px-2 text-sm";
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="verify-eec-inline">
      <label className="text-xs">Certificate no.<br /><input className={`${field} w-36`} aria-label="CII certificate number" value={number} onChange={(e) => setNumber(e.target.value)} /></label>
      <label className="text-xs">Level<br /><select className={field} aria-label="CII level" value={level} onChange={(e) => setLevel(e.target.value as "full" | "provisional")}><option value="full">Full</option><option value="provisional">Provisional</option></select></label>
      <label className="text-xs">Expires<br /><input type="date" className={field} aria-label="CII expiry date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
      <Button size="sm" disabled={busy || !number.trim() || !expiry} onClick={async () => { setBusy(true); try { await verifyEec({ data: { workerId, certificateNumber: number.trim(), level, expiresOn: expiry } }); await onDone(); } catch (e) { onError(e instanceof Error ? e.message : "Please try again."); } finally { setBusy(false); } }}><Check className="mr-1 h-4 w-4" />{renewal ? "Record level + expiry" : "Verify certificate"}</Button>
    </div>
  );
}

/** Business owner: generate a single-use link so the worker uploads their own EEC/CII certificate.
 *  The owner never gets an upload control — only this link action. */
export function CertLinkInline({ workerId, name, label }: { workerId: string; name: string; label?: string }) {
  const create = useServerFn(createWorkerCompletionLink);
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (link) return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <span className="break-all font-mono">{link}</span>
      <Button size="sm" variant="outline" className="h-10" onClick={() => { void navigator.clipboard.writeText(link); }}>Copy link</Button>
    </span>
  );
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" className="h-10" disabled={busy} onClick={async () => {
        setBusy(true); setErr("");
        try { const r = await create({ data: { workerId } }); setLink(`${window.location.origin}/join/${r.token}`); }
        catch (e) { setErr(e instanceof Error ? e.message : "Please try again."); }
        finally { setBusy(false); }
      }}>{busy ? "Creating…" : label ?? `Create certificate link for ${name.split(" ")[0]}`}</Button>
      {err && <span role="alert" className="text-xs text-destructive">{err}</span>}
    </span>
  );
}
