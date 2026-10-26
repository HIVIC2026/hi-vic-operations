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

export const AI_EMAIL_DRAFT_EVENT = "email_ai_draft";
export const AI_EMAIL_DRAFT_SENT_EVENT = "email_ai_draft_sent";
export const AI_EMAIL_DRAFT_DISCARDED_EVENT = "email_ai_draft_discarded";
export const AI_EMAIL_REPLY_PURPOSE = "owner_email_ai_reply";
/** Master switch for writing AI drafts on jobs. */
export const AI_EMAIL_DRAFTS_ENABLED: boolean = true;
/** Jo 26 Oct: OFF until Jo has seen sample replies and says "send". With it off simple replies are drafts too. */
export const AI_EMAIL_AUTO_SEND_ENABLED: boolean = false;
export const AI_SIGN_OFF = "Cheers, the Home Insulation Victoria team";

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

export const AI_REPLY_INSTRUCTIONS = [
  "You write email replies for Home Insulation Victoria to home owners about their ceiling insulation job.",
  "Tone: friendly and relaxed, like a local who's happy to help. Short and simple, plain Australian English.",
  "Answer their question first, then say the next step. Two to five short sentences.",
  "Start with \"Hi <first name>!\" (or \"Hi there!\" if no name).",
  "Only use facts and links given below. Never invent dates, prices, times, people or links. If you don't know, say we'll check and get back to them.",
  "Say \"rebate\" — never say VEEC, VEECs, VEU, Activity 48, ESC or other scheme jargon.",
  "Never ask them to call, never give a phone number. They can just reply to this email.",
  "If they want to change a booking time, give them the change link provided and say who they'll arrange it with. Never promise a new time yourself.",
  "Do not include a sign-off; it is added for you.",
  "Return only the email body text, no subject line.",
].join("\n");

export function buildAiReplyInput(c: AiReplyContext): string {
  const hist = c.history.slice(-15).map((h) => `[${h.direction === "inbound" ? "Owner" : "Us"} ${h.at.slice(0, 16)}] ${h.subject ?? ""}\n${h.body.slice(0, 1200)}`).join("\n\n");
  return [
    `Job ${c.jobNumber ?? "(no number)"} · owner first name: ${c.ownerFirstName ?? "unknown"}`,
    `Current stage: ${c.stageLabel}`,
    c.facts.length ? `Facts:\n- ${c.facts.join("\n- ")}` : "Facts: none recorded",
    c.links.length ? `Links you may use:\n${c.links.map((l) => `- ${l.label}: ${l.url}`).join("\n")}` : "Links: none — do not offer a link",
    c.changeLink ? `To change the time of ${WHO[c.changeLink.visit]}, they use: ${c.changeLink.link}` : "No change-time link is available — if they want to change a time, say we'll sort it and get back to them.",
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
  t = t.replace(/\n*(cheers|kind regards|regards|thanks|many thanks|best)[,!]?\s*\n[^\n]*(home insulation victoria|team)[^\n]*$/i, "").trim();
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
  if (/\/estimate\/[^/\s]+\/video\b/.test(url)) return "Save my spot";
  return "Open link";
}

/**
 * The AI reply as an email in the refreshed look (27 Oct 2026, not approved by Jo: same frame and layout as the O76 automatic replies):
 * greeting line, short paragraphs, each link as a green button, sign-off on its own lines.
 */
export function aiReplyEmailHtml(body: string, o: { subject: string; unsubscribe: string | null; test?: boolean }): string {
  const URL_RE = /https?:\/\/[^\s<>"]+/g;
  const paras = body.replace(/\r/g, "").trim().split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  paras.forEach((para, i) => {
    if (i === 0 && /^(hi|hey|hello|g'day)\b[^\n]{0,40}[!,]$/i.test(para)) { out.push(`<mj-text mj-class="hi" padding="18px 12px 12px">${esc(para)}</mj-text>`); return; }
    if (para === AI_SIGN_OFF || /^cheers,/i.test(para) && i === paras.length - 1) {
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

/** Problems that stop a draft being sent as written (checked again at send). */
export function aiReplyProblems(body: string): string[] {
  const out: string[] = [];
  if (!body.trim()) out.push("The reply is empty.");
  if (/\bVEECs?\b|\bVEU\b|Activity 48/i.test(body)) out.push("Say “rebate” instead of scheme words.");
  PHONE.lastIndex = 0;
  if (PHONE.test(body)) out.push("Take out the phone number.");
  PHONE.lastIndex = 0;
  if (/\b(call|ring|phone)\s+(us|the office|our office)\b/i.test(body)) out.push("Take out “call us”.");
  return out;
}

export function replySubject(theirs: string | null): string {
  const s = (theirs ?? "").trim();
  return !s ? "Re: Your insulation job" : /^re:/i.test(s) ? s : `Re: ${s}`;
}
