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
import type { SpotReleaseState } from "./spot-release.core";

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
/** The AI returns exactly this when the email needs no reply (a plain "no thanks" or "thanks"). Jo 27 Oct: file those away. */
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
const instructionLines = (NEXT_STEP: string, preRelease: boolean) => [
  "You write email replies from the Home Insulation Victoria team to home owners about their ceiling insulation. The office reads and sends each one.",
  "Tone: kind, warm and plain, in Australian English, like a real person in our office. Short sentences. Never robotic or call-centre. Never say \"No worries\". Never sign or mention a person's name for us.",
  "Start with \"Hi <first name>,\" on its own line (or \"Hi there,\" if no name), then a short thank-you that fits what they wrote.",
  "Answer every question they asked, directly and specifically, using the job facts below (their ceiling size, price, rebate, whether their spot is saved). If they asked several things, answer each one in a short list.",
  "Never say \"we'll check and get back to you\" when the answer is in the facts or the business rules. Only if something truly isn't covered, say we'll find out and reply.",
  "Keep it relevant: only use a fact or business rule when it answers something they actually raised. Never volunteer extra details they didn't ask about (for example, don't mention batts versus blow-in unless they asked about blow-in).",
  NEXT_STEP,
  "If they say they can't get into the roof or take photos, kindly tell them not to go up there — they don't need to send photos.",
  "Only use the facts, rules and links given below. Never invent dates, prices, times, people or links. Never quote an R6.0 or R7.0 price.",
  "Say \"rebate\" — never say VEEC, VEECs, VEU, Activity 48, ESC or other scheme jargon.",
  "Never ask them to call, never give a phone number. They can just reply to this email.",
  ...(preRelease ? [] : ["If they want to change a booking time, give them the change link provided and say who they'll arrange it with. Never promise a new time yourself."]),
  `If their email is only a plain "no thanks", "not going ahead", "thanks" or similar and needs no answer, return exactly ${"NO_REPLY_NEEDED"} and nothing else.`,
  "Do not include a sign-off; it is added for you.",
  "Return only the email body text, no subject line.",
];

export const AI_REPLY_INSTRUCTIONS = instructionLines(NEXT_STEP_RELEASED, false).join("\n");

/** Decision 388: pre-release = our own lead (hivic_sourced) at a pre-release stage (`isPreReleaseStage`, shared with the
 *  reply composer) whose spot is not released AND confirmed. Any other stage or channel keeps today's behaviour. */
export function isPreReleaseOwner(j: { channel: string | null | undefined; stage: string | null | undefined; releaseState: SpotReleaseState | null | undefined }): boolean {
  if (j.channel !== "hivic_sourced") return false;
  if (!isPreReleaseStage(j.stage)) return false;
  return j.releaseState?.state !== "confirmed";
}

export type AiPromptOpts = { preRelease?: boolean };
/** The prompt for this owner; released owners get AI_REPLY_INSTRUCTIONS unchanged. */
export const aiReplyInstructions = (o: AiPromptOpts = {}): string => (o.preRelease ? instructionLines(NEXT_STEP_PRE_RELEASE, true).join("\n") : AI_REPLY_INSTRUCTIONS);


/** Jo's standing answers (27 Oct 2026), given to the AI with every job reply. */
const RULE_CEILING_ONLY = "We only do ceiling insulation (no underfloor or walls).";
const RULE_BATTS_ONLY = "Our quotes are for R5.0 batts, not blow-in insulation, so no holes are cut in the ceiling.";
const RULE_OWN_ELECTRICIAN = "An owner's own electrician can do the safety check if they sign up with us as an electrician first (we check their licence and $5 million public liability insurance, and all forms go through our system so the rebate can be claimed): https://portal.homeinsulationvictoria.com.au/electrician-onboarding";
export const AI_BUSINESS_RULES = [
  RULE_CEILING_ONLY,
  RULE_BATTS_ONLY,
  "R6.0 and R7.0 are available; the installer confirms the price at the free Ready Check (never quote it).",
  "Old insulation is removed only where needed, at $15/m²; the installer checks how much at the Ready Check.",
  "Extras like cleaning the roof cavity: the installer can quote them at the Ready Check.",
  "The free Ready Check: a certified installer comes to the home, measures the ceilings, checks the existing insulation and confirms the job, then the owner gets their final quote. They see the exact price before agreeing to anything.",
  "The rebate needs any existing insulation to be below R2.0, and it has to be checked at the Ready Check — age alone isn't enough. Owners never need to go into the roof or send photos.",
  "Spots are released in the order they were saved, so we can't give install dates before that. When it's their turn an installer texts and emails a few times for the Ready Check.",
  "After they accept the quote, a licensed electrician does a safety check before any insulation goes in, then the installer puts the insulation in. We look after all the paperwork and the rebate.",
  "The price includes: the free Ready Check; R5.0 batts supplied and installed by a certified installer; the electrician's safety check ($349); our Accredited Person fee for the paperwork and rebate claim ($349). Electrical repairs aren't included — if needed they get a separate quote first.",
  RULE_OWN_ELECTRICIAN,
];

/** Business rules before release: the Ready Check may be explained (Jo's release and wait lines), but nothing that gives a date, timeframe or speed. */
export const AI_BUSINESS_RULES_PRE_RELEASE = [
  RULE_CEILING_ONLY,
  RULE_BATTS_ONLY,
  SPOT_FREE,
  SPOT_REGISTERED,
  SPOT_RELEASE_LINE,
  AI_RELEASE_MEANS,
  AI_WAIT_LINE,
  SPOT_PRICE_NOTE,
  RULE_OWN_ELECTRICIAN,
];


export function buildAiReplyInput(c: AiReplyContext, o: AiPromptOpts = {}): string {
  const pre = o.preRelease === true;
  const hist = c.history.slice(-15).map((h) => `[${h.direction === "inbound" ? "Owner" : "Us"} ${h.at.slice(0, 16)}] ${h.subject ?? ""}\n${h.body.slice(0, 1200)}`).join("\n\n");
  return [
    `Job ${c.jobNumber ?? "(no number)"} · owner first name: ${c.ownerFirstName ?? "unknown"}`,
    ...(pre ? [] : [`Current stage: ${c.stageLabel}`]),
    c.facts.length ? `Facts:\n- ${c.facts.join("\n- ")}` : "Facts: none recorded",
    `Business rules:\n- ${(pre ? AI_BUSINESS_RULES_PRE_RELEASE : AI_BUSINESS_RULES).join("\n- ")}`,
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
  const cleaned = text.replace(/as\s+soon\s+as\s+(?:your|their)\s+spot(?:\s+is|['’]s)\s+released/gi, " ");
  return [...new Set((cleaned.match(AI_PRE_RELEASE_TIMING) ?? []).map((m) => m.toLowerCase().replace(/\s+/g, " ")))];
}

/** Problems that stop a draft being sent as written (checked again at send). */
export function aiReplyProblems(body: string, opts: { preRelease?: boolean } = {}): string[] {
  const out: string[] = [];
  if (!body.trim()) out.push("The reply is empty.");
  if (/\bVEECs?\b|\bVEU\b|Activity 48/i.test(body)) out.push("Say “rebate” instead of scheme words.");
  PHONE.lastIndex = 0;
  if (PHONE.test(body)) out.push("Take out the phone number.");
  PHONE.lastIndex = 0;
  if (/\b(call|ring|phone)\s+(us|the office|our office)\b/i.test(body)) out.push("Take out “call us”.");
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

const SIGN_WORDS = "(?:cheers|kind regards|regards|thanks|many thanks|best)";
const TRAILING_TEAM_SIGN_OFF = new RegExp(`(?:^|\\n)[ \\t]*${SIGN_WORDS}[ \\t]*,[ \\t]*(?:the[ \\t]+)?(?:home insulation victoria(?:[ \\t]+team)?|team)[ \\t]*\\.?[ \\t]*$`, "i");
const TRAILING_JO_SIGN_OFF = new RegExp(`(?:^|\\n)[ \\t]*${SIGN_WORDS}[,!.]?[ \\t]*\\n+[ \\t]*jo[ \\t]*$`, "i");
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
  if (!body.trim()) return { body, problems, tries }; // nothing to rewrite; never ask the AI to invent a reply
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
