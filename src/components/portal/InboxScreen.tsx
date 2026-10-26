// Office Inbox (Jo 26 Oct 2026: "the emails shouldn't sit in enquiries, they should sit in inboxes"). All email work in
// one place, read like a mail app (who sent it, the subject, the opening lines):
// - emails the Outlook sync couldn't put on a job: Match (to the best guess or another job) / Not a customer
//   (decision 247), "Review and match all" for confident guesses, and Not a customer for several ticked emails;
// - owner requests read from a matched email (decisions 245/386): Apply / Ignore (or Done), moved here from Needs me.
// Nothing is sent to anyone. One search box. Phone: tap an email to open it in place. Computer: list left, email right.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Paperclip } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { matchOutlookEmail } from "@/lib/email-office.functions";
import { INBOX_QUERY_KEY, useInboxEmails } from "@/hooks/use-inbox";
import type { InboxRow } from "@/lib/inbox.core";
import { bulkMatchable, confidentGuess } from "@/lib/needs-cards.core";
import { ageLabel } from "@/lib/office-needs.core";
import { BulkMatch, EmailActions } from "@/components/portal/email-match";
import { PageHeader, Pill, btnClass } from "@/components/portal/kit";

type Show = "all" | "match" | "requests";
const sender = (r: InboxRow) => r.mail.fromName || r.mail.from || "Unknown sender";
const initial = (r: InboxRow) => (sender(r).trim()[0] ?? "?").toUpperCase();

export function InboxScreen() {
  const q = useInboxEmails();
  const qc = useQueryClient();
  const [show, setShow] = useState<Show>("all");
  const [find, setFind] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const refresh = () => { setPicked(new Set()); void qc.invalidateQueries({ queryKey: INBOX_QUERY_KEY }); };
  const rows = q.data ?? [];
  const toMatch = rows.filter((r) => r.kind === "email_unmatched");
  const requests = rows.filter((r) => r.kind === "email_change");
  const needle = find.trim().toLowerCase();
  const shown = (show === "match" ? toMatch : show === "requests" ? requests : rows)
    .filter((r) => !needle || [r.mail.fromName, r.mail.from, r.mail.subject, r.mail.snippet, r.jobNumber, r.mail.ownerName, r.mail.address].join(" ").toLowerCase().includes(needle));
  const current = shown.find((r) => r.key === open) ?? null;
  const now = Date.now();

  return (
    <div>
      <PageHeader title="Inbox" sub={q.isPending ? "Loading…" : q.isError ? "Emails couldn't load" : rows.length ? [toMatch.length ? `${toMatch.length} to put on a job` : "", requests.length ? `${requests.length} owner request${requests.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") : "Every email has a home."} />
      {q.isError ? (
        <div role="alert" className="rounded-[14px] border border-danger/40 bg-danger-soft p-4 text-sm">The Inbox couldn't load. This doesn't mean it's empty. <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Try again</button></div>
      ) : q.isPending ? (
        <p role="status" className="rounded-[18px] border border-line bg-paper p-6 text-center text-sm text-sub">Loading emails…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-[18px] border border-line bg-paper p-8 text-center">
          <p className="font-display text-lg font-bold text-ink">Inbox clear</p>
          <p className="mt-1 text-sm text-sub">Every email from Outlook is on a job or marked not a customer, and no owner request is waiting.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          <BulkMatch rows={bulkMatchable(toMatch)} onDone={refresh} className="grid gap-2 rounded-[18px] border border-success/30 bg-mint p-4 md:flex md:flex-wrap md:items-center md:justify-between" />
          <div className="grid gap-4 lg:grid-cols-[420px_minmax(0,1fr)] lg:items-start">
            <section aria-label="Emails" className="overflow-hidden rounded-[18px] border border-line bg-paper">
              <div className="grid gap-2 border-b border-line p-2">
                <Input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search sender, subject or job number" aria-label="Search the Inbox" className="h-10 bg-paper" />
                <div className="flex gap-1 rounded-[11px] bg-mist p-1" aria-label="Show">
                  {([["all", `All ${rows.length}`], ["match", `To match ${toMatch.length}`], ["requests", `Owner requests ${requests.length}`]] as const).map(([k, label]) => (
                    <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)} className={cn("min-h-10 rounded-[9px] px-3 text-[13px] font-semibold", show === k ? "bg-paper text-ink shadow-sm" : "text-sub hover:text-ink")}>{label}</button>
                  ))}
                </div>
              </div>
              {picked.size > 0 && <NotCustomers rows={rows.filter((r) => picked.has(r.key))} onDone={refresh} onClear={() => setPicked(new Set())} />}
              {shown.length === 0 ? <p className="p-6 text-center text-sm text-sub">{needle ? "No email matches that search." : "Nothing here."}</p> : (
                <ul>
                  {shown.map((r) => {
                    const isOpen = r.key === open;
                    return (
                      <li key={r.key} className="border-b border-line last:border-b-0">
                        <div className={cn("flex gap-3 px-3 py-3", isOpen && "bg-mist lg:shadow-[inset_3px_0_0_var(--hiv-blue)]")}>
                          {r.kind === "email_unmatched"
                            ? <input type="checkbox" className="mt-2.5 h-4 w-4 shrink-0 accent-[var(--hiv-blue)]" aria-label={`Pick the email from ${sender(r)}`} checked={picked.has(r.key)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(r.key); else n.delete(r.key); return n; })} />
                            : <span aria-hidden className="w-4 shrink-0" />}
                          <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.key)} className="flex min-w-0 flex-1 gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hiv-blue">
                            <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mist font-bold text-hiv-blue">{initial(r)}</span>
                            <span className="grid min-w-0 flex-1 gap-0.5">
                              <span className="flex items-baseline gap-2"><strong className="truncate text-[14px] text-ink">{sender(r)}</strong><span className="ml-auto shrink-0 text-xs text-sub">{ageLabel(r.since, now)}</span></span>
                              <span className="truncate text-[14px] font-semibold text-ink">{r.mail.subject || "(no subject)"}</span>
                              {r.mail.snippet && <span className="truncate text-[13px] text-sub">{r.mail.snippet}</span>}
                              <span className="flex items-center gap-1.5">{r.kind === "email_change" ? <Pill tone="rose">{requestLabel(r)} · {r.jobNumber}</Pill> : r.jobId ? <Pill tone="green">Best guess {r.jobNumber}{r.surname ? ` · ${r.surname}` : ""}</Pill> : <Pill>No guess</Pill>}{r.mail.hasAttachments && <Paperclip className="h-3.5 w-3.5 text-sub" aria-label="Has attachments" />}</span>
                            </span>
                          </button>
                        </div>
                        {isOpen && <div className="border-t border-line bg-mist px-3 pb-4 pt-3 lg:hidden"><MailDetail row={r} onDone={refresh} /></div>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <article aria-label="Selected email" className="hidden rounded-[18px] border border-line bg-paper p-6 lg:sticky lg:top-24 lg:block">
              {current ? <MailDetail row={current} onDone={refresh} big /> : <p className="py-16 text-center text-sm text-sub">Pick an email on the left to read it and deal with it.</p>}
            </article>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Owner asks to cancel" etc.: the request half of the row's line (office-needs.core CHANGE_LINE). */
const requestLabel = (r: InboxRow) => r.line.split(" · ")[0] ?? "Owner request";

function MailDetail({ row, onDone, big = false }: { row: InboxRow; onDone: () => void; big?: boolean }) {
  const when = new Date(row.since).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" });
  const why = (row.guessWhy ?? []).join(", ");
  return (
    <div className="grid gap-4">
      {big && (
        <header className="grid gap-1">
          <h2 className="font-display text-[21px] font-bold text-ink">{row.mail.subject || "(no subject)"}</h2>
          <p className="text-sm text-sub">{row.mail.fromName ? `${row.mail.fromName} · ` : ""}{row.mail.from ?? "unknown address"} · {when}</p>
        </header>
      )}
      {!big && <p className="text-xs text-sub">{row.mail.from ?? "unknown address"} · {when}</p>}
      {row.mail.snippet ? (
        <div className="rounded-[14px] border border-line bg-paper p-4 text-sm leading-relaxed text-ink">
          <p className="whitespace-pre-line break-words">{row.mail.snippet}{row.mail.snippet.length >= 300 ? "…" : ""}</p>
          <p className="mt-2 text-xs text-sub">The first lines of the email. The whole email is in Outlook{row.mail.hasAttachments ? ", with its attachments" : ""}.</p>
        </div>
      ) : <p className="text-sm text-sub">No preview was saved for this email. Open it in Outlook to read it.</p>}
      {row.kind === "email_change" ? (
        <div className="grid gap-3 rounded-[14px] border border-rose/30 bg-pink p-4">
          <p className="text-sm font-bold text-ink">{requestLabel(row)}</p>
          <p className="text-[13px] text-sub">On {row.jobNumber}{row.mail.ownerName ? ` · ${row.mail.ownerName}` : ""}{row.mail.address ? ` · ${row.mail.address}` : ""}. The email is already on the job. Apply makes the change on the job; Ignore leaves the job as it is.</p>
          <EmailActions row={row} onDone={onDone} />
        </div>
      ) : (
      <div className={cn("grid gap-3 rounded-[14px] border p-4", row.jobId ? "border-success/30 bg-mint" : "border-line bg-paper")}>
        {row.jobId ? (
          <>
            <p className="text-sm font-bold text-ink">Best guess: {row.jobNumber}{row.mail.ownerName ? ` · ${row.mail.ownerName}` : ""}{row.mail.address ? ` · ${row.mail.address}` : ""}</p>
            {why && <p className="text-[13px] text-sub">Why: {why}.{confidentGuess(row) ? "" : " Check before matching: this guess is a weak one."}</p>}
          </>
        ) : <p className="text-sm text-ink">No job looks like a match. Match it to a job yourself, or mark it not a customer (a supplier, a partner, a newsletter).</p>}
        <EmailActions row={row} onDone={onDone} />
      </div>
      )}
      <p className="text-xs text-sub">{row.kind === "email_change" ? "Nothing is sent to the owner from here." : "Matching puts the email on the job's history. Nothing is sent to anyone."}</p>
    </div>
  );
}

/** Ticked emails → Not a customer, one audited call each; a failure stays in the Inbox. */
function NotCustomers({ rows, onDone, onClear }: { rows: InboxRow[]; onDone: () => void; onClear: () => void }) {
  const match = useServerFn(matchOutlookEmail);
  const [progress, setProgress] = useState<number | null>(null);
  const run = async () => {
    let ok = 0, failed = 0;
    setProgress(0);
    for (const r of rows) {
      try { await match({ data: { messageEventId: r.eventId!, jobId: null } }); ok++; }
      catch (e) { console.error("Inbox not a customer failed", r.eventId, e); failed++; }
      setProgress(ok + failed);
    }
    if (failed) toast.error(`Marked ${ok}. ${failed} didn't save and ${failed === 1 ? "stays" : "stay"} in the Inbox.`);
    else toast.success(`Marked ${ok} not a customer`);
    setProgress(null);
    onDone();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-table-head px-3 py-2 text-sm">
      <strong className="text-ink">{rows.length} picked</strong>
      <button type="button" className="text-sm font-semibold text-hiv-blue underline" disabled={progress !== null} onClick={onClear}>Clear</button>
      <button type="button" className={btnClass("secondary", "ml-auto min-h-10")} disabled={progress !== null} onClick={() => void run()}>{progress !== null ? `Marking ${progress} of ${rows.length}…` : `Not customers (${rows.length})`}</button>
    </div>
  );
}
