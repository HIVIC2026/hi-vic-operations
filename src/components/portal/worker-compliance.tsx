import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { addLicenceExpiry, myTeamCompliance, officeEecFileUrl, officePiisaFileUrl, officeVerifyEec, officeVerifyPiisa, officeWorkerCompliance, piisaUploadSlot, savePiisa } from "@/lib/worker-compliance.functions";
import { createWorkerCompletionLink } from "@/lib/worker-invite.functions";
import { sendCollectionNoticeLink } from "@/lib/trade-view.functions";
import { EEC_TEAM_LABEL } from "@/lib/worker-compliance.core";

type Row = { id: string; name: string; role: string; missing: ("licence_expiry" | "piisa" | "esc_notice")[]; warning: string | null; piisa: string; eec: string; licenceExpiry: string | null; selfProfile?: boolean };

/** Trade My business: "missing" items with a one-tap Add it, plus licence lapse warnings. */
export function TeamCompliancePrompts() {
  const load = useServerFn(myTeamCompliance);
  const { data } = useQuery({ queryKey: ["team-compliance"], queryFn: () => load() as Promise<Row[]> });
  const rows = (data ?? []).filter((r) => r.missing.length || r.warning || r.piisa === "awaiting_check" || r.eec === "awaiting_check" || r.eec === "missing");
  if (!rows.length) return null;
  return (
    <section data-testid="team-compliance" className="mb-4 space-y-3">
      {rows.map((r) => <PromptCard key={r.id} r={r} />)}
    </section>
  );
}

function PromptCard({ r }: { r: Row }) {
  const [open, setOpen] = useState<null | "licence_expiry" | "piisa">(null);
  const qc = useQueryClient();
  const done = () => { setOpen(null); void qc.invalidateQueries({ queryKey: ["team-compliance"] }); };
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="font-semibold">{r.name}</p>
      {r.warning && <p className="mt-1 flex items-start gap-2 text-sm text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{r.warning}</p>}
      {r.missing.includes("licence_expiry") && <MissingLine label="Electrical licence expiry date: missing" onAdd={() => setOpen("licence_expiry")} />}
      {r.missing.includes("piisa") && <MissingLine label={r.piisa === "not_done" ? "PIISA training: not done yet" : "PIISA training: missing"} onAdd={() => setOpen("piisa")} />}
      {r.missing.includes("esc_notice") && <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm"><span>ESC privacy collection notice: not acknowledged — can't be lead or crew until it is.</span>{r.selfProfile ? <a href="/field/business/esc-notice" className="font-bold text-estimate-blue">Read and acknowledge</a> : <SendNoticeLinkInline workerId={r.id} />}</div>}
      {r.piisa === "awaiting_check" && <p className="mt-2 text-sm text-muted-foreground">PIISA certificate uploaded. Our office is checking it.</p>}
      {r.eec === "awaiting_check" && <p className="mt-2 text-sm text-muted-foreground">{EEC_TEAM_LABEL.awaiting_check}</p>}
      {r.eec === "verified" && <p className="mt-2 text-sm font-bold text-estimate-green">{EEC_TEAM_LABEL.verified}</p>}
      {r.eec === "missing" && <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm"><span>{EEC_TEAM_LABEL.missing}</span><CertLinkInline workerId={r.id} name={r.name} /></div>}
      {r.warning && !r.missing.length && open !== "licence_expiry" && <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen("licence_expiry")}>Add new expiry date</Button>}
      {open === "licence_expiry" && <LicenceForm workerId={r.id} onDone={done} />}
      {open === "piisa" && <PiisaForm workerId={r.id} onDone={done} />}
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

function PiisaForm({ workerId, onDone }: { workerId: string; onDone: () => void }) {
  const slot = useServerFn(piisaUploadSlot); const save = useServerFn(savePiisa);
  const [date, setDate] = useState(""); const [file, setFile] = useState<File | null>(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!file) return;
    const type = file.type as "application/pdf" | "image/jpeg" | "image/png";
    if (!["application/pdf", "image/jpeg", "image/png"].includes(type)) { setErr("Upload a PDF, JPG or PNG."); return; }
    setBusy(true); setErr("");
    try {
      const s = await slot({ data: { workerId, contentType: type, size: file.size } });
      const { error } = await supabase.storage.from("partner-files").uploadToSignedUrl(s.path, s.token, file, { contentType: type });
      if (error) throw new Error("Upload failed. Please try again.");
      await save({ data: { workerId, completedOn: date, path: s.path } });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "Please try again."); } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 space-y-2">
      <label className="block text-sm font-medium">Date completed<Input type="date" className="mt-1 h-12" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label className="block text-sm font-medium">PIISA certificate<Input type="file" accept="application/pdf,image/jpeg,image/png" className="mt-1 h-12" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <Button className="h-12 w-full" disabled={!date || !file || busy} onClick={() => void submit()}>{busy ? "Uploading…" : "Save"}</Button>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

/** Office: licence and PIISA flags across all trades, with Verify for uploaded PIISA certificates. */
export function OfficeWorkerCompliance() {
  const load = useServerFn(officeWorkerCompliance); const verify = useServerFn(officeVerifyPiisa); const file = useServerFn(officePiisaFileUrl);
  const eecFile = useServerFn(officeEecFileUrl); const verifyEec = useServerFn(officeVerifyEec);
  const { data, refetch } = useQuery({ queryKey: ["office-worker-compliance"], queryFn: () => load() });
  const [err, setErr] = useState("");
  if (!data?.length) return null;
  return (
    <section data-testid="office-worker-compliance" className="mb-6 rounded-2xl border border-border bg-card p-4">
      <h2 className="font-display text-lg font-bold">Licences and PIISA training</h2>
      <ul className="mt-3 divide-y divide-border">{data.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div><p className="font-semibold">{r.name} <span className="font-normal text-muted-foreground">· {r.role}{r.business ? ` · ${r.business}` : ""}</span></p>
            <p className="text-muted-foreground">{[...r.flags, ...(r.warning && !r.flags.length ? [r.warning] : [])].join(" · ")}</p></div>
          {r.piisa === "awaiting_check" && <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={async () => { const u = await file({ data: { workerId: r.id } }); if (u.url) window.open(u.url, "_blank", "noopener"); }}>View certificate</Button>
            <Button size="sm" onClick={async () => { setErr(""); try { await verify({ data: { workerId: r.id } }); await refetch(); } catch (e) { setErr(e instanceof Error ? e.message : "Please try again."); } }}><Check className="mr-1 h-4 w-4" />Verify PIISA</Button>
          </div>}
          {(r as { escNotice?: boolean | null }).escNotice === false && <SendNoticeLinkInline workerId={r.id} />}
          {r.eec === "awaiting_check" && <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={async () => { const u = await eecFile({ data: { workerId: r.id } }); if (u.url) window.open(u.url, "_blank", "noopener"); }}>View certificate</Button>
            <Button size="sm" onClick={async () => { setErr(""); try { await verifyEec({ data: { workerId: r.id } }); await refetch(); } catch (e) { setErr(e instanceof Error ? e.message : "Please try again."); } }}><Check className="mr-1 h-4 w-4" />Verify certificate</Button>
          </div>}
        </li>))}</ul>
      {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
    </section>
  );
}

/** Business owner: generate a single-use link so the worker uploads their own EEC/CII certificate.
 *  The owner never gets an upload control — only this link action. */
export function CertLinkInline({ workerId, name }: { workerId: string; name: string }) {
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
      }}>{busy ? "Creating…" : `Create certificate link for ${name.split(" ")[0]}`}</Button>
      {err && <span role="alert" className="text-xs text-destructive">{err}</span>}
    </span>
  );
}
