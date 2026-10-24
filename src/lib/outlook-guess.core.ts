// Decision 247 (Jo 24 Oct 2026): mail the Outlook copier cannot match (property managers, family, new addresses)
// raises ONE Needs me row "Match this email" with the portal's BEST GUESS of the job. Pure: which lookups to run
// (job numbers, street addresses, names, postcodes written in the mail) and how to score the jobs they return.
// A guess is only a suggestion shown to the office; nothing is filed on a job until the office taps Match.
// Imports nothing (the Outlook copier test harness loads this file).

export const EMAIL_UNMATCHED_EVENT = "email_unmatched";
export const EMAIL_UNMATCHED_MATCHED_EVENT = "email_unmatched_matched";
export const EMAIL_UNMATCHED_DISMISSED_EVENT = "email_unmatched_dismissed";
export const UNMATCHED_SNIPPET_CHARS = 300;
export const MAX_GUESSES = 3;

export type GuessMail = { subject: string | null; body: string; from: string | null; fromName: string | null };
export type GuessJob = {
  id: string; jobNumber: string; ownerName: string | null; ownerEmail: string | null;
  addressLine: string | null; suburb: string | null; postcode: string | null;
};
export type JobGuess = { jobId: string; jobNumber: string; score: number; why: string[] };

const STREET_TYPES = "street|st|road|rd|avenue|ave|av|drive|dr|court|ct|crescent|cres|cr|place|pl|parade|pde|lane|ln|way|close|cl|grove|gr|boulevard|blvd|terrace|tce|highway|hwy|circuit|cct|square|sq";
const ABBR: Record<string, string> = { street: "st", road: "rd", avenue: "ave", av: "ave", drive: "dr", court: "ct", crescent: "cres", cr: "cres", place: "pl", parade: "pde", lane: "ln", close: "cl", grove: "gr", boulevard: "blvd", terrace: "tce", highway: "hwy", circuit: "cct", square: "sq" };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9/ ]/g, " ").replace(/\s+/g, " ").trim()
  .split(" ").map((w) => ABBR[w] ?? w).join(" ");

/** "12 Smith Street" / "3/45 Long Rd" fragments written in the mail, normalised ("12 smith st"). */
export function addressFragments(text: string): string[] {
  const re = new RegExp(`\\b(\\d{1,4}[a-z]?(?:\\s*/\\s*\\d{1,4}[a-z]?)?)\\s+((?:[a-z']+\\s+){1,3}?)(${STREET_TYPES})\\b`, "gi");
  const out = new Set<string>();
  for (const m of text.matchAll(re)) out.add(norm(`${m[1]!.replace(/\s+/g, "")} ${m[2]!.trim()} ${m[3]!}`));
  return [...out].slice(0, 5);
}

/** Victorian postcodes written in the mail (3xxx / 8xxx). */
export function postcodesIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\b([38]\d{3})\b/g)].map((m) => m[1]!))].slice(0, 5);
}

const NOT_NAMES = new Set(["hi", "hello", "dear", "thanks", "thank", "regards", "kind", "cheers", "team", "info", "admin", "office", "sent", "from", "the", "home", "insulation", "victoria", "property", "manager", "real", "estate"]);
/** Person names worth looking up: the sender's display name and a sign-off name ("Thanks, Jane Citizen"). */
export function namesIn(m: Pick<GuessMail, "fromName" | "body">): string[] {
  const out = new Set<string>();
  const ok = (n: string) => n.split(/\s+/).filter((w) => w.length >= 2 && !NOT_NAMES.has(w.toLowerCase())).join(" ");
  if (m.fromName && /[a-z]/i.test(m.fromName) && !/@/.test(m.fromName)) { const n = ok(m.fromName.trim()); if (n.split(" ").length >= 2) out.add(n); }
  const sign = m.body.match(/\b(?:regards|thanks|thank you|cheers|kind regards|best)\s*,?\s*\n+\s*([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){1,2})\s*(?:\n|$)/);
  if (sign?.[1]) { const n = ok(sign[1]); if (n.split(" ").length >= 2) out.add(n); }
  return [...out].slice(0, 3);
}

/** Job numbers written in the mail (same pattern the copier uses). */
export function jobNumbersIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\bHV[-\s]?(\d{3,6})\b/gi)].map((x) => `HV-${x[1]}`))];
}

/** What the server should look up to build the candidate pool (bounded). */
export function guessLookups(m: GuessMail): { jobNumbers: string[]; addresses: string[]; names: string[]; postcodes: string[]; surnames: string[] } {
  const text = `${m.subject ?? ""}\n${m.body}`;
  const names = namesIn(m);
  return {
    jobNumbers: jobNumbersIn(text), addresses: addressFragments(text), names, postcodes: postcodesIn(text),
    surnames: [...new Set(names.map((n) => n.split(" ").at(-1)!).filter((s) => s.length >= 3))],
  };
}

/** Score each candidate job against the mail: job number > street address > owner name > suburb/postcode.
 *  Returns at most MAX_GUESSES with a score of at least 30, best first; ties keep job-number order. */
export function guessJobsForEmail(m: GuessMail, jobs: GuessJob[], max = MAX_GUESSES): JobGuess[] {
  const text = `${m.subject ?? ""}\n${m.body}`;
  const hay = ` ${norm(text)} `;
  const numbers = new Set(jobNumbersIn(text));
  const frags = addressFragments(text);
  const names = namesIn(m).map((n) => n.toLowerCase());
  const postcodes = new Set(postcodesIn(text));
  const fromLocal = (m.from ?? "").split("@")[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  const out: JobGuess[] = [];
  for (const j of jobs) {
    let score = 0; const why: string[] = [];
    if (numbers.has(j.jobNumber.toUpperCase())) { score += 100; why.push(`mentions ${j.jobNumber}`); }
    const addr = j.addressLine ? norm(j.addressLine.split(",")[0] ?? "") : "";
    if (addr.length >= 5 && (hay.includes(` ${addr} `) || frags.some((f) => f === addr || addr.startsWith(`${f} `) || f.startsWith(`${addr} `)))) { score += 60; why.push(`address ${j.addressLine!.split(",")[0]}`); }
    else if (addr) {
      const [num, ...street] = addr.split(" ");
      const streetName = street.slice(0, -1).join(" ");
      if (num && streetName.length >= 3 && frags.some((f) => f.startsWith(`${num} `) && f.includes(streetName))) { score += 45; why.push(`street ${num} ${streetName}`); }
    }
    const owner = (j.ownerName ?? "").toLowerCase().trim();
    if (owner.split(/\s+/).length >= 2) {
      const surname = owner.split(/\s+/).at(-1)!;
      if (names.includes(owner) || hay.includes(` ${norm(owner)} `)) { score += 35; why.push(`owner name ${j.ownerName}`); }
      else if (surname.length >= 3 && (names.some((n) => n.endsWith(` ${surname}`)) || (fromLocal.length >= 4 && fromLocal.includes(surname)))) { score += 20; why.push(`surname ${surname}`); }
    }
    if (j.postcode && postcodes.has(j.postcode)) { score += 10; why.push(`postcode ${j.postcode}`); }
    if (j.suburb && j.suburb.length >= 4 && hay.includes(` ${norm(j.suburb)} `)) { score += 10; why.push(`suburb ${j.suburb}`); }
    if (score >= 30) out.push({ jobId: j.id, jobNumber: j.jobNumber, score, why });
  }
  return out.sort((a, b) => b.score - a.score || a.jobNumber.localeCompare(b.jobNumber)).slice(0, max);
}

/** First characters of the latest text, whitespace collapsed (the full mail stays in Outlook until matched). */
export function unmatchedSnippet(body: string, n = UNMATCHED_SNIPPET_CHARS): string {
  return body.replace(/\s+/g, " ").trim().slice(0, n);
}

/** Open = an unmatched email with no later matched/dismissed event pointing at it. */
export function openUnmatched<T extends { id: string }>(rows: T[], resolutions: { unmatched_event_id: string | null | undefined }[]): T[] {
  const done = new Set(resolutions.map((r) => r.unmatched_event_id).filter(Boolean));
  return rows.filter((r) => !done.has(r.id));
}
