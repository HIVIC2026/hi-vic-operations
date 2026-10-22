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
export type StoredAttachmentRef = AttachmentRef & { path: string | null; storedAt: string | null; skipped: string | null };

export const ATTACHMENT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_MAX_MESSAGE_BYTES = 40 * 1024 * 1024;

/** Safe storage filename: keep the extension, strip anything path-like or exotic, bound the length. */
export function safeAttachmentName(name: string): string {
  const clean = name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(-120);
  return clean || "attachment";
}

/** Deterministic private path, unique per message and attachment position; messageId is sanitised for storage. */
export function attachmentStoragePath(prefix: string, messageId: string, index: number, name: string): string {
  const safePrefix = prefix.replace(/[^\w.\-]+/g, "_") || "unmatched";
  const safeMessage = messageId.replace(/[^\w.\-]+/g, "_").slice(-80);
  return `correspondence/${safePrefix}/${safeMessage}/${index + 1}-${safeAttachmentName(name)}`;
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
  | { kind: "job"; jobIds: string[]; how: "job_number" | "job_numbers" | "thread" | "email_and_address" | "email_and_addresses" | "only_job_for_email" }
  | { kind: "unmatched"; reason: string; candidateJobIds: string[] }
  | { kind: "not_homeowner" };

const normAddr = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ")
  .replace(/\b(street)\b/g, "st").replace(/\b(road)\b/g, "rd").replace(/\b(avenue)\b/g, "ave").replace(/\b(drive)\b/g, "dr").replace(/\b(court)\b/g, "ct")
  .replace(/\s+/g, " ").trim();

/**
 * Safe matching, in order: 1) one or more quoted job numbers that exist; 2) the message continues a thread already
 * stored on a job (a family member or property manager replying on a known conversation); 3) counterpart email +
 * address written in the message; 4) the counterpart email belongs to exactly one current job. A message naming
 * several existing jobs is linked to all of them; anything ambiguous goes to Office review; mail from/to no known
 * homeowner with no job number and no known thread is not homeowner correspondence and is skipped.
 */
export function matchMessage(m: MailMessage, emails: string[], byNumber: Map<string, CandidateJob>, byEmail: Map<string, CandidateJob[]>, byThread: Map<string, string[]> = new Map()): MatchResult {
  const text = `${m.subject ?? ""}\n${m.body}`;
  const refs = extractJobNumbers(text).map((n) => byNumber.get(n)).filter((j): j is CandidateJob => !!j);
  const refIds = [...new Set(refs.map((j) => j.id))];
  if (refIds.length === 1) return { kind: "job", jobIds: refIds, how: "job_number" };
  if (refIds.length > 1) return { kind: "job", jobIds: refIds, how: "job_numbers" };
  const threaded = m.threadId ? byThread.get(m.threadId) : undefined;
  if (threaded && threaded.length > 0) return { kind: "job", jobIds: [...new Set(threaded)], how: "thread" };
  const pool = [...new Map(emails.flatMap((e) => byEmail.get(e) ?? []).map((j) => [j.id, j])).values()];
  if (pool.length === 0) return { kind: "not_homeowner" };
  if (pool.length === 1) return { kind: "job", jobIds: [pool[0]!.id], how: "only_job_for_email" };
  const hay = ` ${normAddr(text)} `;
  const byAddr = pool.filter((j) => j.addressLine && normAddr(j.addressLine).length >= 5 && hay.includes(` ${normAddr(j.addressLine)} `));
  if (byAddr.length === 1) return { kind: "job", jobIds: [byAddr[0]!.id], how: "email_and_address" };
  if (byAddr.length > 1) return { kind: "job", jobIds: byAddr.map((j) => j.id), how: "email_and_addresses" };
  return { kind: "unmatched", reason: `This email address belongs to ${pool.length} jobs and the message does not say which property`, candidateJobIds: pool.map((j) => j.id) };
}

/** An outbound Outlook copy of an email the portal already recorded (same job, subject, recipient, within 15 min). */
export type ExistingComm = { provider: string; subject: string | null; recipients: string[]; at: string | null; direction: string };
export function isPortalDuplicate(m: MailMessage, existing: ExistingComm[]): boolean {
  if (m.direction !== "outbound") return false;
  const subj = (m.subject ?? "").trim().toLowerCase();
  const t = Date.parse(m.at);
  return existing.some((c) => c.provider !== "outlook" && c.direction === "outbound" && (c.subject ?? "").trim().toLowerCase() === subj && subj.length > 0
    && c.recipients.some((r) => [...m.to, ...m.cc].includes(String(r).toLowerCase()))
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
