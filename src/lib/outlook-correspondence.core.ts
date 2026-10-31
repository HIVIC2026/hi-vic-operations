// Pure Outlook correspondence rules: message normalising, safe job matching, portal-duplicate detection,
// "not proceeding" intent detection and the auto-close policy. No I/O — tested in tests/outlook-correspondence.test.ts.

export type GraphAddress = { emailAddress?: { address?: string | null; name?: string | null } | null } | null;
export type GraphMessage = {
  id: string; conversationId?: string | null; internetMessageId?: string | null; subject?: string | null;
  body?: { contentType?: string | null; content?: string | null } | null; bodyPreview?: string | null;
  from?: GraphAddress; sender?: GraphAddress; toRecipients?: GraphAddress[] | null; ccRecipients?: GraphAddress[] | null;
  receivedDateTime?: string | null; sentDateTime?: string | null; hasAttachments?: boolean | null; isDraft?: boolean | null;
};
export type AttachmentRef = { id: string; name: string; contentType: string | null; size: number | null; isInline: boolean };
/** An attachment as preserved for the job: the original metadata plus where the actual file was stored. */
export type StoredAttachmentRef = AttachmentRef & { path: string | null; storedAt: string | null; skipped: string | null; contentHash?: string | null };

export const ATTACHMENT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_MAX_MESSAGE_BYTES = 40 * 1024 * 1024;

/** Safe storage filename: keep the extension, strip anything path-like or exotic, bound the length. */
export function safeAttachmentName(name: string): string {
  const clean = name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(-120);
  return clean || "attachment";
}

/** Stable short identity for one attachment (mailbox + full message id + full attachment id). Sanitising
 *  and truncating provider ids can make different attachments look alike; this key is computed from the
 *  full identity, so their storage paths can never collide. */
export function attachmentIdentityKey(mailbox: string, messageId: string, attachmentId: string): string {
  const s = `${mailbox.toLowerCase()}|${messageId}|${attachmentId}`;
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) { h ^= BigInt(s.charCodeAt(i)); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, "0");
}

/** Deterministic private path, unique per attachment identity; the identity key (not the provider id)
 *  makes the path collision-proof. */
export function attachmentStoragePath(prefix: string, identityKey: string, index: number, name: string): string {
  const safePrefix = prefix.replace(/[^\w.\-]+/g, "_") || "unmatched";
  const key = identityKey.replace(/[^\w.\-]+/g, "_").slice(0, 32) || "0";
  return `correspondence/${safePrefix}/${key}/${index + 1}-${safeAttachmentName(name)}`;
}

/** Which attachments to store and which to skip, with a visible reason. Unknown sizes count as zero against the budget. */
export function planAttachments(
  refs: AttachmentRef[],
  maxFileBytes = ATTACHMENT_MAX_FILE_BYTES,
  maxMessageBytes = ATTACHMENT_MAX_MESSAGE_BYTES,
): { store: AttachmentRef[]; skipped: { ref: AttachmentRef; reason: string }[] } {
  const store: AttachmentRef[] = [];
  const skipped: { ref: AttachmentRef; reason: string }[] = [];
  let total = 0;
  for (const ref of refs) {
    const size = typeof ref.size === "number" && ref.size >= 0 ? ref.size : null;
    if (size !== null && size > maxFileBytes) {
      skipped.push({ ref, reason: `over the ${Math.round(maxFileBytes / 1048576)} MB per-file limit` });
      continue;
    }
    if (size !== null && total + size > maxMessageBytes) {
      skipped.push({ ref, reason: "over the per-message attachment budget" });
      continue;
    }
    total += size ?? 0;
    store.push(ref);
  }
  return { store, skipped };
}
/** Our own email domains: never treated as the homeowner side. */
export const OUR_DOMAINS = ["homeinsulationvictoria.com.au"];

export type MailMessage = {
  providerMessageId: string; threadId: string | null; internetMessageId: string | null; direction: "inbound" | "outbound";
  from: string | null; fromName: string | null; to: string[]; cc: string[]; subject: string | null; body: string; at: string;
  hasAttachments: boolean; attachments: AttachmentRef[];
};

const addr = (a: GraphAddress | undefined) => (a?.emailAddress?.address ?? "").trim().toLowerCase() || null;

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Direction comes from the sender: our mailbox (or domain) sending = outbound. */
export function normaliseMessage(m: GraphMessage, mailbox: string, ourDomains: string[] = []): MailMessage | null {
  if (m.isDraft) return null;
  const from = addr(m.from) ?? addr(m.sender);
  const box = mailbox.toLowerCase();
  const ours = (e: string | null) => !!e && (e === box || ourDomains.some((d) => e.endsWith(`@${d.toLowerCase()}`)));
  const raw = m.body?.content ?? m.bodyPreview ?? "";
  const body = (m.body?.contentType ?? "").toLowerCase() === "html" ? htmlToText(raw) : raw.trim();
  const direction = ours(from) ? "outbound" : "inbound";
  return {
    providerMessageId: m.id, threadId: m.conversationId ?? null, internetMessageId: m.internetMessageId ?? null, direction,
    from, fromName: m.from?.emailAddress?.name ?? null,
    to: (m.toRecipients ?? []).map(addr).filter((x): x is string => !!x), cc: (m.ccRecipients ?? []).map(addr).filter((x): x is string => !!x),
    subject: m.subject ?? null, body, at: (direction === "outbound" ? m.sentDateTime : m.receivedDateTime) ?? m.receivedDateTime ?? m.sentDateTime ?? new Date(0).toISOString(),
    hasAttachments: !!m.hasAttachments, attachments: [],
  };
}

/** The homeowner side of the message: sender for inbound, recipients for outbound — never our own addresses. */
export function counterpartEmails(m: MailMessage, mailbox: string, ourDomains: string[] = []): string[] {
  const ours = (e: string) => e === mailbox.toLowerCase() || ourDomains.some((d) => e.endsWith(`@${d.toLowerCase()}`));
  const list = m.direction === "inbound" ? [m.from ?? ""] : [...m.to, ...m.cc];
  return [...new Set(list.filter((e) => e && !ours(e)))];
}

/** Job numbers (HV-1234) quoted anywhere in the subject or body. */
export function extractJobNumbers(text: string): string[] {
  return [...new Set([...text.matchAll(/\bHV[-\s]?(\d{3,6})\b/gi)].map((x) => `HV-${x[1]}`))];
}

export type CandidateJob = { id: string; jobNumber: string; ownerEmail: string | null; addressLine: string | null; postcode: string | null };
export type MatchResult =
  | { kind: "job"; jobIds: string[]; how: "job_number" | "job_numbers" | "thread" | "email_and_address" | "email_and_addresses" | "only_job_for_email"; visibility?: "customer" | "internal" }
  | { kind: "unmatched"; reason: string; candidateJobIds: string[] }
  | { kind: "not_homeowner" };

const normAddr = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ")
  .replace(/\b(street)\b/g, "st").replace(/\b(road)\b/g, "rd").replace(/\b(avenue)\b/g, "ave").replace(/\b(drive)\b/g, "dr").replace(/\b(court)\b/g, "ct")
  .replace(/\s+/g, " ").trim();

/**
 * Safe matching, in order: 1) job numbers named in the subject or the current (non-quoted) message text that
 * exist; 2) the message continues a thread already stored on a job (a family member or property manager
 * replying on a known conversation); 3) counterpart email + address written in the message; 4) the counterpart
 * email belongs to exactly one current job. A message naming several jobs is linked to all of them only when
 * the sender is a confirmed participant of every one. Quoted-only, conflicting or multi-job uncertainty goes
 * to Office review. Mail from an unrecognised sender is preserved for Office review (which can assign it to a
 * job or dismiss it) — it is never guessed onto a job and never discarded.
 */
export function matchMessage(m: MailMessage, emails: string[], byNumber: Map<string, CandidateJob>, byEmail: Map<string, CandidateJob[]>, byThread: Map<string, CandidateJob[]> = new Map()): MatchResult {
  const text = `${m.subject ?? ""}\n${m.body}`;
  const counterpart = new Set(emails);
  const corroborates = (j: CandidateJob) => !!j.ownerEmail && counterpart.has(j.ownerEmail);
  const asJob = (jobs: CandidateJob[], how: "job_number" | "job_numbers" | "thread" | "email_and_address" | "email_and_addresses" | "only_job_for_email"): MatchResult =>
    ({ kind: "job", jobIds: jobs.map((j) => j.id), how, visibility: jobs.every(corroborates) ? "customer" : "internal" });
  // A job number inside quoted earlier history is only trusted when the sender is a confirmed participant
  // of that job; the quoted text itself may belong to anyone in the chain.
  const currentRefs = [...new Set([...extractJobNumbers(m.subject ?? ""), ...extractJobNumbers(latestReplyText(m.body))])];
  const refJobs = [...new Map(currentRefs.map((n) => byNumber.get(n)).filter((j): j is CandidateJob => !!j).map((j) => [j.id, j])).values()];
  if (refJobs.length === 1) return asJob(refJobs, "job_number");
  if (refJobs.length > 1) {
    if (refJobs.every(corroborates)) return asJob(refJobs, "job_numbers");
    return { kind: "unmatched", reason: `The message names ${refJobs.length} jobs and the sender is not a confirmed participant of all of them`, candidateJobIds: refJobs.map((j) => j.id) };
  }
  const quotedOnly = [...new Map(extractJobNumbers(m.body).map((n) => byNumber.get(n)).filter((j): j is CandidateJob => !!j && corroborates(j)).map((j) => [j.id, j])).values()];
  if (quotedOnly.length === 1) return asJob(quotedOnly, "job_number");
  const threadedAll = m.threadId ? byThread.get(m.threadId) : undefined;
  // A shared thread (e.g. one mass email to many owners) must not pull an owner's reply onto someone else's job:
  // when the sender owns none of the thread's jobs but does own another job, their own job(s) decide below.
  const senderOwnsElsewhere = !!threadedAll?.length && !threadedAll.some(corroborates)
    && emails.some((e) => (byEmail.get(e) ?? []).some((j) => !threadedAll.some((t) => t.id === j.id)));
  const threaded = senderOwnsElsewhere ? undefined : threadedAll;
  if (threaded && threaded.length > 0) {
    if (threaded.length === 1) return asJob(threaded, "thread");
    const confirmed = threaded.filter(corroborates);
    if (confirmed.length === 1) return asJob(confirmed, "thread");
    return { kind: "unmatched", reason: `This thread is stored on ${threaded.length} jobs and the sender is not a confirmed participant of exactly one`, candidateJobIds: threaded.map((j) => j.id) };
  }
  const pool = [...new Map(emails.flatMap((e) => byEmail.get(e) ?? []).map((j) => [j.id, j])).values()];
  if (pool.length === 0) return { kind: "unmatched", reason: "Sender not recognised — review and assign or dismiss", candidateJobIds: [] };
  if (pool.length === 1) return asJob(pool, "only_job_for_email");
  const hay = ` ${normAddr(text)} `;
  const byAddr = pool.filter((j) => j.addressLine && normAddr(j.addressLine).length >= 5 && hay.includes(` ${normAddr(j.addressLine)} `));
  if (byAddr.length === 1) return asJob(byAddr, "email_and_address");
  if (byAddr.length > 1) return asJob(byAddr, "email_and_addresses");
  return { kind: "unmatched", reason: `This email address belongs to ${pool.length} jobs and the message does not say which property`, candidateJobIds: pool.map((j) => j.id) };
}

/** An outbound Outlook copy of an email the portal already recorded: same job, exact same recipient set,
 *  same subject AND same body, within 15 minutes. Anything less certain (e.g. a distinct reply that shares
 *  a subject line and recipient) is kept as its own record rather than dropped. */
export type ExistingComm = { provider: string; subject: string | null; recipients: string[]; at: string | null; direction: string; body: string | null };
const normSubject = (s: string | null) => (s ?? "").trim().toLowerCase();
const normBody = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();
const normRecipients = (list: string[]) => [...new Set(list.map((r) => String(r).toLowerCase()))].sort().join(",");
export function isPortalDuplicate(m: MailMessage, existing: ExistingComm[]): boolean {
  if (m.direction !== "outbound") return false;
  const subj = normSubject(m.subject);
  if (!subj) return false;
  const body = normBody(m.body);
  const recipients = normRecipients([...m.to, ...m.cc]);
  const t = Date.parse(m.at);
  return existing.some((c) => c.provider !== "outlook" && c.direction === "outbound" && normSubject(c.subject) === subj
    && normBody(c.body) === body && normRecipients(c.recipients) === recipients
    && !!c.at && Math.abs(Date.parse(c.at) - t) <= 15 * 60_000);
}

// ---------- "Not proceeding" intent ----------
/** Removes quoted earlier messages so our own wording in a reply chain is never read as the homeowner's. */
export function latestReplyText(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) continue;
    if (/^\s*(on .{3,120} wrote:|-{2,}\s*original message|from:\s.+|sent from my)/i.test(l)) break;
    if (/^_{5,}/.test(l)) break;
    out.push(l);
  }
  return out.join("\n").trim();
}

export type DeclineCategory = "price" | "other_provider" | "timing" | "not_interested" | "general";
export type Intent = { kind: "not_proceeding"; category: DeclineCategory; phrase: string } | { kind: "possible"; phrase: string } | { kind: "none" };

const EXPLICIT: { re: RegExp; category: DeclineCategory }[] = [
  { re: /\b(gone|going|go|went|proceed(?:ing)?|decided to go) (ahead )?with (another|a different|other|someone else|a local|my own)\b/i, category: "other_provider" },
  { re: /\b(chose|chosen|choosing|picked|engaged|booked|found|using) (another|a different|other|someone else)( company| provider| installer| business| quote)?\b/i, category: "other_provider" },
  { re: /\bgoing elsewhere\b|\bgo elsewhere\b|\bfound someone else\b|\bsomeone else (is|will be) doing\b/i, category: "other_provider" },
  { re: /\b(already|has) (had|got) (it|this|the (insulation|work)) (done|installed)\b/i, category: "other_provider" },
  { re: /\bwaiting (for|on) (another|a different|the other) (provider|company|installer|quote)\b/i, category: "other_provider" },
  { re: /\b(too expensive|can'?t afford|cannot afford|out of (our|my) budget)\b[^.?!]*\b(not|won'?t|will not|unable to) (be )?(proceed|go ahead|continu)/i, category: "price" },
  // Jo 27 Oct 2026: clear "leave it for now", "can't afford it" and a plain "no thanks" are declines too.
  { re: /\b(can'?t|cannot|can not|unable to) afford\b|\bdo(?:n'?t| not) have the (money|funds|balance|budget)\b|\bnot enough for (us|me) to (go ahead|proceed)\b/i, category: "price" },
  { re: /\b(will|i'?ll|we'?ll|going to) leave (?:it |this |things )?(for now|for the moment|for the time being|until next year|till next year)\b|\bleave it for now\b/i, category: "timing" },
  { re: /^\s*no,? thank(s| you)\b/i, category: "not_interested" },
  { re: /\b(not|won'?t|will not|do not|don'?t|no longer) (be )?(going to )?(want to )?(proceed|proceeding|go ahead|going ahead|continue|continuing)\b/i, category: "general" },
  { re: /\b(declin(e|ing)|reject(ing)?) (the|your|this) (quote|offer)\b|\bwe(?:'ll| will) pass\b/i, category: "general" },
  { re: /\b(not|no longer) interested\b|\bno longer (need|require|want)\b|\bplease (cancel|close)\b|\bcancel (my|our|the) (enquiry|booking|request|spot)\b|\b(remove|take) (me|us) off\b/i, category: "not_interested" },
  { re: /\bchanged (my|our) minds?\b|\bdecided against\b|\bdecided not to\b/i, category: "not_interested" },
];
const POSSIBLE = /\b(might|may|maybe|possibly|probably) not\b|\bnot sure\b|\bthink about it\b|\bneed (some )?time\b|\bget(ting)? (other|more|a few) quotes\b|\bcompar(e|ing) (quotes|prices|providers)\b|\b(seems|is|bit|very|quite) (high|expensive|steep)\b|\bon hold\b|\bhold off\b|\bnot (right )?now\b/i;
const HEDGE = /\b(unless|if|might|maybe|perhaps|may|not sure|considering|thinking)\b/i;

/** Only an explicit, unhedged statement of not going ahead counts. Questions, complaints and "need time" never close. */
export function classifyIntent(body: string): Intent {
  const text = latestReplyText(body);
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  let possible: string | null = null;
  for (const s of sentences) {
    for (const { re, category } of EXPLICIT) {
      const m = s.match(re);
      if (!m) continue;
      if (HEDGE.test(s) || s.includes("?")) { possible ??= s; continue; }
      const cat: DeclineCategory = category === "general" && /\b(price|cost|expensive|afford|cheaper)\b/i.test(text) ? "price"
        : category === "general" && /\b(another|other|different) (company|provider|installer|quote)\b/i.test(text) ? "other_provider" : category;
      return { kind: "not_proceeding", category: cat, phrase: s.slice(0, 200) };
    }
    if (!possible && POSSIBLE.test(s)) possible = s;
  }
  return possible ? { kind: "possible", phrase: possible.slice(0, 200) } : { kind: "none" };
}

export const DECLINE_REASON: Record<DeclineCategory, string> = {
  price: "Customer not proceeding — price",
  other_provider: "Customer not proceeding — going with / comparing other providers",
  timing: "Customer not proceeding — timing",
  not_interested: "Customer not proceeding — no longer interested",
  general: "Customer not proceeding",
};

/** Stages where a clear "not proceeding" email may close the record without Office review. */
export const AUTO_CLOSE_STAGES = new Set(["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_awaiting_acceptance"]);

export type ClosureDecision = { action: "close"; reason: string } | { action: "flag"; kind: "possible_not_proceeding" | "not_proceeding_progressed"; reason: string } | { action: "none" };
export function closureDecision(stage: string, intent: Intent, opts: { laterInbound: boolean }): ClosureDecision {
  if (stage === "cancelled" || stage === "complete" || intent.kind === "none") return { action: "none" };
  if (intent.kind === "possible") return { action: "flag", kind: "possible_not_proceeding", reason: `May not be proceeding — please check: “${intent.phrase}”` };
  const reason = DECLINE_REASON[intent.category];
  if (!AUTO_CLOSE_STAGES.has(stage)) return { action: "flag", kind: "not_proceeding_progressed", reason: `${reason}, but the job is already past the enquiry stage — Office to decide` };
  if (opts.laterInbound) return { action: "flag", kind: "possible_not_proceeding", reason: `${reason} — but the customer wrote again later; please check` };
  return { action: "close", reason };
}

/** Label shown on Closed jobs rows. */
export function closedReasonLabel(stage: string, cancelledReason: string | null | undefined): string | null {
  if (stage !== "cancelled") return null;
  return cancelledReason?.trim() ? `Closed: ${cancelledReason.trim()}` : "Closed: no reason recorded";
}
