// AI replies step 3: Jo's recent replies as style examples. Pure picking and scrubbing; the reader is ai-style.server.ts.
// Examples teach tone only. Other owners' names, addresses, emails, phones and links never reach the AI.
export type StyleExample = { theirEmail: string; reply: string; at: string };

const STOP = new Set(["this", "that", "with", "have", "from", "your", "about", "would", "there", "their", "what", "when", "will", "been", "were", "they", "them", "then", "than", "just", "also", "please", "thanks", "thank", "hello", "regards", "cheers", "could", "should", "which", "because", "into", "some", "more", "very", "much", "like", "know", "need", "want", "email", "sent", "back"]);

/** Distinct lowercase words of 4+ letters, minus a few filler words. */
export function topicWordsOf(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w)))];
}

/** Prefer examples sharing words with the owner's email, then the newest. */
export function pickStyleExamples(rows: StyleExample[], topicWords: string[], max = 8): StyleExample[] {
  const words = [...new Set(topicWords.map((w) => w.toLowerCase()).filter((w) => w.length >= 4 && !STOP.has(w)))];
  const score = (r: StyleExample) => { const t = new Set(r.theirEmail.toLowerCase().match(/[a-z]+/g) ?? []); return words.filter((w) => t.has(w)).length; };
  return rows.map((r) => ({ r, s: score(r) }))
    .sort((a, b) => b.s - a.s || (a.r.at < b.r.at ? 1 : a.r.at > b.r.at ? -1 : 0))
    .slice(0, max).map((x) => x.r);
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /\(0?[2-478]\)[\s-]?\d{4}[\s-]?\d{4}\b|(\+?61[\s-]?|\b0)[2-478](?:[\s-]?\d){8}\b|\b1[38]00(?:[\s-]?\d){6}\b|\b13(?:[\s-]?\d){4}\b/g;
const SUFFIX = "St|Street|Rd|Road|Ave|Avenue|Ct|Court|Cres|Crescent|Dr|Drive|Pl|Place|Ln|Lane|Way|Pde|Parade|Hwy|Blvd|Cl|Close|Gr|Grove|Tce|Terrace";
const ADDRESS_RE = new RegExp(`\\b(?:(?:unit|apt|apartment|flat|suite|shop)\\s+)?\\d{1,5}[A-Za-z]?(?:/\\d{1,5}[A-Za-z]?)?\\s+(?:[A-Za-z'’-]+\\s+){0,3}?(?:${SUFFIX})\\b\\.?`, "gi");
const NOT_DATE = "(?!(?:January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\\b)";
const STREET_NO_SUFFIX_RE = new RegExp(`\\b\\d{1,5}[A-Za-z]?\\s+${NOT_DATE}(?:[A-Z][a-z'’-]+\\s?){1,3}?(?=,|\\s+\\d{4}\\b)`, "g");
const ST = "(?:VIC|NSW|QLD|SA|WA|TAS|ACT|NT)";
const ADDRESS_TAIL_RE = new RegExp(`<address>(?:,?\\s+(?:[A-Z][a-z]+\\s+){0,3}${ST}\\s+\\d{4}\\b|,?\\s+(?:[A-Z][a-z]+\\s+){0,3}\\d{4}\\b|,\\s*[A-Z][a-z]+(?:\\s[A-Z][a-z]+){0,2}(?:\\s+${ST})?(?=[\\s.,;!)]|$))`, "g");
const STATE_POSTCODE_RE = new RegExp(`\\b${ST}\\s+\\d{4}\\b`, "g");
const VIC_POSTCODE_RE = /(?<=\b[A-Z][a-z]+\s)(?:3\d{3}|8\d{3})\b/g;
const GREETING_RE = /^([ \t]*(?:hi|hey|hello|dear|g['’]day|gday|good (?:morning|afternoon|evening))[ \t]+)(?!there\b|team\b|all\b|everyone\b)[^\n,!.:;]+/gim;
const SIGNOFF = "(?:cheers|thanks|thank you|regards|kind regards|best regards|best)";
const NAME_LINE = "(?!Home\\b|Team\\b)[A-Z][a-z'’-]+(?:[ \\t]+[A-Z][a-z'’-]+)?";
const SIGNOFF_SAME_RE = new RegExp(`^([ \\t]*${SIGNOFF}[ \\t,]+)${NAME_LINE}([ \\t]*[,!.]?[ \\t]*)$`, "gim");
const SIGNOFF_NEXT_RE = new RegExp(`^([ \\t]*${SIGNOFF}[ \\t]*,?[ \\t]*\\n(?:[ \\t]*\\n)*[ \\t]*)${NAME_LINE}([ \\t]*)$`, "gim");
const JOB_RE = /\bHV-\d+\b/gi;
const MAX_LEN = 1200;

const SIGNOFF_WORD = "(?:[Cc]heers|[Tt]hanks|[Tt]hank you|[Mm]any thanks|[Kk]ind regards|[Bb]est regards|[Ww]arm regards|[Rr]egards|[Bb]est|CHEERS|THANKS)";
const SIGNOFF_LINE_RE = new RegExp(`^[ \\t]*${SIGNOFF_WORD}[ \\t]*[,!.]?[ \\t]*(?:[A-Z][a-z'’-]+(?:[ \\t]+[A-Z][a-z'’-]+)?)?[ \\t]*[,!.]?[ \\t]*(?::-?\\))?[ \\t]*$`);
/** Jo's own words only: drops the sign-off line and everything after it (her name, signature block). */
export function cutAtSignOff(reply: string): string {
  const lines = reply.replace(/\r/g, "").split("\n");
  const at = lines.findIndex((l, i) => i > 0 && l.trim() !== "" && SIGNOFF_LINE_RE.test(l));
  return (at === -1 ? lines : lines.slice(0, at)).join("\n").trim();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replaces the example job's own known details first (exact), then catches the rest with patterns. */
export function scrubExample(reply: string, owner: { name?: string; address?: string; suburb?: string; postcode?: string }): string {
  let t = reply.replace(URL_RE, "<link>").replace(JOB_RE, "<job>").replace(EMAIL_RE, "<email>").replace(PHONE_RE, "<phone>");
  if (owner.address?.trim()) t = t.replace(new RegExp(`(?:(?:unit|apt|apartment|flat|suite|shop)\\s+)?(?:\\d{1,5}[A-Za-z]?/)?${esc(owner.address.trim())}`, "gi"), "<address>");
  if (owner.postcode?.trim()) t = t.replace(new RegExp(`(?<!\\d)${esc(owner.postcode.trim())}(?!\\d)`, "g"), "<postcode>");
  if (owner.suburb?.trim()) t = t.replace(new RegExp(`(?<![A-Za-z<])${esc(owner.suburb.trim())}(?![A-Za-z>])`, "gi"), "<suburb>");
  // Only capitalised uses, so a name like "Will May Best" never garbles "we will do our best".
  for (const part of (owner.name ?? "").split(/\s+/).filter((p) => p.length >= 2)) {
    const rest = [...part.slice(1)].map((ch) => /[a-z]/i.test(ch) ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : esc(ch)).join("");
    t = t.replace(new RegExp(`(?<![A-Za-z<])${esc(part[0]!.toUpperCase())}${rest}(?![A-Za-z>])`, "g"), "<name>");
  }
  t = t.replace(ADDRESS_RE, "<address>").replace(STREET_NO_SUFFIX_RE, "<address>").replace(ADDRESS_TAIL_RE, "<address>")
    .replace(STATE_POSTCODE_RE, "<postcode>").replace(VIC_POSTCODE_RE, "<postcode>")
    .replace(GREETING_RE, "$1<name>").replace(SIGNOFF_SAME_RE, "$1<name>$2").replace(SIGNOFF_NEXT_RE, "$1<name>$2");
  return t.slice(0, MAX_LEN);
}
