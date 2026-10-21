// Needs me: the office safety net. Pure — decides which jobs/items need a person and WHY. Never moves a job.
import { isMappedStage, OFFICE_STATUSES, timeLeft, type OfficeStatus } from "./office-status.core";

export type NeedsRule = "a_waiting_on_us" | "b_over_limit" | "c_inactive" | "d_no_next_step" | "e_failure" | "f_clock" | "g_hold_revisit" | "h_snooze_return" | "i_nothing_lost" | "j_partner" | "k_quiet_owner";
export const RULE_LABEL: Record<NeedsRule, string> = {
  a_waiting_on_us: "Waiting on us", b_over_limit: "Over its time limit", c_inactive: "No activity", d_no_next_step: "No next step",
  e_failure: "Something failed", f_clock: "30-day install clock nearly up", g_hold_revisit: "On hold past revisit date",
  h_snooze_return: "Back from Later", i_nothing_lost: "Not in exactly one status", j_partner: "Partner item", k_quiet_owner: "Quiet owner",
};
/** Draft for Jo to approve. Nothing sends while customer messages are switched off. */
export const QUIET_OWNER_FINAL_NOTICE_DRAFT = "[Draft for Jo to approve] We haven't heard back about your free insulation check, so we'll close your spot in 7 days. Reply or tap the link any time before then to keep it.";

export type NeedsJob = {
  id: string; jobNumber: string; suburb: string | null; owner: string | null; stage: string;
  status: OfficeStatus | null; statusCount: number; lastActivityAt: string | null; nextAction: string | null;
  installDeadline: string | null; installStarted: boolean; holdRevisitAt: string | null;
  failures: string[];
  /** Waiting-list lead never contacted: never in Needs me (Pipeline shows a count). */
  parked?: boolean;
  /** Office-picked trade declined or ran out (latest offer of that kind). */
  tradeChoice?: { kind: "ready_check" | "piesa" | "rectification"; name: string | null; status: "declined" | "expired" } | null;
  /** Office picks first: nothing sent yet ("choose"), or offered but nobody took it within the set hours ("no_taker"). */
  offerChoice?: { kind: "ready_check" | "piesa"; state: "choose" | "no_taker"; hours: number } | null;
  /** Homeowner asked for a different installer/electrician (open reassignment request, one per job). */
  reassignment?: { role: "installer" | "electrician"; reason: string; since: string | null } | null;
};
export type PartnerItem = { key: string; title: string; why: string; dueAt: string | null; href: string };

/** Office rows that only the retired "To action" list used to show (moved across 7 Oct): unconnected Mitti forms and staff waiting for approval.
 *  TEST businesses (name starts "TEST" or "[TEST PARTNER]") are left out, like every other Needs me row. */
export const MITTI_FORMS: [string, string][] = [
  ["A1 Ready Check (installer's own customer)", "mitti_ready_check_priced_template_id"], ["A2 Ready Check (our lead)", "mitti_ready_check_template_id"],
  ["B Pre Insulation Electrical Safety Assessment (PIESA)", "mitti_piesa_template_id"], ["C PIISA installer Pre Insulation Electrical Safety Assessment (PIESA)", "mitti_piisa_template_id"],
];
const isTestBiz = (n: string | null | undefined) => /^\s*(\[TEST PARTNER\]|TEST\b)/i.test(n ?? "");
export function movedFromTodo(f: { formIds: Record<string, string | null | undefined> | null; pendingWorkers: { id: string; full_legal_name: string | null; business: string | null }[] }): PartnerItem[] {
  const out: PartnerItem[] = [];
  for (const [name, col] of MITTI_FORMS) if (f.formIds && !f.formIds[col]) out.push({ key: `mitti-form:${col}`, title: `Onsite form not set up: ${name}`, why: "Connect the Mitti form in Compliance → Mitti forms. Trades see “Form being set up” until then.", dueAt: null, href: "/admin/compliance" });
  for (const w of f.pendingWorkers) if (!isTestBiz(w.business)) out.push({ key: `worker:${w.id}`, title: `Approve worker – ${w.full_legal_name?.trim() || "name not given"}`, why: `${w.business ?? "A partner"} added them; they can't be sent jobs until approved.`, dueAt: null, href: "/admin/workers" });
  return out;
}
export type Snooze = { jobId: string; ruleKey: string; until: string; count: number };
export type NeedsItem = {
  key: string; jobId: string | null; jobNumber: string | null; suburb: string | null; what: string; why: string; rule: NeedsRule;
  dueAt: string | null; timeLeft: string | null; urgency: number; action: string; href: string | null; snoozeCount: number;
  /** Set when the office's chosen trade didn't take the offer: show "Pick another" + "Send to all". */
  choiceKind?: "ready_check" | "piesa" | "rectification";
  /** Grouped row: how many enquiries it stands for (waiting-list enquiries are summarised, not listed one by one). */
  count?: number;
};

const DAY = 86_400_000;

/** One row per job (its most urgent reason), plus partner rows. Snoozed rows are hidden until the next morning. */
export function buildNeedsMe(i: { now: number; jobs: NeedsJob[]; partners: PartnerItem[]; snoozes: Snooze[]; lim: Record<string, number> }): { items: NeedsItem[]; onTrack: number } {
  const { now, lim } = i;
  const snooze = new Map(i.snoozes.map((s) => [`${s.jobId}:${s.ruleKey}`, s]));
  const items: NeedsItem[] = [];
  let onTrack = 0;
  const waiting = new Map<string, number>();
  for (const j of i.jobs) {
    if (j.parked) { const k = j.status?.key ?? "waiting_list.needs_estimate"; waiting.set(k, (waiting.get(k) ?? 0) + 1); continue; }
    const s = j.status;
    const reasons: { rule: NeedsRule; why: string; urgency: number; action?: string }[] = [];
    if (!isMappedStage(j.stage) || !s || j.statusCount !== 1) reasons.push({ rule: "i_nothing_lost", why: !s ? `Stage "${j.stage}" has no status rule` : `Matched ${j.statusCount} statuses`, urgency: 100, action: "Fix status" });
    for (const f of j.failures) reasons.push({ rule: "e_failure", why: f, urgency: 95, action: "Fix it" });
    if (j.tradeChoice) reasons.push({ rule: "a_waiting_on_us", why: `${j.tradeChoice.name ?? "The trade you chose"} ${j.tradeChoice.status === "declined" ? "said no" : "didn't answer in time"}`, urgency: 88, action: "Pick another" });
    if (j.reassignment) reasons.push({ rule: "a_waiting_on_us", why: `Owner asked for a different ${j.reassignment.role} — review and reassign`, urgency: 87, action: "Review request" });
    const oc = j.offerChoice;
    const ocWhat = oc?.kind === "piesa" ? "PIESA" : "Ready Check";
    if (oc?.state === "choose") reasons.push({ rule: "a_waiting_on_us", why: `Choose trades for this job — the ${ocWhat} offer hasn't gone out (Office picks first)`, urgency: 89, action: "Choose trades" });
    if (oc?.state === "no_taker") reasons.push({ rule: "a_waiting_on_us", why: `${oc.hours}h and no one has taken the ${ocWhat} — add more trades (those already offered keep theirs)`, urgency: 89, action: "Add more trades" });
    const ended = s?.stage === "ended";
    if (s && !ended) {
      if (s.late) reasons.push({ rule: "b_over_limit", why: `Due ${s.dueAt!.slice(0, 10)} — ${timeLeft(s.dueAt, now)}`, urgency: 80 });
      if (s.waitingOn === "Us") reasons.push({ rule: "a_waiting_on_us", why: s.detail ? `${s.label}: ${s.detail}` : s.label, urgency: 60 });
      const openEnded = ["ready_check.booked", "safety.booked", "install.booked", "safety.fixes_booked", "signoff.payouts_due", "install.agree"].includes(s.key);
      if (!s.dueAt && !openEnded) reasons.push({ rule: "d_no_next_step", why: "No due date for this step", urgency: 70, action: "Set next step" });
      const quietDays = j.lastActivityAt ? (now - new Date(j.lastActivityAt).getTime()) / DAY : Infinity;
      if (quietDays >= (lim["inactivity_days"] ?? 5)) reasons.push({ rule: "c_inactive", why: `No activity for ${Number.isFinite(quietDays) ? Math.floor(quietDays) : "many"} days`, urgency: 50, action: "Check in" });
      if (j.installDeadline && !j.installStarted) {
        const left = (new Date(j.installDeadline).getTime() - now) / DAY;
        if (left <= (lim["clock_warning_days"] ?? 5)) reasons.push({ rule: "f_clock", why: left < 0 ? "30-day install clock has run out" : `30-day install clock ends in ${Math.max(0, Math.ceil(left))} days`, urgency: 90, action: "Get it booked" });
      }
      const ownerWait = s.waitingOn === "Owner" && s.late && s.dueAt && (now - new Date(s.dueAt).getTime()) / DAY >= (lim["quiet_owner_close_days"] ?? 14);
      if (ownerWait) reasons.push({ rule: "k_quiet_owner", why: "Owner hasn't replied after reminders and a final notice — close and free the spot?", urgency: 85, action: "Close or keep" });
    }
    if (s?.key === "ended.on_hold") {
      if (!j.holdRevisitAt) reasons.push({ rule: "d_no_next_step", why: "On hold with no revisit date", urgency: 70, action: "Set revisit date" });
      else if (new Date(j.holdRevisitAt).getTime() <= now) reasons.push({ rule: "g_hold_revisit", why: `Revisit date ${j.holdRevisitAt} has passed`, urgency: 65, action: "Revisit" });
    }
    if (!reasons.length) { if (!ended) onTrack++; continue; }
    reasons.sort((a, b) => b.urgency - a.urgency);
    const top = reasons[0]!;
    const sn = snooze.get(`${j.id}:${top.rule}`);
    if (sn && new Date(sn.until).getTime() > now) continue;
    const returning = !!sn;
    const statusAction = s ? (OFFICE_STATUSES[s.key] as { action?: string }).action : undefined;
    items.push({
      key: `${j.id}:${top.rule}`, jobId: j.id, jobNumber: j.jobNumber, suburb: j.suburb,
      what: s && top.rule !== "i_nothing_lost" ? s.label : "Check this job's status",
      why: [returning ? "Back from Later" : null, top.why, ...reasons.slice(1).map((r) => RULE_LABEL[r.rule])].filter(Boolean).join(" · "),
      rule: returning ? "h_snooze_return" : top.rule, dueAt: s?.dueAt ?? null, timeLeft: timeLeft(s?.dueAt ?? null, now),
      urgency: top.urgency + (returning ? 5 : 0), action: top.action ?? statusAction ?? "Open job", href: null, snoozeCount: sn?.count ?? 0,
      ...(j.tradeChoice ? { choiceKind: j.tradeChoice.kind } : j.offerChoice ? { choiceKind: j.offerChoice.kind } : {}),
    });
  }
  for (const p of i.partners) {
    const sn = snooze.get(`partner:${p.key}`);
    if (sn && new Date(sn.until).getTime() > now) continue;
    items.push({ key: `partner:${p.key}`, jobId: null, jobNumber: null, suburb: null, what: p.title, why: (sn ? "Back from Later · " : "") + p.why, rule: "j_partner", dueAt: p.dueAt, timeLeft: timeLeft(p.dueAt, now), urgency: 40, action: "Review", href: p.href, snoozeCount: sn?.count ?? 0 });
  }
  const ready = waiting.get("waiting_list.ready_to_send") ?? 0, noEst = waiting.get("waiting_list.needs_estimate") ?? 0;
  if (ready) items.push({ key: "waiting:ready_to_send", jobId: null, jobNumber: null, suburb: null, what: `${ready} enquir${ready === 1 ? "y" : "ies"} not contacted yet — estimate ready to send`, why: "Each one needs the Save my spot email from you before anything else can happen.", rule: "a_waiting_on_us", dueAt: null, timeLeft: null, urgency: 58, action: "Open enquiry email groups", href: "/admin/enquiry-groups", snoozeCount: 0, count: ready });
  if (noEst) items.push({ key: "waiting:needs_estimate", jobId: null, jobNumber: null, suburb: null, what: `${noEst} enquir${noEst === 1 ? "y" : "ies"} not contacted yet — no estimate yet`, why: "Each one needs an estimate checked and sent by you.", rule: "a_waiting_on_us", dueAt: null, timeLeft: null, urgency: 57, action: "Open Enquiries", href: "/admin/hot-leads", snoozeCount: 0, count: noEst });
  items.sort((a, b) => b.urgency - a.urgency || (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"));
  return { items, onTrack };
}

/** Badge number: every enquiry or item that needs the office (grouped rows count each enquiry they stand for). */
export function needsMeTotal(items: Pick<NeedsItem, "count">[]) {
  return items.reduce((n, it) => n + (it.count ?? 1), 0);
}

/** "Later" = tomorrow 7am Melbourne (approximated as 7am AEST/AEDT via UTC offset of the next day). */
export function nextMorning(now: number): string {
  const d = new Date(now);
  const mel = new Date(d.toLocaleString("en-US", { timeZone: "Australia/Melbourne" }));
  const offset = mel.getTime() - d.getTime();
  const target = new Date(mel); target.setDate(target.getDate() + 1); target.setHours(7, 0, 0, 0);
  return new Date(target.getTime() - offset).toISOString();
}
