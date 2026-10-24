// O7 Communications (decisions 16, 159, 165, 248; audit §7): pure rules for Held & queued, Sent, Failed and Outlook.
// No database, no network. Decision 165: a held message is a RECORD of a blocked attempt — it never sends on its own,
// so "Cancel" only removes it from the held list (and, for queued follow-up emails, stops the queued row). Nothing here
// retries anything (SMS rule: no automatic retry).

export type HeldSource = "sms" | "followup" | "message";
export type HeldItem = {
  key: string; // "sms:<id>" | "fu:<id>" | "jc:<id>"
  source: HeldSource;
  type: string;
  label: string;
  channel: "email" | "text";
  audience: "owner" | "partner";
  state: "held" | "queued";
  reason: string;
  who: string;
  jobId: string | null;
  jobNumber: string | null;
  at: string; // when it would have gone / will go
};
export type HeldGroup = { id: string; label: string; channel: "email" | "text"; audience: "owner" | "partner"; state: "held" | "queued"; reason: string; count: number; items: HeldItem[] };

/** Short "why" for a held attempt, from the sender's own blocker text (sms.core smsBlocker and the follow-up planner). */
export function heldReason(detail: string | null | undefined, channel: "email" | "text"): string {
  const d = (detail ?? "").toLowerCase();
  if (!d) return channel === "text" ? "held" : "held";
  if (d.includes("customer communications are switched off") || d.includes("customer_comms") || d.includes("comms off")) return channel === "text" ? "customer texts off" : "customer emails off";
  const sw = /"(.+)" texts are switched off/i.exec(detail ?? "");
  if (sw) return `${sw[1]!.replace(/\s*\(.*$/, "").replace(/ –.*$/, "").toLowerCase()} texts off`;
  if (d.includes("wording not approved")) return "wording not approved";
  if (d.includes("quiet") || d.includes("8pm") || d.includes("7am")) return "quiet hours";
  if (d.includes("stop")) return "replied STOP";
  if (d.includes("consent")) return "no contact consent";
  if (d.includes("too late") || d.includes("no longer current") || d.includes("never sent late")) return "too late to send";
  if (d.includes("not an australian mobile")) return "not a mobile number";
  if (d.includes("sending number")) return "no sending number";
  if (d.includes("deleted")) return "job deleted";
  if (d.includes("backlog")) return "backlog cut-off not set";
  if (d.includes("no_owner_email")) return "no owner email";
  return (detail ?? "").slice(0, 60);
}

/** Group held/queued items by message type + channel (the O7 "Held & queued" rows), biggest first; queued after held. */
export function groupHeld(items: readonly HeldItem[]): HeldGroup[] {
  const map = new Map<string, HeldGroup>();
  for (const it of items) {
    const id = `${it.state}:${it.channel}:${it.type}`;
    const g = map.get(id) ?? { id, label: it.label, channel: it.channel, audience: it.audience, state: it.state, reason: it.reason, count: 0, items: [] };
    g.items.push(it);
    g.count += 1;
    map.set(id, g);
  }
  for (const g of map.values()) {
    const tally = new Map<string, number>();
    for (const it of g.items) tally.set(it.reason, (tally.get(it.reason) ?? 0) + 1);
    g.reason = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? g.reason;
    g.items.sort((a, b) => b.at.localeCompare(a.at));
  }
  return [...map.values()].sort((a, b) => (a.state === b.state ? b.count - a.count || a.label.localeCompare(b.label) : a.state === "held" ? -1 : 1));
}

/** Parse a cancel request's keys into the three stores; anything else is rejected (never guessed). */
export function splitHeldKeys(keys: readonly string[]): { sms: string[]; followups: string[]; messages: string[]; invalid: string[] } {
  const out = { sms: [] as string[], followups: [] as string[], messages: [] as string[], invalid: [] as string[] };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const k of new Set(keys)) {
    const [src, id] = k.split(":");
    if (!id || !uuid.test(id)) { out.invalid.push(k); continue; }
    if (src === "sms") out.sms.push(id); else if (src === "fu") out.followups.push(id); else if (src === "jc") out.messages.push(id); else out.invalid.push(k);
  }
  return out;
}

/** Plain-words failure reason for the Failed tab (provider text kept short). */
export function failureReason(detail: string | null | undefined): string {
  const d = (detail ?? "").toLowerCase();
  if (!d) return "Not delivered (no reason given)";
  if (d.includes("bounce") || d.includes("not found") || d.includes("does not exist") || d.includes("invalid recipient")) return "Bounced · address not found";
  if (d.includes("mailbox full") || d.includes("quota")) return "Mailbox full";
  if (d.includes("30003") || d.includes("unreachable")) return "Phone unreachable";
  if (d.includes("30005") || d.includes("unknown destination")) return "Number not in service";
  if (d.includes("30006") || d.includes("landline") || d.includes("carrier") || d.includes("21614") || d.includes("21211")) return "Number rejected by the carrier";
  if (d.includes("30007") || d.includes("filtered") || d.includes("spam")) return "Blocked as spam by the carrier";
  if (d.includes("may have sent") || d.includes("no answer")) return "Unknown — may have sent; not retried";
  if (d.includes("not set up")) return "Sender not set up";
  return (detail ?? "").replace(/\s+/g, " ").slice(0, 90);
}

/** Outlook copier state (record-only rule): matched → recorded on the job; unmatched → stays in Outlook; not a customer → ignored. */
export function outlookState(route: { kind?: string } | null | undefined, direction: string | null | undefined, status: string | null | undefined): string {
  const k = route?.kind;
  if (k === "job") return status === "complete" ? (direction === "outbound" ? "Recorded · sent from Outlook" : "Recorded on the job") : "Being recorded";
  if (k === "unmatched") return "Unmatched · stays in Outlook";
  if (k === "not_homeowner") return "Not a customer · stays in Outlook";
  return "Waiting";
}
