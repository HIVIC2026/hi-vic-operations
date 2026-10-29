// AI email replies on each job (Jo 26 Oct 2026). Pure rules only — no I/O.
// - The AI writes every reply fresh from the job's details, current stage and full email history.
// - Simple emails (where's my job up to, thanks/got it, resend a link, booking time questions) and everything else are
//   SAVED AS A DRAFT ON THE JOB. Nothing sends by itself until Jo has seen samples and says "send"
//   (AI_EMAIL_AUTO_SEND_ENABLED stays false). Jo approves and sends each draft from the job page.
// - Tone: friendly, relaxed, short; answer first then next step; "rebate", never VEEC/scheme jargon; never "call us",
//   never a phone number; sign-off "Cheers, the Home Insulation Victoria team" (AI replies only).
// - Booking change asks get the owner's own My job link on the right screen for the visit (PIESA → electrician,
//   install → installer), via email-change-reply.core `changeVisitLink`.
import { esc, mjEmail } from "./mail-mjml.core";
import { changeVisitLink, visitGroupForStage, type ChangeVisit } from "./email-change-reply.core";
import { smsQuietReason } from "./quote-hold.core";
import { SPOT_FREE, SPOT_PRICE_NOTE, SPOT_REGISTERED, SPOT_RELEASE_LINE, isPreReleaseStage } from "./spot-only-copy.core";
import { rulesFromAnswers, type AiAnswer } from "./ai-answers.core";
import type { StyleExample } from "./ai-style.core";
import type { SpotReleaseState } from "./spot-release.core";
import { ownerRateForR } from "./hiv-quote.core";

/** Shown on the draft screens after a blocked Send: the box now holds the fixed reply. */
export const AI_REWRITTEN_NOTE = "We fixed the reply so it follows your rules — check it and press Send.";
export const AI_EMAIL_DRAFT_EVENT = "email_ai_draft";
export const AI_EMAIL_DRAFT_SENT_EVENT = "email_ai_draft_sent";
export const AI_EMAIL_DRAFT_DISCARDED_EVENT = "email_ai_draft_discarded";
/** Jo 27 Oct 2026: her edits to a draft are saved as she types (append-only), so a refresh keeps them. */
export const AI_EMAIL_DRAFT_EDITED_EVENT = "email_ai_draft_edited";

/** Newest saved edit per draft (rows in any order). */
export function latestDraftEdits(rows: { created_at: string; details: { draft_event_id?: string; body?: string } | null }[]): Map<string, string> {
  const best = new Map<string, { at: string; body: string }>();
  for (const r of rows) {
    const id = r.details?.draft_event_id; const body = r.details?.body;
    if (!id || typeof body !== "string") continue;
    const cur = best.get(id);
    if (!cur || r.created_at >= cur.at) best.set(id, { at: r.created_at, body });
  }
  return new Map([...best].map(([k, v]) => [k, v.body]));
}
export const AI_EMAIL_REPLY_PURPOSE = "owner_email_ai_reply";
/** Master switch for writing AI drafts on jobs. */
export const AI_EMAIL_DRAFTS_ENABLED: boolean = true;
/** Jo 26 Oct: OFF until Jo has seen sample replies and says "send". With it off simple replies are drafts too. */
export const AI_EMAIL_AUTO_SEND_ENABLED: boolean = false;
/** Jo 27 Oct 2026: signed by the team, never by Jo. */
export const AI_SIGN_OFF = "Cheers, the Home Insulation Victoria team";
/** The AI returns exactly this when the email needs no reply (a plain "thanks" or acknowledgement). Jo 27 Oct: file those away. */
export const NO_REPLY_NEEDED = "NO_REPLY_NEEDED";

export type AiReplyKind = "simple" | "other";

/** One draft per Outlook message, ever. */
export const aiDraftKey = (messageId: string) => `owner-email-ai-reply:v1:${messageId}`;

/** No owner emails between 8pm and 7am Melbourne time (same quiet hours as texts). */
export function aiSendQuietReason(nowIso: string): string | null {
  return smsQuietReason(nowIso) ? "It's after 8pm in Melbourne — send this in the morning (from 7am)." : null;
}

/** The right link for a booking-time change: Ready Check → My job home; PIESA / install → the booking screen. */
export function bookingChangeLink(myJobLink: string | null, stage: string | null): { visit: ChangeVisit; link: string } | null {
  if (!myJobLink) return null;
  const visit = visitGroupForStage(stage);
  return visit ? { visit, link: changeVisitLink(myJobLink, visit) } : null;
}

const WHO: Record<ChangeVisit, string> = {
  ready_check: "the Ready Check (arranged with the installer)",
  piesa: "the Pre Insulation Electrical Safety Assessment (PIESA) — arranged with the electrician",
  install: "the install day — arranged with the installer",
};

export type AiReplyContext = {
  jobNumber: string | null;
  ownerFirstName: string | null;
  stageLabel: string;
  facts: string[];
  links: { label: string; url: string }[];
  changeLink: { visit: ChangeVisit; link: string } | null;
  history: { direction: "inbound" | "outbound"; at: string; subject: string | null; body: string }[];
  email: { from: string | null; subject: string | null; body: string };
};


const NEXT_STEP_RELEASED = "Then give the one next step: if their spot isn't saved and they want to go ahead, give the save-my-spot link on its own line; if their spot is saved, say that when it's their turn an installer will text and email them a few times for their free Ready Check.";
/** Jo's wait line and release line (steps 2-4 spec 2d), verbatim. Before release, AI replies may explain the Ready Check with these but never give a date, timeframe or speed. */
export const AI_WAIT_LINE = "We're bringing on more and more certified installers, but demand is high and there aren't enough of them yet. So we're booking people in the order they saved their spot, as quickly as we can bring on more CII-certified installers. We can't give a date yet, but we'll be in touch as soon as your spot is released.";
export const AI_RELEASE_MEANS = "When your spot is released, it's your turn: an installer will text and email you some times for your free Ready Check.";
const NEXT_STEP_PRE_RELEASE = `Then give the one next step: if their spot isn't saved and they want to go ahead, give the save-my-spot link on its own line; if their spot is saved, explain what release means with: ${AI_RELEASE_MEANS} If they ask when or how long, use: ${AI_WAIT_LINE} Give no date, timeframe or speed, and never promise or hint at one.`;
/** The machine line the AI may add after the email (AI replies step 2, task 5). */
export const AI_ACTIONS_EXAMPLE = 'ACTIONS: {"installer_note":"…","new_area_m2":90}';
const instructionLines = (NEXT_STEP: string, preRelease: boolean) => [
  "You write email replies from the Home Insulation Victoria team to home owners about their ceiling insulation. The office reads and sends each one.",
  "Tone: kind, warm and plain, in Australian English, like a real person in our office. Never robotic or call-centre. Never say \"No worries\". Never sign or mention a person's name for us.",
  "Answer each question fully, explaining the why when it helps, in short sentences. Warm and plain; an occasional :) is fine.",
  "Start with \"Hi <first name>,\" on its own line (or \"Hi there,\" if no name), then a short thank-you that fits what they wrote.",
  "Answer every question they asked, directly and specifically, using the job facts below (their ceiling size, price, rebate, whether their spot is saved). If they asked several things, answer each one in a short list.",
  "Never say \"we'll check and get back to you\" when the answer is in the facts or the business rules. Only if something truly isn't covered, say we'll find out and reply.",
  "If a question isn't covered by the rules or facts, still answer the rest, and after the email add a line `NEEDS_JO: <their question>` for each one.",
  "If the owner is complaining about the install (mess, damage, unhappy with the work), write a short holding reply: say sorry and that we're looking into it with the installer. After the email add the line `NEEDS_YOU: complaint`.",
  "Keep it relevant: only use a fact or business rule when it answers something they actually raised. Never volunteer extra details they didn't ask about (for example, don't mention batts versus blow-in unless they asked about blow-in).",
  NEXT_STEP,
  "If they say they can't get into the roof or take photos, kindly tell them not to go up there — they don't need to send photos.",
  "Only use the facts, rules and links given below. Never invent dates, prices, times, people or links.",
  "Say \"rebate\" — never say VEEC, VEECs, VEU, Activity 48, ESC or other scheme jargon.",
  "Never ask them to call, never give a phone number. They can just reply to this email.",
  ...(preRelease ? [] : ["If they want to change a booking time, give them the change link provided and say who they'll arrange it with. Never promise a new time yourself."]),
  `If their email is only a plain "thanks", "got it" or similar acknowledgement and needs no answer, return exactly ${"NO_REPLY_NEEDED"} and nothing else.`,
  "Do not include a sign-off; it is added for you.",
  `After the email you may add one line: ${AI_ACTIONS_EXAMPLE} — installer_note only when the owner asks for something the installer must know (for example R6.0 or R7.0, removing old insulation, downlights), short and plain, about the job only — never the owner's name, address, phone or email; new_area_m2 only when the owner states their ceiling size as a number in m². Leave out what doesn't apply, and leave the line out if neither does.`,
  "Return only the email body text, no subject line (plus any NEEDS_JO / NEEDS_YOU / ACTIONS lines after it).",
];

export const AI_REPLY_INSTRUCTIONS = instructionLines(NEXT_STEP_RELEASED, false).join("\n");

/** Decision 388: pre-release = our own lead (hivic_sourced) at a pre-release stage (`isPreReleaseStage`, shared with the
 *  reply composer) whose spot is not released AND confirmed. Any other stage or channel keeps today's behaviour. */
export function isPreReleaseOwner(j: { channel: string | null | undefined; stage: string | null | undefined; releaseState: SpotReleaseState | null | undefined }): boolean {
  if (j.channel !== "hivic_sourced") return false;
  if (!isPreReleaseStage(j.stage)) return false;
  return j.releaseState?.state !== "confirmed";
}

export type AiPromptOpts = { preRelease?: boolean; answers?: AiAnswer[] | null; style?: StyleExample[] | null };
/** The prompt for this owner; released owners get AI_REPLY_INSTRUCTIONS unchanged. */
export const aiReplyInstructions = (o: AiPromptOpts = {}): string => (o.preRelease ? instructionLines(NEXT_STEP_PRE_RELEASE, true).join("\n") : AI_REPLY_INSTRUCTIONS);


/** Jo's standard answers (steps 2-4 spec 2a) are the business rules: her saved list, else the seed. */
export const AI_BUSINESS_RULES = rulesFromAnswers(null);

/** Before release: the same answers plus Jo's spot-only, release and wait lines. Nothing may give a date, timeframe or speed. */
const preReleaseExtras = [SPOT_FREE, SPOT_REGISTERED, SPOT_RELEASE_LINE, AI_RELEASE_MEANS, AI_WAIT_LINE, SPOT_PRICE_NOTE];

export function buildAiReplyInput(c: AiReplyContext, o: AiPromptOpts = {}): string {
  const pre = o.preRelease === true;
  const hist = c.history.slice(-15).map((h) => `[${h.direction === "inbound" ? "Owner" : "Us"} ${h.at.slice(0, 16)}] ${h.subject ?? ""}\n${h.body.slice(0, 1200)}`).join("\n\n");
  return [
    `Job ${c.jobNumber ?? "(no number)"} · owner first name: ${c.ownerFirstName ?? "unknown"}`,
    ...(pre ? [] : [`Current stage: ${c.stageLabel}`]),
    c.facts.length ? `Facts:\n- ${c.facts.join("\n- ")}` : "Facts: none recorded",
    `Business rules:\n- ${[...rulesFromAnswers(o.answers ?? null), ...(pre ? preReleaseExtras : [])].join("\n- ")}`,
    ...(o.style?.length ? [`How Jo writes (style only — never copy facts, prices, dates, names or promises from these):\n${o.style.map((e) => `Owner wrote:\n${e.theirEmail.slice(0, 600)}\nJo replied:\n${e.reply}`).join("\n\n")}`] : []),
    c.links.length ? `Links you may use:\n${c.links.map((l) => `- ${l.label}: ${l.url}`).join("\n")}` : "Links: none — do not offer a link",
    pre ? "No change-time link is available." : c.changeLink ? `To change the time of ${WHO[c.changeLink.visit]}, they use: ${c.changeLink.link}` : "No change-time link is available — if they want to change a time, say we'll sort it and get back to them.",
    `Email history (oldest first):\n${hist || "(none)"}`,
    `The email to reply to, from ${c.email.from ?? "the owner"} — subject "${c.email.subject ?? ""}":\n${c.email.body.slice(0, 4000)}`,
  ].join("\n\n");
}

const JARGON: [RegExp, string][] = [
  [/\bVEECs?\b/gi, "rebate"],
  [/\bVictorian Energy Upgrades?\b/gi, "rebate"],
  [/\bVEU\b/g, "rebate"],
  [/\bActivity 48\b/gi, "the rebate"],
];
const PHONE = /(\+?61[\s-]?|\b0)[2-478](?:[\s-]?\d){8}\b|\b1[38]00(?:[\s-]?\d){6}\b|\b13(?:[\s-]?\d){4}\b/g;
const CALL_US = /[^.!?\n]*\b(call|ring|phone)\s+(us|the office|our office)\b[^.!?\n]*[.!?]?/gi;

/** Tidies the AI's text against Jo's rules and adds the sign-off exactly once. */
export function finishAiReply(raw: string): string {
  let t = raw.replace(/\r/g, "").trim();
  t = t.replace(/\n*(cheers|kind regards|regards|thanks|many thanks|best)[,!]?\s*\n(?:jo\s*\n)?[^\n]*(home insulation victoria|team)[^\n]*$/i, "").trim();
  // The AI sometimes signs as Jo ("Cheers, Jo", "Kind regards,\nJo"): drop it so only the team sign-off remains.
  t = stripSignOff(t);
  for (const [re, to] of JARGON) t = t.replace(re, to);
  t = t.replace(CALL_US, "").replace(PHONE, "").replace(/[ \t]{2,}/g, " ");
  // Greeting on its own line: "Hi Sarah! Good news…" → "Hi Sarah!\n\nGood news…"
  t = t.replace(/^((?:hi|hey|hello|g'day)\b[^\n!,.]{0,40}[!,])[ \t]*\n?(?=\S)/i, "$1\n\n");
  // Each link on its own line so it can show as a button.
  t = t.replace(/[ \t]*\(?(https?:\/\/[^\s<>"]*[^\s<>".,!?;:)])[.,!?;:)]*/g, "\n\n$1\n\n");
  t = t.split("\n").map((l) => l.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return `${t}\n\n${AI_SIGN_OFF}`;
}

/** Button wording for a link in an AI reply, from where it goes. */
export function aiLinkLabel(url: string): string {
  if (/\/my-job\/[^?#\s]+\?screen=book\b/.test(url)) return "Change my booking time";
  if (/\/my-job\//.test(url)) return "Open my job page";
  if (/\/estimate\/[^/\s]+\/campaign\b/.test(url)) return "Save my free spot";
  if (/\/electrician-onboarding\b/.test(url)) return "Sign up as an electrician";
  if (/\/estimate\/[^/\s]+\/video\b/.test(url)) return "Save my spot";
  if (/homeinsulationvictoria\.com\.au\/homeowner\b/.test(url)) return "Check my eligibility"; // decision 414
  return "Open link";
}

/**
 * The AI reply as an email in the refreshed look (Jo 27 Oct 2026: same frame and layout as the O76 automatic replies):
 * greeting line, short paragraphs, each link as a green button, sign-off on its own lines.
 */
export function aiReplyEmailHtml(body: string, o: { subject: string; unsubscribe: string | null; test?: boolean }): string {
  const URL_RE = /https?:\/\/[^\s<>"]+/g;
  const paras = body.replace(/\r/g, "").trim().split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  paras.forEach((para, i) => {
    if (i === 0 && /^(hi|hey|hello|g'day)\b[^\n]{0,40}[!,]$/i.test(para)) { out.push(`<mj-text mj-class="hi" padding="18px 12px 12px">${esc(para)}</mj-text>`); return; }
    if (/^cheers,/i.test(para) && i === paras.length - 1) {
      const [a, ...rest] = para.split(/,\s*/);
      out.push(`<mj-text padding="8px 12px 0">${esc(`${a},`)}<br />${esc(rest.join(", "))}</mj-text>`);
      return;
    }
    const urls = para.match(URL_RE) ?? [];
    const text = para.replace(URL_RE, "").split("\n").map((l) => l.trim()).filter((l) => l && !/^[.,!?;:)]+$/.test(l)).join("\n");
    if (text) out.push(`<mj-text${urls.length ? ' padding="0 12px 4px"' : ""}>${esc(text).replace(/\n/g, "<br />")}</mj-text>`);
    for (const u of urls) out.push(`<mj-button href="${esc(u)}" padding="10px 12px 18px">${esc(aiLinkLabel(u))}</mj-button>`);
  });
  return mjEmail({ subject: o.subject, body: `<mj-section><mj-column>${out.join("")}</mj-column></mj-section>`, unsubscribe: o.unsubscribe, testLabel: o.test === true });
}

/** Plain-text version: same paragraphs, each link on its own line with its label. */
export function aiReplyText(body: string): string[] {
  return body.replace(/\r/g, "").trim().replace(/(https?:\/\/[^\s<>"]+)/g, (u) => `${aiLinkLabel(u)}: ${u}`).split("\n");
}

/** Before release, an AI reply may explain the Ready Check but must never promise timing or queue position.
 *  "as soon as your spot is released" is Jo's own wait line, so it is allowed. Automatic emails/texts/pages keep the
 *  full decision-388 ban (`preReleaseViolations`). */
const AI_PRE_RELEASE_TIMING = new RegExp([
  String.raw`\bsoon\b`, "shortly", String.raw`this\s+week`, String.raw`next\s+week`, String.raw`this\s+month`, String.raw`next\s+month`, String.raw`next\s+year`, "tomorrow",
  String.raw`in\s+a\s+(?:few|couple\s+of)\s+(?:days|weeks)`, String.raw`a\s+couple\s+of\s+(?:days|weeks)`,
  String.raw`within\s+(?:a|an|\d+(?:\s*(?:-|–|to)\s*\d+)?)\s+(?:days?|weeks?|months?|fortnight)`,
  String.raw`\bin\s+\d+(?:\s*(?:-|–|to)\s*\d+)?\s+(?:days?|weeks?|months?)`,
  String.raw`in\s+a\s+(?:fortnight|week\s+or\s+two)`, String.raw`in\s+the\s+(?:coming|next\s+few)\s+(?:days|weeks|months)`,
  String.raw`jump\s+the\s+queue`, String.raw`\bmove\s+up`,
].join("|"), "gi");
export function aiPreReleaseViolations(text: string): string[] {
  const cleaned = text
    .replace(/as\s+soon\s+as\s+(?:your|their)\s+spot(?:\s+is|['’]s)\s+released/gi, " ")
    // The government's 30-day rule for the safety check is a rule, not a timing promise. Only 30 days, nothing else.
    .replace(/within\s+30\s+days?\s+of\s+(?:the|your)\s+install(?:ation)?\b/gi, " ");
  return [...new Set((cleaned.match(AI_PRE_RELEASE_TIMING) ?? []).map((m) => m.toLowerCase().replace(/\s+/g, " ")))];
}

/** Things the AI asks the office to do, from its `ACTIONS:` line. Applied only when Jo sends, and only if she leaves them ticked. */
export type AiActions = { installerNote?: string; newAreaM2?: number };
export const AI_NOTE_MAX = 200;
/** A new ceiling size is accepted only as a whole number of m² from 10 to 1000. */
export const validNewArea = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 10 && v <= 1000;
/** Keeps only valid actions (note trimmed, 1–200 chars; area a whole number 10–1000); anything else is dropped. */
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A note that could carry the owner's details (an email, a phone-like run of 8+ digits, their first name) is never kept:
 *  installers get owner details from the job only once they accept. */
export function noteHasOwnerDetails(note: string, ownerFirstName?: string | null): boolean {
  if (note.includes("@") || /\d{8,}/.test(note.replace(/[\s-]/g, ""))) return true;
  const first = (ownerFirstName ?? "").trim();
  return first.length >= 2 && new RegExp(`(?<![\\p{L}\\p{N}])${escRe(first)}(?![\\p{L}\\p{N}])`, "iu").test(note);
}
export function cleanActions(x: unknown, keys: { note: string; area: string } = { note: "installerNote", area: "newAreaM2" }, ownerFirstName?: string | null): AiActions {
  if (!x || typeof x !== "object" || Array.isArray(x)) return {};
  const o = x as Record<string, unknown>;
  const out: AiActions = {};
  const note = typeof o[keys.note] === "string" ? (o[keys.note] as string).trim() : "";
  if (note.length >= 1 && note.length <= AI_NOTE_MAX && !noteHasOwnerDetails(note, ownerFirstName)) out.installerNote = note;
  if (validNewArea(o[keys.area])) out.newAreaM2 = o[keys.area] as number;
  return out;
}
const AI_KEYS = { note: "installer_note", area: "new_area_m2" };
/** The JSON after `ACTIONS:` (fences removed); malformed = no actions. */
function parseActionsText(text: string, ownerFirstName?: string | null): AiActions {
  const json = text.replace(/```(?:json)?/gi, "").trim();
  try { return cleanActions(JSON.parse(json), AI_KEYS, ownerFirstName); } catch { return {}; }
}
const braceDepth = (s: string) => { let d = 0; let inStr = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; } else if (c === '"') inStr = true; else if (c === "{") d++; else if (c === "}") d--; } return d; };
/** Lines from `start` (the ACTIONS: line) that belong to the ACTIONS block: the JSON may run over several lines or sit in a
 *  ```json fence, on the same line or the next. Returns the block's text (after "ACTIONS:") and the index after it. An
 *  unbalanced block runs to the end, so no JSON is ever left in the owner's email. */
function actionsBlock(lines: string[], start: number, firstText: string): { text: string; next: number } {
  const parts = [firstText];
  let i = start + 1;
  const joined = () => parts.join("\n");
  // "ACTIONS:" alone on its line: the JSON (or a fence) starts on the next non-blank line.
  if (!joined().trim()) { while (i < lines.length && !lines[i]!.trim()) i++; if (i < lines.length && /^\s*(\{|```)/.test(lines[i]!)) parts.push(lines[i++]!); }
  const fenced = /^\s*```/.test(joined().trim());
  if (fenced) {
    const closed = () => (joined().match(/```/g) ?? []).length >= 2;
    while (!closed() && i < lines.length) parts.push(lines[i++]!);
  } else if (/^\s*\{/.test(joined())) {
    while (braceDepth(joined()) > 0 && i < lines.length) parts.push(lines[i++]!);
  }
  return { text: joined(), next: i };
}
/** Actions saved on a draft (`details.actions`); bad or missing values = none. At Send the owner's first name is passed, so a
 *  note naming them is dropped even if it was saved (or edited) that way. */
export const draftActions = (details: Record<string, unknown> | null | undefined, ownerFirstName?: string | null): AiActions =>
  cleanActions(details?.["actions"], undefined, ownerFirstName);

/** R6.0 / R7.0 prices for the AI's facts. The rebate doesn't depend on R-value, so the R5.0 rebate is used; only the
 *  install part changes (owner price per m² from `ownerRateForR`). */
export function higherRFacts(areaM2: number, r5Cost: { before: number; rebate: number }, ownerR5IncPerM2: number): string[] {
  if (!(areaM2 > 0) || !Number.isFinite(r5Cost.before) || !Number.isFinite(r5Cost.rebate)) return [];
  return (["R6.0", "R7.0"] as const).map((r) => {
    const before = r5Cost.before + areaM2 * (ownerRateForR(r, ownerR5IncPerM2) - ownerR5IncPerM2);
    return `${r} for ${areaM2} m²: ${money(before - r5Cost.rebate)} after the ${money(r5Cost.rebate)} rebate (${money(before)} before), including GST.`;
  });
}
/** Prices for a size the owner gave in their email (R5.0 from `whatIfEstimate`, then R6.0 / R7.0). */
export function newSizeFacts(areaM2: number, r5: { before: number; rebate: number; after: number }, ownerR5IncPerM2: number): string[] {
  return [`Price for the size they gave (${areaM2} m² ceiling, R5.0): ${money(r5.after)} after the ${money(r5.rebate)} rebate (${money(r5.before)} before), including GST.`, ...higherRFacts(areaM2, r5, ownerR5IncPerM2)];
}
const money = (n: number) => `$${Math.round(Number(n)).toLocaleString("en-AU")}`;
export type AiOutput = { body: string; needsAnswer: string[]; needsYou: boolean; actions: AiActions };

// Markers may come in markdown or list form: "**NEEDS_JO**:", "- NEEDS JO - …", "> NEEDS_JO – …". Leading `*`, `_`,
// backticks, `-`, `>` and spaces are dropped before matching; up to two `*`/`_` may close the marker.
const MARKER_LEAD = /^[\s*_`>-]*/;
const NEEDS_JO_LINE = /^needs[_ ]?jo[*_]{0,2}\s*[:\-–]\s*(.*?)\s*$/i;
const NEEDS_YOU_LINE = /^needs[_ ]?you[*_]{0,2}\s*[:\-–]/i;
const ACTIONS_LINE = /^actions[*_]{0,2}\s*:/i;
const ACTION_KEYS = /"(?:installer_note|new_area_m2)"/;
/** A bare ```json fence (no ACTIONS: before it) holding installer_note / new_area_m2 is an ACTIONS block too. */
function bareActionsFence(lines: string[], start: number): { text: string; next: number } | null {
  if (!/^\s*```(?:json)?\s*$/i.test(lines[start]!)) return null;
  let i = start + 1;
  while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) i++;
  const text = lines.slice(start, Math.min(i + 1, lines.length)).join("\n");
  return ACTION_KEYS.test(text) ? { text, next: i + 1 } : null;
}
/** Splits the AI's raw text into the email and its notes to the office. Runs before anything else, so a marker never
 *  reaches the fix loop or the owner. Lenient: any case, optional spaces, markdown/list forms, a marker on its own line. */
export function splitAiOutput(raw: string, o: { ownerFirstName?: string | null } = {}): AiOutput {
  const needsAnswer: string[] = [];
  let needsYou = false;
  let actions: AiActions = {};
  const keep: string[] = [];
  const lines = (raw ?? "").replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const bare = line.replace(MARKER_LEAD, "");
    if (ACTIONS_LINE.test(bare)) { // never reaches the owner, however the JSON is laid out
      const b = actionsBlock(lines, i, bare.replace(/^actions[*_]{0,2}\s*:\s*/i, ""));
      actions = { ...actions, ...parseActionsText(b.text, o.ownerFirstName) };
      i = b.next - 1;
      continue;
    }
    const fence = bareActionsFence(lines, i);
    if (fence) { actions = { ...actions, ...parseActionsText(fence.text, o.ownerFirstName) }; i = fence.next - 1; continue; }
    const jo = NEEDS_JO_LINE.exec(bare);
    // An empty question still flags the draft, so it is never treated as fully answered.
    if (jo) { needsAnswer.push(jo[1]!.replace(/[*_]+$/, "").trim() || "(question not given)"); continue; }
    if (NEEDS_YOU_LINE.test(bare)) { needsYou = true; continue; }
    keep.push(line.replace(/[ \t]+$/, ""));
  }
  const body = keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { body, needsAnswer, needsYou, actions };
}

/** needs_answer / needs_you from a saved draft's details (bad or missing values = none). */
export function draftNeeds(details: Record<string, unknown> | null | undefined): { needsAnswer: string[]; needsYou: boolean } {
  const a = details?.["needs_answer"];
  return {
    needsAnswer: Array.isArray(a) ? a.filter((q): q is string => typeof q === "string" && q.trim() !== "").map((q) => q.trim()) : [],
    needsYou: details?.["needs_you"] === true,
  };
}

/** "Save as a standard answer" starts with the first question as the topic and Jo's sent words, without the greeting and sign-off. */
export function saveAnswerPrefill(questions: string[], sentBody: string): { topic: string; answer: string } {
  const lines = stripSignOff(sentBody.replace(/\r/g, "")).split("\n");
  if (lines.length && /^(hi|hey|hello|g'day|dear)\b[^\n]{0,40}[,!.]?\s*$/i.test(lines[0]!.trim())) lines.shift();
  return { topic: (questions[0] ?? "").trim().slice(0, 80), answer: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

const PLACEHOLDER_RE = /<(?:name|address|suburb|postcode|link|email|phone|job)>/gi;

/** Problems that stop a draft being sent as written (checked again at send). */
export function aiReplyProblems(body: string, opts: { preRelease?: boolean } = {}): string[] {
  const out: string[] = [];
  // A sign-off on its own (e.g. the AI wrote only office notes) is still an empty reply.
  if (!stripSignOff(body).trim()) out.push("The reply is empty.");
  if (/\bVEECs?\b|\bVEU\b|Activity 48/i.test(body)) out.push("Say “rebate” instead of scheme words.");
  PHONE.lastIndex = 0;
  if (PHONE.test(body)) out.push("Take out the phone number.");
  PHONE.lastIndex = 0;
  if (/\b(call|ring|phone)\s+(us|the office|our office)\b/i.test(body)) out.push("Take out “call us”.");
  if (/\bNEEDS[_ ]?(?:JO|YOU)[*_]{0,2}\s*:/i.test(body) || /\bNEEDS[_ ]?(?:JO|YOU)[*_]{0,2}\s*[-–]/.test(body)
    || /^[\s*_`>-]*needs[_ ]?(?:jo|you)[*_]{0,2}\s*[:\-–]/im.test(body) || /\bACTIONS[*_]{0,2}\s*:/.test(body)
    || /\{\s*"installer_note"/.test(body) || /"new_area_m2"/.test(body)) out.push("Take out the AI's note to the office (NEEDS_JO…).");
  // Placeholders copied from Jo's scrubbed style examples.
  for (const ph of new Set((body.match(PLACEHOLDER_RE) ?? []).map((m) => m.toLowerCase()))) out.push(`Take out the placeholder ${ph} — write the real wording`);
  if (/\bfixes\b/i.test(body)) out.push("Say “electrical upgrades” instead of “fixes”.");
  // First mention is "electrical safety check (PIESA)"; later plain "safety check" is fine once PIESA has been named.
  if (/\bsafety check\b/i.test(body) && !/\bPIESA\b/i.test(body)) out.push("Say “electrical safety check (PIESA)”.");
  if (opts.preRelease) {
    const bad = aiPreReleaseViolations(body);
    if (bad.length) out.push(`Take out “${bad.join("”, “")}” — we can't promise timing before their spot is released.`);
  }
  return out;
}

export const AI_FIX_TRIES = 2;

export const AI_FIX_INSTRUCTIONS = [
  "You are fixing a draft email reply for Home Insulation Victoria.",
  "The draft breaks the rules listed under PROBLEMS.",
  "Change only the words or sentences that break those rules. Keep everything else word for word, including the greeting and any edits already made.",
  "Do not add a sign-off. Do not add anything new.",
  "Return only the email body, nothing else.",
].join("\n");

const SIGN_WORDS = "(?:cheers|kind regards|best regards|warm regards|regards|thanks|thank you|many thanks|best)";
const TRAILING_TEAM_SIGN_OFF = new RegExp(`(?:^|\\n)[ \\t]*${SIGN_WORDS}[ \\t]*,[ \\t]*(?:the[ \\t]+)?(?:home insulation victoria(?:[ \\t]+team)?|team)[ \\t]*\\.?[ \\t]*$`, "i");
// "Cheers,\nJo", "Cheers,\n\nJo", "Cheers, Jo", "Cheers Jo!", "Thanks,\nJo :)".
const TRAILING_JO_SIGN_OFF = new RegExp(`(?:^|\\n)[ \\t]*${SIGN_WORDS}[ \\t]*[,!.]?(?:[ \\t]*\\n)*[ \\t]*jo\\b[ \\t]*[!.]?[ \\t]*(?::-?\\))?[ \\t]*$`, "i");
/** Removes a trailing sign-off however the AI worded it (our exact one, "Kind regards, the … team", "Cheers,\nJo"), plus surrounding whitespace. */
export function stripSignOff(text: string): string {
  let t = text.trim();
  for (;;) {
    const next = (t.endsWith(AI_SIGN_OFF) ? t.slice(0, -AI_SIGN_OFF.length) : t.replace(TRAILING_JO_SIGN_OFF, "").replace(TRAILING_TEAM_SIGN_OFF, "")).trim();
    if (next === t) return t;
    t = next;
  }
}

/** What the fix call is sent: the problems, then the draft without its sign-off. */
export function buildAiFixInput(body: string, problems: string[], preRelease: boolean): string {
  const draft = stripSignOff(body);
  const parts = ["PROBLEMS:", ...problems.map((p) => `- ${p}`)];
  if (preRelease) parts.push("", "This wording IS allowed:", AI_RELEASE_MEANS, AI_WAIT_LINE);
  parts.push("", "DRAFT:", draft);
  return parts.join("\n");
}

/** Rewrites a draft that breaks Jo's rules, at most AI_FIX_TRIES AI calls. `ai` is injected so this stays pure. */
export async function fixUntilClean(
  body: string,
  preRelease: boolean,
  ai: (input: string, instructions: string) => Promise<string>,
): Promise<{ body: string; problems: string[]; tries: number }> {
  let current = body;
  let problems = aiReplyProblems(current, { preRelease });
  let tries = 0;
  if (!stripSignOff(body).trim()) return { body, problems, tries }; // nothing to rewrite (empty or sign-off only); never ask the AI to invent a reply
  while (problems.length && tries < AI_FIX_TRIES) {
    tries++;
    let raw: string;
    try {
      raw = await ai(buildAiFixInput(current, problems, preRelease), AI_FIX_INSTRUCTIONS);
    } catch {
      break;
    }
    const text = stripSignOff(raw ?? "");
    if (!text || text.replace(/[.\s]+$/, "") === NO_REPLY_NEEDED) continue;
    // finishAiReply only strips a two-line sign-off; our exact one-line sign-off is dropped first so it is never doubled.
    current = finishAiReply(text);
    problems = aiReplyProblems(current, { preRelease });
  }
  return { body: current, problems, tries };
}

export function replySubject(theirs: string | null): string {
  const s = (theirs ?? "").trim();
  return !s ? "Re: Your insulation job" : /^re:/i.test(s) ? s : `Re: ${s}`;
}
