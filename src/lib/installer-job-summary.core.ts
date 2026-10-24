// Jo 23 Oct 2026: installer jobs get one plain office summary instead of the website-lead page (estimate, Gate 1
// table, stage checks). Pure presentation from existing facts — never a workflow, eligibility or quote decision.

export type InstallerSummaryFacts = {
  installer: string | null;
  consent: "granted" | "not_granted" | "unknown" | null;
  mittiAuditId: string | null;
  /** Latest Mitti form problem (automatic creation failed etc.), if no form is linked. */ formProblem: string | null;
  /** Latest ready_check_basics: missing basics and hard stops; null = form not synced yet. */
  basics: { missing: string[]; stops: string[]; completed: boolean } | null;
  heldReasons: string[] | null;
  /** Jo 24 Oct 2026: no installer approval step. held = a check held the quote for the office. */
  quote: null | { total: number | null; sent: boolean; accepted: boolean; declined?: boolean; held: boolean };
  /** Extra office warnings (duplicate, ineligible…) from the New from installers rules. */ warnings: string[];
};

export type InstallerSummary = {
  upTo: string;
  waitingOn: "installer" | "office" | "owner" | "nobody";
  form: { auditId: string | null; status: string; missing: string[] };
  quote: { status: string; total: number | null };
  officeActions: string[];
};

const money = (n: number | null) => (n == null ? "" : ` (${n.toLocaleString("en-AU", { style: "currency", currency: "AUD" })})`);

export function installerJobSummary(f: InstallerSummaryFacts): InstallerSummary {
  const who = f.installer ?? "the installer";
  const missing = [...(f.basics?.missing ?? []), ...(f.basics?.stops ?? [])];
  const officeActions: string[] = [...f.warnings];
  if (f.consent !== "granted") officeActions.push("Owner contact permission isn't recorded — the quote can't be sent until it is");

  const form = !f.mittiAuditId
    ? { auditId: null, status: f.formProblem ?? "Not created yet — it's made automatically within about 15 minutes", missing: [] }
    : !f.basics ? { auditId: f.mittiAuditId, status: `Waiting for ${who} to start it`, missing: [] }
    : missing.length ? { auditId: f.mittiAuditId, status: `${who} still needs to add: ${missing.join(", ")}`, missing }
    : { auditId: f.mittiAuditId, status: f.basics.completed ? "Complete" : "All the basics are in", missing: [] };
  if (f.formProblem && !f.mittiAuditId) officeActions.push(`Mitti form problem: ${f.formProblem}`);

  let quote: InstallerSummary["quote"], upTo: string, waitingOn: InstallerSummary["waitingOn"];
  if (f.quote?.declined) {
    quote = { status: `Declined by the owner${money(f.quote.total)}`, total: f.quote.total };
    upTo = "Owner declined the quote — reopen it on Quotes to check if they change their mind"; waitingOn = "office";
  } else if (f.quote?.accepted) {
    quote = { status: `Accepted by the owner${money(f.quote.total)}`, total: f.quote.total };
    upTo = "Owner accepted the quote — next is the $349 safety check payment, then the electrician"; waitingOn = "owner";
  } else if (f.quote?.sent) {
    quote = { status: `Sent to the owner${money(f.quote.total)}`, total: f.quote.total };
    upTo = "Waiting for the owner to accept the quote"; waitingOn = "owner";
  } else if (f.quote && f.quote.held) {
    // Jo 24 Oct: the installer pressed Complete but a check held the automatic send.
    quote = { status: `Held for you to check${money(f.quote.total)}`, total: f.quote.total };
    upTo = "Quote held — check the reasons on Quotes to check, then send it"; waitingOn = "office";
    officeActions.push(`Check and send the quote${money(f.quote.total)} (Quotes to check)`);
  } else if (f.quote && f.basics?.completed) {
    quote = { status: `Ready for you to check and send${money(f.quote.total)}`, total: f.quote.total };
    upTo = "Quote ready — check it and send it to the owner"; waitingOn = "office";
    officeActions.push(`Check and send the quote${money(f.quote.total)} (Quotes to check)`);
  } else if (f.quote) {
    // Drafted once the basics are in (already on Quotes to check); the installer hasn't pressed Complete yet.
    quote = { status: `Drafted${money(f.quote.total)} — on Quotes to check; ${who} hasn't marked the Ready Check Complete yet`, total: f.quote.total };
    upTo = `Waiting for ${who} to finish the Ready Check and press Complete in Mitti`; waitingOn = "installer";
  } else if (f.heldReasons?.length) {
    quote = { status: `Held: ${f.heldReasons.join("; ")}`, total: null };
    upTo = "Quote held — needs the office"; waitingOn = "office";
    officeActions.push(`Sort out the held quote: ${f.heldReasons.join("; ")}`);
  } else {
    quote = { status: "Not made yet — it's drafted once the Ready Check basics are in", total: null };
    upTo = !f.mittiAuditId ? "Waiting for the Ready Check form to be created in Mitti"
      : `Waiting for ${who} to fill in the Ready Check${missing.length ? ` — missing: ${missing.join(", ")}` : ""}`;
    waitingOn = !f.mittiAuditId ? (f.formProblem ? "office" : "nobody") : "installer";
  }
  return { upTo, waitingOn: officeActions.length && waitingOn === "nobody" ? "office" : waitingOn, form, quote, officeActions };
}
