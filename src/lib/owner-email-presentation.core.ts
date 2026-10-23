// Display-only email cleaning. Original correspondence and workflow history remain untouched.
export function cleanOwnerEmail(value: string | null | undefined): string {
  const text = (value ?? "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<(?:br\s*\/?|\/p|\/div|\/tr)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
  const lines = text.replace(/\r/g, "").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const s = line.trim();
    if (/^(?:>+|On .{0,250}wrote:|From:\s|Sent:\s|[-_]{3,}\s*(?:Original|Forwarded)|Begin forwarded message:)/i.test(s)) break;
    if (/^(?:--\s*$|Sent from my |Get Outlook for |Sent via |Kind regards\b|Best regards\b|Regards[,\s]*$|Cheers[,\s]*$|Yours sincerely\b|Sincerely[,\s]*$|Thanks[,\s]*$|Thank you[,\s]*$|This (?:email|message).*confidential|Confidentiality (?:notice|disclaimer)|Disclaimer:|CAUTION:.*external)/i.test(s)) {
      if (/^(?:Thanks|Thank you)/i.test(s) && !kept.some(x => x.trim())) kept.push(s);
      break;
    }
    kept.push(line.trimEnd());
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type EmailDisplayFacts = { direction?: string | null; provider?: string | null; channel?: string | null; from?: string | null; subject?: string | null; body?: string | null; internal?: boolean };
/** A reply ABOUT an automated subject is still an owner message; never exclude it by subject alone. */
export function isHumanOwnerEmail(c: EmailDisplayFacts): boolean {
  if (c.channel && c.channel !== "email") return false;
  if (c.provider !== "outlook" && c.provider !== "manual") return false;
  const from = c.from ?? "";
  if (c.direction === "inbound" && /(?:@homeinsulationvictoria\.com\.au|mailer-daemon|postmaster|no[-_]?reply|notifications?@|newsletter)/i.test(from)) return false;
  if (/^(?:automatic reply:|auto(?:matic)?[- ]?response:|out of office\b|undeliverable:|delivery (?:status|failure)|mail delivery (?:failed|subsystem))/i.test(c.subject ?? "")) return false;
  const body = cleanOwnerEmail(c.body);
  if (/\b(?:unsubscribe|manage (?:your )?(?:email )?preferences|view (?:this email )?in (?:your )?browser)\b/i.test(body)) return false;
  if (/^(?:I am (?:currently )?(?:out of (?:the )?office|away)|Thank you for (?:your email|contacting).*(?:automatic|out of office)|This is an automated|Your message (?:could not|was not) be delivered)/i.test(body)) return false;
  return c.direction === "inbound" || c.direction === "outbound";
}
export const emailPreview = (body: string | null | undefined) => cleanOwnerEmail(body).replace(/\s+/g, " ").slice(0, 180);
export function emailAge(at: string | null | undefined, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - Date.parse(at ?? "")) / 60000));
  if (!Number.isFinite(mins)) return "emailed";
  return `emailed ${mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h` : `${Math.floor(mins / 1440)}d`} ago`;
}
export function latestPerOwner<T extends { ownerId: string; at: string | null; jobId: string }>(rows: T[]): (T & { jobIds: string[] })[] {
  const groups = new Map<string, T & { jobIds: string[] }>();
  for (const r of [...rows].sort((a,b) => String(b.at).localeCompare(String(a.at)))) {
    const existing = groups.get(r.ownerId);
    if (existing) { if (!existing.jobIds.includes(r.jobId)) existing.jobIds.push(r.jobId); }
    else groups.set(r.ownerId, {...r, jobIds:[r.jobId]});
  }
  return [...groups.values()];
}