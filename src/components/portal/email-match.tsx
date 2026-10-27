// Email row actions shared by Needs me and Enquiries (moved from the Needs me screen, Jo 26 Oct 2026).
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { OfficeSearch } from "@/components/portal/office";
import { btnClass } from "@/components/portal/kit";
import { applyEmailChange, ignoreEmailChange, matchOutlookEmail } from "@/lib/email-office.functions";
import type { NeedsRow } from "@/lib/office-needs.core";

const btn = (tone: "primary" | "secondary") => btnClass(tone, "min-h-[46px] whitespace-nowrap md:min-h-[42px]");

/** Email rows (decisions 245/247): Apply / Ignore, Match / Not a customer. Nothing changes on a job without this tap. */
/** `matchTone` lets a long list (Enquiries) show Match as a quiet button so "Review and match all" stands out. */
export function EmailActions({ row, onDone, matchTone = "primary" }: { row: NeedsRow; onDone: () => void; matchTone?: "primary" | "secondary" }) {
  const apply = useServerFn(applyEmailChange);
  const ignore = useServerFn(ignoreEmailChange);
  const match = useServerFn(matchOutlookEmail);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    // Plain words only: a server error's text can be raw JSON (design review 26 Oct); the detail goes to the console.
    try { await fn(); toast.success(ok); onDone(); } catch (e) { console.error("Needs me email action failed", e); toast.error("That didn't save. Try again, or open the job."); } finally { setBusy(false); }
  };
  if (row.kind === "email_change") return (
    <div className="grid grid-cols-2 gap-2 md:flex">
      <button type="button" disabled={busy} className={btn("primary")} onClick={() => void run(async () => {
        await apply({ data: { eventId: row.eventId! } });
        // A day change is never applied to a booking: the office rearranges it on the job's Install card.
        if (row.intent === "reschedule" && row.jobId) void navigate({ to: "/admin/jobs/$jobId", params: { jobId: row.jobId }, hash: "stage-install" });
      }, row.intent === "cancel" ? "Job cancelled" : row.intent === "reschedule" ? "Noted — rearrange the day on the job" : row.intent === "reply" ? "Marked replied" : "Applied")}>{busy ? "Saving…" : row.intent === "reply" ? "Done" : "Apply"}</button>
      <button type="button" disabled={busy} className={btn("secondary")} onClick={() => void run(() => ignore({ data: { eventId: row.eventId! } }), "Ignored")}>Ignore</button>
    </div>
  );
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2 md:flex">
        <button type="button" disabled={busy} className={btn(matchTone)} onClick={() => row.jobId && !picking ? void run(() => match({ data: { messageEventId: row.eventId!, jobId: row.jobId! } }), `Matched to ${row.jobNumber}`) : setPicking(true)}>{row.jobId ? `Match to ${row.jobNumber}` : "Match"}</button>
        <button type="button" disabled={busy} className={btn("secondary")} onClick={() => void run(() => match({ data: { messageEventId: row.eventId!, jobId: null } }), "Marked not a customer")}>Not a customer</button>
      </div>
      {row.jobId && !picking && <button type="button" className="min-h-11 text-left text-sm font-semibold text-hiv-blue underline" onClick={() => setPicking(true)}>A different job…</button>}
      {picking && <div className="w-full md:w-72"><OfficeSearch onPick={(j) => void run(() => match({ data: { messageEventId: row.eventId!, jobId: j.id } }), `Matched to ${j.jobNumber}`)} /></div>}
    </div>
  );
}

/**
 * "Review and match all" (Jo 26 Oct 2026): unmatched emails whose best guess is specific (needs-cards.core
 * confidentGuess) in one review list, all ticked; the office unticks any that look wrong and presses Match. Each match
 * is the same audited matchOutlookEmail the row's own button uses, one after another; a failure stays on the list.
 */
export function BulkMatch({ rows, onDone }: { rows: NeedsRow[]; onDone: (keys: string[]) => void }) {
  const match = useServerFn(matchOutlookEmail);
  const [open, setOpen] = useState(false);
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const [progress, setProgress] = useState<number | null>(null);
  if (rows.length === 0) return null;
  const picked = rows.filter((r) => !off.has(r.key));
  const run = async () => {
    const ok: string[] = [];
    let failed = 0;
    setProgress(0);
    for (const r of picked) {
      try { await match({ data: { messageEventId: r.eventId!, jobId: r.jobId! } }); ok.push(r.key); }
      catch (e) { console.error("Needs me bulk match failed", r.eventId, e); failed++; }
      setProgress(ok.length + failed);
    }
    if (failed) toast.error(`Matched ${ok.length}. ${failed} didn't save and ${failed === 1 ? "stays" : "stay"} on the list.`);
    else toast.success(`Matched ${ok.length} email${ok.length === 1 ? "" : "s"}`);
    setProgress(null); setOpen(false); setOff(new Set());
    onDone(ok);
  };
  return (
    <div className="grid gap-2 border-b border-line bg-mist px-4 py-3" data-why="Jo 26 Oct: match all confident best guesses after a review">
      {!open ? (
        <>
          <span className="text-sm text-ink">{rows.length} {rows.length === 1 ? "has" : "have"} a confident best guess (job number, address or the owner's full name in the email).</span>
          <button type="button" className={btn("primary")} onClick={() => setOpen(true)}>Review and match {rows.length === 1 ? "it" : `all ${rows.length}`}</button>
        </>
      ) : (
        <>
          <span className="text-sm font-semibold text-ink">Untick any that look wrong, then match.</span>
          <ul className="grid gap-1">
            {rows.map((r) => (
              <li key={r.key}>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] bg-paper px-3 py-2">
                  <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[var(--hiv-blue)]" checked={!off.has(r.key)} disabled={progress !== null} onChange={(e) => setOff((o) => { const n = new Set(o); if (e.target.checked) n.delete(r.key); else n.add(r.key); return n; })} />
                  <span className="grid min-w-0 gap-0.5 text-sm">
                    <span><strong>{r.jobNumber}</strong> {r.surname}<span className="text-sub"> · {r.guessWhy?.find((w) => /^(mentions |address |owner name )/.test(w)) ?? ""}</span></span>
                    <span className="break-words text-sub">{r.line}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2 md:flex">
            <button type="button" className={btn("primary")} disabled={picked.length === 0 || progress !== null} onClick={() => void run()}>{progress !== null ? `Matching ${progress} of ${picked.length}…` : `Match ${picked.length}`}</button>
            <button type="button" className={btn("secondary")} disabled={progress !== null} onClick={() => { setOpen(false); setOff(new Set()); }}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

