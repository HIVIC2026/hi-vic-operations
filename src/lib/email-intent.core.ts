// Decision 245 (Jo 24 Oct 2026): "Email asks for a change → suggest, one tap to apply". Pure classifier for a
// matched email: what is the sender asking for? Change intents (cancel, can't make it / reschedule, new contact
// details, a photo/document) raise ONE `email_change_request` per intent on the job; the office taps Apply or
// Ignore. Questions (status / price / rebate) and installer/electrician mail are classified for the drafted-reply
// work (decision 244) but never raise a change. Nothing here changes a job, books, moves or sends anything.
// Only the latest reply text counts (quoted history is ours or someone else's), and hedged/question sentences
// never become a cancel. Imports only outlook-correspondence.core (the Outlook copier test harness loads this file).
import { classifyIntent, latestReplyText } from "./outlook-correspondence.core";

export type EmailIntent = "cancel" | "reschedule" | "contact_change" | "attachment" | "question_status" | "question_price" | "question_rebate" | "trade";
export type ChangeIntent = "cancel" | "reschedule" | "contact_change" | "attachment";
export const CHANGE_INTENTS: readonly ChangeIntent[] = ["cancel", "reschedule", "contact_change", "attachment"];
export const EMAIL_CHANGE_REQUEST_EVENT = "email_change_request";
export const EMAIL_CHANGE_APPLIED_EVENT = "email_change_applied";
export const EMAIL_CHANGE_IGNORED_EVENT = "email_change_ignored";
/** Old mail (e.g. a history catch-up) never raises a Needs me change row. */
export const EMAIL_ACTION_MAX_AGE_DAYS = 14;

export type IntentHit = { intent: EmailIntent; phrase: string };
export type ProposedChange =
  | { intent: "cancel"; reason: string; phrase: string }
  | { intent: "reschedule"; phrase: string; mentionedDays: string[] }
  | { intent: "contact_change"; phrase: string; email: string | null; phone: string | null }
  | { intent: "attachment"; phrase: string; files: string[] };

export type IntentInput = {
  subject: string | null; body: string; direction: "inbound" | "outbound";
  from?: string | null;
  attachments?: { name: string; contentType?: string | null; isInline?: boolean }[];
  hasAttachments?: boolean;
  /** The sender is a partner business (installer/electrician), not the owner side. */
  fromPartner?: boolean;
};

const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);
const HEDGE = /\b(unless|if|might|maybe|perhaps|not sure|considering|thinking about)\b/i;

const RESCHEDULE = [
  /\b(can'?t|cannot|can not|won'?t be able to|unable to|not able to) (make|do|attend|be (there|home|in))\b/i,
  /\b(re-?schedule|re-?book|postpone|push (it )?back|bring (it )?forward)\b/i,
  /\b(change|move|swap|shift) (the |our |my )?(date|day|time|appointment|booking|visit|install(ation)?|ready check|inspection)\b/i,
  /\b(another|a different|other|later|earlier) (day|date|time)\b/i,
  /\bsomething (has )?come up\b/i,
  /\bno longer (suits?|works?)\b|\bdoesn'?t (suit|work) (anymore|any more|now)\b/i,
];
const DAY_WORDS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|this week|\d{1,2}(st|nd|rd|th)? (of )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|\d{1,2}\/\d{1,2}(\/\d{2,4})?)\b/gi;

const CONTACT_CUE = /\b(new|updated|changed|different|correct|right|best|better) (email|e-mail|address|number|mobile|phone|contact)\b|\b(my|our) (email|e-mail|number|mobile|phone)( address)? (is|has changed|changed|is now)\b|\b(please|pls|can you|could you) (use|update|change|contact me on|call me on|email me (at|on))\b|\b(contact|reach|call|text|email) me (on|at)\b/i;
const EMAIL_IN_TEXT = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_IN_TEXT = /(?:\+?61[\s-]?|0)[2-478](?:[\s-]?\d){8}\b/g;

/** Australian phone written any common way → "0412 345 678" / "03 9123 4567"; anything else → null. */
export function normalisePhone(raw: string): string | null {
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+61")) d = "0" + d.slice(3);
  else if (d.startsWith("61") && d.length === 11) d = "0" + d.slice(2);
  d = d.replace(/\D/g, "");
  if (/^04\d{8}$/.test(d)) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (/^0[2378]\d{8}$/.test(d)) return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
  return null;
}

const STATUS_Q = /\b(any (update|news)|where (are|is) (we|it|things|my|our)|what'?s happening|what is happening|haven'?t heard|not heard|still waiting|when (will|is|are|can|do)|how long|what'?s (the )?next|status|follow(ing)? up)\b/i;
const PRICE_Q = /\b(how much|price|cost|costs|quote|quoted|invoice|pay(ment)?|deposit|charge|fee)\b/i;
const REBATE_Q = /\b(rebate|veec|veu|victorian energy upgrades?|government (scheme|program|rebate)|eligib(le|ility)|free|subsid(y|ised|ized)|discount)\b/i;
const TRADE_CUE = /\b(i'?m|i am|we are|this is) (the|your) (installer|electrician|sparky|tradie)\b|\b(piesa|piisa|mitti|onsite form|job offer|my pay|our pay|remittance|rate card)\b/i;

/** Every intent found in the message (an email can ask several things). Outbound mail has no owner intent. */
export function classifyEmailIntents(m: IntentInput): IntentHit[] {
  if (m.direction !== "inbound") return [];
  const latest = latestReplyText(m.body);
  const text = `${m.subject ?? ""}\n${latest}`;
  const sentences = sentencesOf(latest);
  const hits: IntentHit[] = [];
  const add = (intent: EmailIntent, phrase: string) => { if (!hits.some((h) => h.intent === intent)) hits.push({ intent, phrase: clip(phrase) }); };

  const resched = sentences.find((s) => RESCHEDULE.some((re) => re.test(s)) || (new RegExp(DAY_WORDS.source, "i").test(s) && /\b(instead|rather|suits? (us |me )?better|works? (us |me )?better)\b/i.test(s)));
  if (resched) add("reschedule", resched);
  // A cancel is only an explicit, unhedged "not going ahead" (shared rule with the Outlook copier); an email that
  // also asks for another day is a reschedule, never a cancel. Partners never cancel an owner's job by email.
  const decline = classifyIntent(m.body);
  if (!resched && !m.fromPartner && decline.kind === "not_proceeding") add("cancel", decline.phrase);

  if (!m.fromPartner) {
    const cueAt = sentences.findIndex((s) => CONTACT_CUE.test(s));
    if (cueAt >= 0) {
      const scope = sentences.slice(cueAt, cueAt + 2).join(" ");
      const hasEmail = (scope.match(EMAIL_IN_TEXT) ?? []).length > 0;
      const hasPhone = (scope.match(PHONE_IN_TEXT) ?? []).some((p) => !!normalisePhone(p));
      if (hasEmail || hasPhone) add("contact_change", sentences[cueAt]!);
    }
  }

  const files = (m.attachments ?? []).filter((a) => !a.isInline);
  if (files.length || (m.hasAttachments && !(m.attachments ?? []).length && /\b(attach(ed|ment|ing)?|photos?|pics?|pictures?|images?|documents?|forms?|signed|scan(ned)?)\b/i.test(text)))
    add("attachment", files.length ? `${files.length} file${files.length === 1 ? "" : "s"} attached: ${files.map((f) => f.name).join(", ")}` : (sentences.find((s) => /\battach|photo|pic|document|form|signed|scan/i.test(s)) ?? "File attached"));

  const asks = sentences.filter((s) => s.includes("?") || /^(when|what|where|how|why|is|are|can|could|do|does|will|would|have|has|any)\b/i.test(s) || /\b(wondering|let me know|please advise|could you (tell|confirm|explain))\b/i.test(s));
  const q = (re: RegExp) => asks.find((s) => re.test(s));
  const st = q(STATUS_Q); if (st) add("question_status", st);
  const pr = q(PRICE_Q); if (pr) add("question_price", pr);
  const rb = q(REBATE_Q); if (rb) add("question_rebate", rb);

  const tr = m.fromPartner ? (sentences[0] ?? m.subject ?? "Partner email") : sentences.find((s) => TRADE_CUE.test(s));
  if (tr) add("trade", tr);
  return hits;
}

/** The change(s) to suggest to the office — one per change intent, with what would change. Never applied here. */
export function proposedChanges(m: IntentInput): ProposedChange[] {
  const hits = classifyEmailIntents(m);
  const latest = latestReplyText(m.body);
  const sentences = sentencesOf(latest);
  const out: ProposedChange[] = [];
  for (const h of hits) {
    if (h.intent === "cancel") {
      const d = classifyIntent(m.body);
      const reason = d.kind === "not_proceeding" ? `Owner asked by email not to go ahead (${d.category.replace(/_/g, " ")})` : "Owner asked by email not to go ahead";
      out.push({ intent: "cancel", reason, phrase: h.phrase });
    } else if (h.intent === "reschedule") {
      out.push({ intent: "reschedule", phrase: h.phrase, mentionedDays: [...new Set((latest.match(DAY_WORDS) ?? []).map((d) => d.toLowerCase()))].slice(0, 6) });
    } else if (h.intent === "contact_change") {
      const at = sentences.findIndex((s) => CONTACT_CUE.test(s));
      const scope = sentences.slice(Math.max(0, at), Math.max(0, at) + 2).join(" ");
      const from = (m.from ?? "").toLowerCase();
      const emails = (scope.match(EMAIL_IN_TEXT) ?? []).map((e) => e.toLowerCase());
      // A sender who writes "please use this address" means the address they wrote, not the one they sent from — but
      // if the only address in the sentence is the sender's own, that is still the proposed address.
      const email = emails.find((e) => e !== from) ?? emails[0] ?? null;
      const phone = (scope.match(PHONE_IN_TEXT) ?? []).map(normalisePhone).find((p): p is string => !!p) ?? null;
      out.push({ intent: "contact_change", phrase: h.phrase, email, phone });
    } else if (h.intent === "attachment") {
      out.push({ intent: "attachment", phrase: h.phrase, files: (m.attachments ?? []).filter((a) => !a.isInline).map((a) => a.name) });
    }
  }
  return out;
}

/** Decision 244/292: does the email read like a NEW enquiry ("interested in", "a quote for", "do you install …")?
 *  Shared by the reply drafter (matched owners at enquiry stages) and the new-sender website reply (decision 292). */
const ENQUIRY_CUE = /\b(interested in|enquir(e|y|ing)|get a quote|a quote for|quote (me|us)|insulation for (my|our)|looking (to|for|at) (get|have|insulat)|would like (to get|a quote|insulation|some insulation)|can you (insulate|quote|help)|do you (do|install|service|cover)|need (ceiling )?insulation|ceiling insulation|insulate (my|our))\b/i;
export function looksLikeNewEnquiry(subject: string | null, body: string): boolean {
  return ENQUIRY_CUE.test(`${subject ?? ""}\n${body}`);
}

/** Whether a message is recent enough to raise an office row (history catch-ups and stale replays never do). */
export function recentEnoughForAction(at: string, now: Date = new Date()): boolean {
  const t = Date.parse(at);
  return Number.isFinite(t) && now.getTime() - t <= EMAIL_ACTION_MAX_AGE_DAYS * 86_400_000;
}

/** Plain words for the Needs me row: "Owner asks to …". */
export function changeRequestLabel(c: Pick<ProposedChange, "intent"> & Partial<{ email: string | null; phone: string | null }>): string {
  switch (c.intent) {
    case "cancel": return "Owner asks to cancel";
    case "reschedule": return "Owner can't make the booked day — rearrange it";
    case "contact_change": return `Owner asks to update contact details${[c.email, c.phone].filter(Boolean).length ? ` (${[c.email, c.phone].filter(Boolean).join(", ")})` : ""}`;
    case "attachment": return "Owner sent a photo/document — add it to the Job File";
  }
}

/** Open requests: those with no later applied/ignored event pointing at them. */
export function openChangeRequests<T extends { id: string }>(requests: T[], resolutions: { request_event_id: string | null | undefined }[]): T[] {
  const done = new Set(resolutions.map((r) => r.request_event_id).filter(Boolean));
  return requests.filter((r) => !done.has(r.id));
}
