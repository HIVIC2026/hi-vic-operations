// ONE rule for "who has the ball" on a job: party, plain sentence, due time, overdue flag and the admin's next click.
// Built on nextStep() so stage/next wording never drifts between screens. Pure (no I/O).
import { nextStep, type NextStepInput } from "./nextstep.core";
import { stageNext } from "./job-wording";

export type Party = "Owner" | "Electrician" | "Installer" | "Home Insulation Victoria";
export type AdminTab = "overview" | "eligibility" | "assessment" | "quotes" | "piesa" | "installation" | "evidence" | "authority" | "veec" | "messages";
export type Proposal = { kind: string; status: string; proposer_role: string | null; created_at: string; starts_at: string; responded_at: string | null };
export type BookingFact = { kind: string; status: string; scheduled_start: string | null; scheduled_end: string | null };
export type DueSettings = { tradeWarnHours: number; tradeExceptionHours: number; ownerReminderDays: number; ownerFlagDays: number };
export const DEFAULT_DUE: DueSettings = { tradeWarnHours: 24, tradeExceptionHours: 48, ownerReminderDays: 3, ownerFlagDays: 7 };

export type WaitingFacts = {
  now: Date;
  stageEnteredAt: string | null;
  electricianName: string | null;
  installerName: string | null;
  proposals: Proposal[];
  bookings: BookingFact[];
  depositRequestRaised: boolean;
  settings?: DueSettings | undefined;
};
export type Waiting = {
  parties: Party[];            // one, or two when they are arranging a date together
  arranging: boolean;
  sentence: string;
  since: string | null;
  dueAt: string | null;
  dueLabel: string | null;
  status: "ok" | "warn" | "overdue";
  overdueBy: string | null;
  action: { label: string; tab: AdminTab };
  terminal: boolean;
};

const H = 3_600_000;
const addH = (iso: string, h: number) => new Date(new Date(iso).getTime() + h * H).toISOString();
/** 11:59pm Melbourne on the same calendar day as iso (AEST/AEDT approximated by fixed +10/+11 not needed: use UTC+10 floor, then add DST hour in summer months). */
export function endOfMelbourneDay(iso: string): string {
  const d = new Date(iso);
  const m = d.getUTCMonth(); // Oct–Mar ≈ AEDT (+11), else AEST (+10)
  const off = m >= 9 || m <= 2 ? 11 : 10;
  const local = new Date(d.getTime() + off * H);
  const end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 23, 59, 0) - off * H;
  return new Date(end).toISOString();
}
export function humanDuration(ms: number): string {
  const h = Math.floor(ms / H);
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))} min`;
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

const TAB: Record<string, AdminTab> = {
  new_enquiry: "eligibility", eligibility_review: "eligibility", on_hold: "overview",
  preliminary_estimate_ready: "assessment", ready_check_awaiting_acceptance: "assessment", ready_check_awaiting_payment: "assessment",
  ready_check_ready_to_schedule: "assessment", ready_check_scheduled: "assessment", ready_check_complete: "assessment", awaiting_electrician: "piesa",
  measured_estimate_ready: "quotes", measured_quote_accepted: "quotes", ready_for_installer_quotes: "quotes", awaiting_quote_acceptance: "quotes", awaiting_deposit_payment: "quotes",
  piesa_and_install_window_pending: "piesa", piesa_scheduled: "piesa", piesa_complete: "piesa", electrical_variation_pending: "piesa",
  assessment_booking: "piesa", assessment_booked: "piesa", assessment_complete: "piesa", rectification_required: "piesa", awaiting_owner_rectification_approval: "piesa",
  rectification_scheduling: "piesa", rectification_booked: "piesa",
  installation_scheduling: "installation", installation_booked: "installation", evidence_outstanding: "evidence", ap_review: "evidence", ready_for_veec: "veec",
};
const ACTION: Record<string, string> = Object.fromEntries(["new_enquiry", "eligibility_review", "ready_check_ready_to_schedule", "ready_check_complete", "measured_quote_accepted", "piesa_and_install_window_pending", "awaiting_electrician", "piesa_complete", "assessment_complete", "rectification_required", "ready_for_installer_quotes", "awaiting_deposit_payment", "ap_review", "ready_for_veec", "on_hold"].map((k) => [k, stageNext(k)]));

type Rule = { party: Party; who?: (f: WaitingFacts) => string; say: (f: WaitingFacts, who: string) => string; bookingKind?: "assessment" | "rectification" | "installation" | "ready_check"; due?: "tradeReply" | "owner" | "endOfBookingDay" | "bookingEnd" };
const elec = (f: WaitingFacts) => f.electricianName ?? "the electrician";
const inst = (f: WaitingFacts) => f.installerName ?? "the installer";
const RULES: Record<string, Rule> = {
  preliminary_estimate_ready: { party: "Owner", say: () => "Waiting on the owner to book the free Ready Check.", due: "owner" },
  ready_check_awaiting_acceptance: { party: "Owner", say: () => "Waiting on the owner to accept the Ready Check.", due: "owner" },
  ready_check_awaiting_payment: { party: "Owner", say: () => "Waiting on the owner to book the free Ready Check.", due: "owner" },
  ready_check_scheduled: { party: "Installer", who: inst, say: (_f, w) => `Waiting on ${w} to do the Ready Check.`, bookingKind: "ready_check", due: "endOfBookingDay" },
  measured_estimate_ready: { party: "Owner", say: () => "Waiting on the owner to accept the quote.", due: "owner" },
  piesa_scheduled: { party: "Electrician", who: elec, say: (_f, w) => `Waiting on ${w} to do the PIESA.`, bookingKind: "assessment", due: "endOfBookingDay" },
  assessment_booking: { party: "Electrician", who: elec, say: (_f, w) => `Waiting on ${w} to propose a PIESA date to the owner.`, due: "tradeReply" },
  assessment_booked: { party: "Electrician", who: elec, say: (_f, w) => `Waiting on ${w} to do the PIESA.`, bookingKind: "assessment", due: "endOfBookingDay" },
  electrical_variation_pending: { party: "Owner", say: () => "Waiting on the owner to approve the electrical fixes.", due: "owner" },
  awaiting_owner_rectification_approval: { party: "Owner", say: () => "Waiting on the owner to approve the electrical fixes quote.", due: "owner" },
  awaiting_quote_acceptance: { party: "Owner", say: () => "Waiting on the owner to accept and sign the quote.", due: "owner" },
  rectification_scheduling: { party: "Electrician", who: elec, say: (_f, w) => `Waiting on ${w} to book the electrical fixes with the owner.`, due: "tradeReply" },
  rectification_booked: { party: "Electrician", who: elec, say: (_f, w) => `Waiting on ${w} to do the electrical fixes.`, bookingKind: "rectification", due: "endOfBookingDay" },
  installation_scheduling: { party: "Installer", who: inst, say: (_f, w) => `Waiting on ${w} to lock in the install date with the owner.`, due: "tradeReply" },
  installation_booked: { party: "Installer", who: inst, say: (_f, w) => `Waiting on ${w} to install and submit the PIISA and photos.`, bookingKind: "installation", due: "endOfBookingDay" },
  evidence_outstanding: { party: "Installer", who: inst, say: (_f, w) => `Waiting on ${w} to upload the missing photos and PIISA.`, due: "tradeReply" },
};

export function waitingOn(job: NextStepInput, f: WaitingFacts): Waiting {
  const ns = nextStep(job);
  const stage = job.stage ?? "new_enquiry";
  const cfg = f.settings ?? DEFAULT_DUE;
  const tab = TAB[stage] ?? "overview";
  const terminal = stage === "complete" || stage === "cancelled";
  const base = { arranging: false, since: f.stageEnteredAt, dueAt: null as string | null, dueLabel: null as string | null, status: "ok" as Waiting["status"], overdueBy: null as string | null, terminal };
  if (terminal) return { ...base, parties: [], sentence: stage === "complete" ? "Job complete – nothing outstanding." : "Job cancelled – nothing outstanding.", action: { label: "Open history", tab: "overview" } };

  // Gate 1 review / ineligible / hold / Home Insulation Victoria-owned stages come straight from nextStep().
  const rule = ns.waitingOn === "Home Insulation Victoria" && !RULES[stage] ? null : job.eligibility_review_required ? null : RULES[stage] ?? null;
  let out: Waiting;
  if (!rule) {
    let sentence = `Home Insulation Victoria to action: ${ns.next}`;
    let parties: Party[] = ["Home Insulation Victoria"];
    let label = ACTION[stage] ?? "Open";
    if (stage === "awaiting_deposit_payment") {
      if (f.depositRequestRaised) { parties = ["Owner"]; sentence = "Waiting on the owner to complete the approved payment option (deposit request sent from Xero)."; label = "Check deposit"; }
      else { sentence = "Home Insulation Victoria to action: raise the deposit request in Xero, then record it here."; label = "Record deposit request"; }
    } else if (ns.waitingOn === "AP") sentence = `Home Insulation Victoria to action: ${ns.next}`;
    out = { ...base, parties, sentence, action: { label, tab: job.eligibility_review_required ? "eligibility" : tab } };
    if (parties[0] === "Home Insulation Victoria" && f.stageEnteredAt) setDue(out, addH(f.stageEnteredAt, cfg.tradeExceptionHours), f.now, addH(f.stageEnteredAt, cfg.tradeWarnHours), "Target");
    if (parties[0] === "Owner" && f.stageEnteredAt) setDue(out, addH(f.stageEnteredAt, cfg.ownerFlagDays * 24), f.now, addH(f.stageEnteredAt, cfg.ownerReminderDays * 24), "Follow up by");
    return out;
  }

  const who = rule.who ? rule.who(f) : "the owner";
  out = { ...base, parties: [rule.party], sentence: rule.say(f, who), action: { label: rule.party === "Home Insulation Victoria" ? ACTION[stage] ?? "Open" : "Draft a nudge", tab: rule.party === "Home Insulation Victoria" ? tab : "messages" } };

  // Date being arranged between owner and trade: show both parties and who owes the reply.
  const proposalKind = stage.startsWith("rectification") ? "rectification" : stage.startsWith("installation") ? "installation" : "assessment";
  const open = f.proposals.filter((p) => p.status === "proposed" && p.kind === proposalKind).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (open && rule.due === "tradeReply") {
    const tradeProposed = open.proposer_role !== "owner";
    out.arranging = true;
    out.parties = [rule.party, "Owner"];
    const when = fmtWhen(open.starts_at);
    out.sentence = tradeProposed ? `Owner and ${who} arranging a date – ${who} proposed ${when}; waiting on the owner to reply.` : `Owner and ${who} arranging a date – owner proposed ${when}; waiting on ${who} to reply.`;
    out.since = open.created_at;
    setDue(out, addH(open.created_at, cfg.tradeExceptionHours), f.now, addH(open.created_at, cfg.tradeWarnHours), "Reply due");
    return out;
  }
  if (rule.due === "endOfBookingDay" && rule.bookingKind) {
    const b = f.bookings.filter((x) => x.kind === rule.bookingKind && x.status === "confirmed" && x.scheduled_start).sort((a, b2) => (b2.scheduled_start ?? "").localeCompare(a.scheduled_start ?? ""))[0];
    if (b?.scheduled_start) {
      out.sentence += ` Booked ${fmtWhen(b.scheduled_start)}.`;
      setDue(out, endOfMelbourneDay(b.scheduled_start), f.now, null, "Results due");
      return out;
    }
  }
  const from = f.stageEnteredAt;
  if (from && rule.due === "tradeReply") setDue(out, addH(from, cfg.tradeExceptionHours), f.now, addH(from, cfg.tradeWarnHours), "Due");
  if (from && rule.due === "owner") setDue(out, addH(from, cfg.ownerFlagDays * 24), f.now, addH(from, cfg.ownerReminderDays * 24), "Follow up by");
  return out;
}

function setDue(w: Waiting, due: string, now: Date, warnAt: string | null, label: string) {
  w.dueAt = due; w.dueLabel = label;
  const late = now.getTime() - new Date(due).getTime();
  if (late > 0) { w.status = "overdue"; w.overdueBy = humanDuration(late); }
  else if (warnAt && now.getTime() >= new Date(warnAt).getTime()) w.status = "warn";
}

export function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" });
}
