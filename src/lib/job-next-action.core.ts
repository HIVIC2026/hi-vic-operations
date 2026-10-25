// O2 Job page "Next" panel (decision 218: ONE Next panel, one sentence, one button; 223). Whose move it is, one
// sentence, at most one button, plus "Blocked because …" when the office cannot act yet. PURE: built from the same
// facts as Needs me (office-needs.core) and the office status (office-status.core), so the two can never disagree.
import { needsCandidates, type JobSection, type NeedsFacts } from "./office-needs.core";
import type { JobsStage } from "./office-jobs.core";

export type NextWho = "us" | "owner" | "installer" | "electrician" | "nobody";
export const NEXT_WHO_LABEL: Record<NextWho, string> = { us: "us", owner: "owner", installer: "installer", electrician: "electrician", nobody: "nothing to do" };

export type NextAction = { who: NextWho; sentence: string; button: { label: string; section: JobSection } | null; blocked: string | null };

export type NextInput = {
  facts: NeedsFacts | null;
  status: { key?: string; label: string; waitingOn: string; detail: string | null; dueAt: string | null } | null;
  stage: JobsStage | null;
  closed: { kind: "cancelled" | "complete" | "ineligible"; reason: string | null } | null;
  onHold: { reason: string | null; until: string | null } | null;
  blockers?: string[];
};

const SENTENCE: Partial<Record<string, (f: NeedsFacts) => string>> = {
  choose_again: (f) => `The ${f.offerLapsed?.role ?? "trade"} offer ${f.offerLapsed?.declined ? "was declined" : "lapsed after 24 hours"} — choose another ${f.offerLapsed?.role ?? "trade"}.`,
  choose_installer: () => "Choose the installer for the Ready Check — the offer goes to that installer only.",
  choose_electrician: (f) => `Choose the electrician for the PIESA${f.electricianToChoose?.usual ? ` — ${f.electricianToChoose.usual} is the installer's usual electrician` : ""}.`,
  quote_check: (f) => (f.quoteToCheck?.ready ? "The quote is drafted and every check passed — check it and press Send." : `The quote is held: ${f.quoteToCheck?.reason ?? "something is missing"}.`),
  fixes_quote_check: () => "Check the electrical fixes quote and send it to the owner.",
  sign_consent: (f) => f.consentToSign?.reasons?.length ? `The ESC owner consent's AP part signs itself once this is fixed: ${f.consentToSign.reasons.join(" ")} (Sign is the fallback.)` : "Sign the ESC owner consent as the AP representative before the install.",
  esc_window: () => "Submit the ESC installation notification inside its window.",
  final_check: () => "Install complete — do the final check and approve.",
  veec_a_held: (f) => `VEEC Part A signs itself once these are recorded: ${(f.veecApHeld?.reasons ?? []).join(" ")}`,
  send_failed: (f) => (f.sendFailed ? `A message to the owner failed: ${f.sendFailed.text}` : f.sendUnknown ? f.sendUnknown.text : "A message to the owner failed: "),
};

const WHO_FROM_STATUS: Record<string, NextWho> = {
  Us: "us", Owner: "owner", Installer: "installer", Electrician: "electrician", "Owner + Installer": "installer", "Owner + Electrician": "electrician", System: "nobody", Nobody: "nobody", "Office / campaign": "nobody",
};

export function nextAction(i: NextInput, now: number): NextAction {
  if (i.closed) return { who: "nobody", sentence: i.closed.kind === "complete" ? "Complete. The record is kept for six years." : `${i.closed.kind === "cancelled" ? "Cancelled" : "Not eligible"}${i.closed.reason ? `: ${i.closed.reason}` : ""}. Reopen it from Jobs › Closed if that was wrong.`, button: null, blocked: null };
  if (i.onHold) return { who: "us", sentence: `On hold${i.onHold.reason ? `: ${i.onHold.reason}` : ""}${i.onHold.until ? ` · until ${i.onHold.until}` : ""}. Reminders and texts are paused.`, button: null, blocked: null };
  const top = i.facts ? needsCandidates(i.facts, now)[0] : undefined;
  if (top && i.facts) {
    const watch = top.group === "watch";
    const make = SENTENCE[top.kind];
    return {
      who: watch ? WHO_FROM_STATUS[i.status?.waitingOn ?? "Us"] ?? "us" : "us",
      sentence: make ? make(i.facts) : top.line,
      button: top.button.to === "job" && top.button.section ? { label: top.button.label, section: top.button.section } : null,
      blocked: i.blockers?.length ? i.blockers.join(" · ") : null,
    };
  }
  if (!i.status) return { who: "us", sentence: "This job's status could not be worked out — check its records.", button: null, blocked: null };
  // Installer's own customer at the Ready Check (decision 54): the installer arranges and does it; the office only watches.
  if (i.status.key === "ready_check.installer_own") return { who: "installer", sentence: "Installer is doing the Ready Check · nothing for the office", button: null, blocked: i.blockers?.length ? i.blockers.join(" · ") : null };
  const who = WHO_FROM_STATUS[i.status.waitingOn] ?? "us";
  const tail = i.status.detail ? ` · ${i.status.detail}` : "";
  const sentence = who === "nobody" ? `${i.status.label}${tail}. Nothing for the office to do — it happens automatically.` : who === "us" ? `${i.status.label}${tail}.` : `Waiting for the ${who}: ${i.status.label.charAt(0).toLowerCase()}${i.status.label.slice(1)}${tail}.`;
  return { who, sentence, button: null, blocked: i.blockers?.length ? i.blockers.join(" · ") : null };
}
