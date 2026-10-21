import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { downloadOfficialDocx, getOfficialPrefill, getPiisaPanel, sendPiisaToInstaller } from "@/lib/official-forms.functions";
import { Section } from "@/components/portal/panels";
import { openFileViewer } from "@/components/portal/file-viewer";
import { AP_LEGAL_ENTITY } from "@/lib/authority";

const DUE: Record<string, string> = {
  not_scheduled: "Not scheduled", due_on_installation_day: "Due on installation day", due_today: "Due today, before work starts",
  overdue: "Overdue", passed: "Passed", stale: "Stale — needs a new PIISA", blocked: "Blocked",
};
const WHO: Record<string, string> = { installer: "Lead installer", electrician: "Electrician", office: "Office" };

/** Office view of the installation-day installer safety assessment (read-only). */
export function PiisaPanel({ jobId }: { jobId: string }) {
  const load = useServerFn(getPiisaPanel);
  const { data, error } = useQuery({ queryKey: ["piisa_panel", jobId], queryFn: () => load({ data: { jobId } }) });
  return (
    <Section title="Installer safety assessment (PIISA)">
      <p className="mb-2 text-sm"><span className="text-muted-foreground">Accredited Person:</span> <strong>{AP_LEGAL_ENTITY}</strong></p>
      {error ? <p className="text-sm text-destructive">Couldn't load the PIISA status.</p> : !data ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span><span className="text-muted-foreground">Responsible:</span> <strong>{WHO[data.responsible]}</strong></span>
            <span><span className="text-muted-foreground">Status:</span> <strong>{DUE[data.due]}</strong></span>
          </div>
          <p><span className="text-muted-foreground">Next action:</span> {data.nextAction}</p>
          {data.blockers.length > 0 && (
            <ul className="list-disc space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 pl-6 text-destructive">
              {data.blockers.map((b) => <li key={b}>{b}</li>)}
            </ul>
          )}
          {data.hazards.length > 0 && (
            <div className="space-y-1">
              <p className="font-medium">PIESA hazards (Part 7)</p>
              <ul className="space-y-1">
                {data.hazards.map((h) => (
                  <li key={h.key} className={h.resolved ? "rounded-md border p-2" : "rounded-md border border-destructive/30 bg-destructive/5 p-2"}>
                    <strong>{h.text}</strong> — {h.resolved ? "Resolved by verified electrical fixes." : h.reason}
                    {!h.resolved && <div className="text-muted-foreground">Next action: {h.nextAction}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(data.readyCheckCarryOver.beforeQuote.length > 0 || data.readyCheckCarryOver.atPiisa.length > 0) && (
            <div className="space-y-2">
              <p className="font-medium">Ready Check items the installer hasn't supplied</p>
              {data.readyCheckCarryOver.beforeQuote.length > 0 && (
                <ul className="list-disc space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 pl-6 text-destructive">
                  {data.readyCheckCarryOver.beforeQuote.map((m) => <li key={m}>{m} — settle before quoting</li>)}
                </ul>
              )}
              {data.readyCheckCarryOver.atPiisa.length > 0 && (
                <ul className="list-disc space-y-1 rounded-md border p-3 pl-6 text-muted-foreground">
                  {data.readyCheckCarryOver.atPiisa.map((m) => <li key={m}>{m} — bring with the PIISA on installation day</li>)}
                </ul>
              )}
            </div>
          )}
          <PiisaSend jobId={jobId} />
          <OfficialDocxDownload jobId={jobId} />
          {data.confirmations.length > 0 && <p className="text-xs text-muted-foreground">Held pending official/legal confirmation: {data.confirmations.join(", ")}.</p>}
        </div>
      )}
    </Section>
  );
}

const MODE: Record<string, string> = { prefill: "Filled in", reminder: "Reminder", cross_check: "Cross-check" };

/** Downloads of the filled official Word forms (PIESA / PIISA) for the job's current signed copies. */
function OfficialDocxDownload({ jobId }: { jobId: string }) {
  const run = useServerFn(downloadOfficialDocx);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const onDownload = async (key: "piesa" | "piisa") => {
    setBusy(key); setMsg(null);
    try {
      const r = await run({ data: { jobId, key } });
      openFileViewer(r.url);
      setMsg({ ok: true, text: `${key.toUpperCase()} Word form downloaded (${r.filled} fields filled${r.missed.length ? `; not filled: ${r.missed.join(", ")}` : ""}).` });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't prepare the Word form." }); }
    finally { setBusy(null); }
  };
  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">Official Word forms (filled from the signed copies)</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="h-10 rounded-md border px-3 text-sm font-medium disabled:opacity-50" onClick={() => onDownload("piesa")} disabled={busy !== null}>
          {busy === "piesa" ? "Preparing…" : "Download official PIESA (Word)"}
        </button>
        <button type="button" className="h-10 rounded-md border px-3 text-sm font-medium disabled:opacity-50" onClick={() => onDownload("piisa")} disabled={busy !== null}>
          {busy === "piisa" ? "Preparing…" : "Download official PIISA (Word)"}
        </button>
      </div>
      {msg && <p className={msg.ok ? "text-sm" : "text-sm text-destructive"} role="status">{msg.text}</p>}
    </div>
  );
}

/** Pre-fill preview and the send-to-installer action. Sending stays blocked while the PIISA is locked. */
function PiisaSend({ jobId }: { jobId: string }) {
  const loadPrefill = useServerFn(getOfficialPrefill);
  const send = useServerFn(sendPiisaToInstaller);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pre = useQuery({ queryKey: ["piisa_prefill", jobId], queryFn: () => loadPrefill({ data: { jobId, key: "piisa" } }), enabled: open });
  const onSend = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await send({ data: { jobId } });
      setMsg({ ok: true, text: r.reused ? "Safety form re-shared with the installer." : `Safety form sent to the installer.${r.skipped.length ? ` Not pre-filled: ${r.skipped.join(", ")}.` : ""}` });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't send the safety form." }); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="h-10 rounded-md border px-3 text-sm font-medium" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide pre-filled answers" : "Show pre-filled answers"}
        </button>
        <button type="button" className="h-10 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50" onClick={onSend} disabled={busy}>
          {busy ? "Sending…" : "Send safety form to installer"}
        </button>
      </div>
      {msg && <p className={msg.ok ? "text-sm" : "text-sm text-destructive"} role="status">{msg.text}</p>}
      {open && (pre.error ? <p className="text-sm text-destructive">Couldn't load the pre-filled answers.</p> : !pre.data ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <table className="w-full text-left text-sm">
          <thead className="text-muted-foreground"><tr><th className="py-1 pr-3 font-normal">Question</th><th className="py-1 pr-3 font-normal">Type</th><th className="py-1 pr-3 font-normal">Value</th><th className="py-1 font-normal">Note</th></tr></thead>
          <tbody>
            {pre.data.hints.map((h) => (
              <tr key={h.itemId} className="border-t align-top">
                <td className="py-1 pr-3 font-mono text-xs">{h.itemId}</td>
                <td className="py-1 pr-3">{MODE[h.mode]}</td>
                <td className="py-1 pr-3">{h.value ?? <span className="text-muted-foreground">Blank — answered onsite</span>}</td>
                <td className="py-1 text-muted-foreground">{h.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
