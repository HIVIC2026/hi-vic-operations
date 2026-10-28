// Automatic retry rules for failed Mitti form creation (pure: no I/O). The sweep (server) feeds it
// workflow_events rows and acts on the answers; the alert email wording lives here too.
import type { MittiFormKind } from "./mitti-create-claim.core";
import { UNCERTAIN_EVENT } from "./mitti-create-claim.core";
import { PIESA_AUTOFORM_FAILED_EVENT } from "./piesa-autoform.core";
import { PIISA_AUTOSEND_FAILED_EVENT, PIISA_AUDIT_CREATED_EVENT } from "./piisa-autosend.core";
import { FIXES_FORM_CREATED_EVENT, FIXES_FORM_HELD_EVENT } from "./fixes-day.core";

/** Failures before this moment are never retried or alerted. */
export const MITTI_RETRY_FROM = "2026-10-29T00:00:00.000Z"; // set to the deploy time in Task 5
export const RETRY_DELAY_MS = 120_000;
export const MAX_RETRIES = 2;

export const RETRY_STARTED_EVENT = "mitti_create_retry_started";
export const RETRY_LINKED_EVENT = "mitti_create_retry_linked";
export const ALERT_SENT_EVENT = "mitti_create_alert_sent";

export type WorkflowEventRow = { job_id: string; event_type: string; created_at: string; summary?: string | null; details?: Record<string, unknown> | null };

export type FailureCase = {
  jobId: string;
  kind: MittiFormKind;
  /** The uncertain claim to release before retrying; null when nothing was created (no claim held). */
  claimId: string | null;
  failedAt: string;
  reason: "uncertain" | "not_created";
  detail: string;
};

const KINDS: readonly string[] = ["ready_check", "piesa", "fixes", "install_day"];
const asKind = (v: unknown): MittiFormKind | null => (typeof v === "string" && KINDS.includes(v) ? (v as MittiFormKind) : null);
const ms = (iso: string) => Date.parse(iso);
const str = (v: unknown) => (typeof v === "string" ? v : "");

type Failure = { kind: MittiFormKind; claimId: string | null; reason: FailureCase["reason"]; detail: string };

/** What failure (if any) an event records. The sweep's own events (released, retry_*, alert_sent) are never failures. */
function failureOf(e: WorkflowEventRow): Failure | null {
  const d = e.details ?? {};
  switch (e.event_type) {
    case UNCERTAIN_EVENT: {
      const kind = asKind(d["kind"]);
      return kind ? { kind, claimId: str(d["claim_id"]) || null, reason: "uncertain", detail: str(d["detail"]) || (e.summary ?? "") } : null;
    }
    case "mitti_access_needed":
      return /could not be created/i.test(e.summary ?? "") ? { kind: "ready_check", claimId: null, reason: "not_created", detail: e.summary ?? "" } : null;
    case PIESA_AUTOFORM_FAILED_EVENT:
      return { kind: "piesa", claimId: null, reason: "not_created", detail: str(d["reason"]) || (e.summary ?? "") };
    case FIXES_FORM_HELD_EVENT:
      // The fixes creator holds with key "booking:<id>:not_created" when nothing was created.
      return /:not_created$/.test(str(d["key"])) ? { kind: "fixes", claimId: null, reason: "not_created", detail: str(d["reason"]) || (e.summary ?? "") } : null;
    case PIISA_AUTOSEND_FAILED_EVENT:
      // The autosend only logs this for real failures; held / uncertain claims are skipped there.
      return { kind: "install_day", claimId: null, reason: "not_created", detail: str(d["message"]) || (e.summary ?? "") };
    default:
      return null;
  }
}

/** Which kind a "this is fine now" event resolves, or null if it is not a resolver. */
function resolvesKind(e: WorkflowEventRow): MittiFormKind | null {
  switch (e.event_type) {
    case RETRY_LINKED_EVENT:
    case ALERT_SENT_EVENT:
      return asKind(e.details?.["kind"]);
    case "mitti_audit_created":
    case "mitti_audit_linked":
    case "mitti_access_override":
      return "ready_check";
    case PIISA_AUDIT_CREATED_EVENT:
      return "install_day";
    case FIXES_FORM_CREATED_EVENT:
      return "fixes";
    default:
      return null;
  }
}

type Run = { failures: { at: string; f: Failure }[]; latest: { at: string; f: Failure } };

/** Per job+kind: the unresolved failures after the last resolver, or null if there are none. */
function unresolvedRuns(events: WorkflowEventRow[], now?: Date): Map<string, Run & { jobId: string; kind: MittiFormKind }> {
  const from = ms(MITTI_RETRY_FROM);
  const limit = now ? now.getTime() : Infinity;
  const rows = events.filter((e) => ms(e.created_at) >= from && ms(e.created_at) <= limit).sort((a, b) => ms(a.created_at) - ms(b.created_at));
  const lastResolved = new Map<string, number>();
  const failures = new Map<string, { jobId: string; kind: MittiFormKind; list: { at: string; f: Failure }[] }>();
  const key = (job: string, kind: string) => `${job}\u0000${kind}`;
  for (const e of rows) {
    const rk = resolvesKind(e);
    if (rk) lastResolved.set(key(e.job_id, rk), ms(e.created_at));
    const f = failureOf(e);
    if (f) {
      const k = key(e.job_id, f.kind);
      const entry = failures.get(k) ?? { jobId: e.job_id, kind: f.kind, list: [] };
      entry.list.push({ at: e.created_at, f });
      failures.set(k, entry);
    }
  }
  const out = new Map<string, Run & { jobId: string; kind: MittiFormKind }>();
  for (const [k, v] of failures) {
    const resolvedAt = lastResolved.get(k) ?? -Infinity;
    const live = v.list.filter((x) => ms(x.at) > resolvedAt);
    if (live.length) out.set(k, { jobId: v.jobId, kind: v.kind, failures: live, latest: live[live.length - 1]! });
  }
  return out;
}

/** One case per job+kind: the latest failure since MITTI_RETRY_FROM that nothing has resolved. */
export function collectFailureCases(events: WorkflowEventRow[], now: Date): FailureCase[] {
  return [...unresolvedRuns(events, now).values()].map((r) => ({
    jobId: r.jobId, kind: r.kind, claimId: r.latest.f.claimId, failedAt: r.latest.at, reason: r.latest.f.reason, detail: r.latest.f.detail,
  }));
}

/** The retries already made for this case's current run (from its first unresolved failure on). */
export function retriesFor(events: WorkflowEventRow[], c: FailureCase): { at: string }[] {
  const run = unresolvedRuns(events).get(`${c.jobId}\u0000${c.kind}`);
  const first = run ? ms(run.failures[0]!.at) : ms(c.failedAt);
  return events
    .filter((e) => e.job_id === c.jobId && e.event_type === RETRY_STARTED_EVENT && e.details?.["kind"] === c.kind && ms(e.created_at) >= first)
    .map((e) => ({ at: e.created_at }))
    .sort((a, b) => ms(a.at) - ms(b.at));
}

export function nextAction(c: FailureCase, retriesSoFar: { at: string }[], now: Date): "wait" | "search_then_retry" | "alert" {
  if (c.reason === "not_created" || retriesSoFar.length >= MAX_RETRIES) return "alert";
  const last = retriesSoFar.length ? Math.max(...retriesSoFar.map((r) => ms(r.at))) : 0;
  return now.getTime() >= Math.max(ms(c.failedAt), last) + RETRY_DELAY_MS ? "search_then_retry" : "wait";
}

// ---- matching Mitti forms to a job ----

/** The fields matchAudits reads. A parsed pickup audit fits this shape (jobNumber = its Portal Job Number). */
export type AuditToMatch = {
  templateId: string;
  mittiOwnerUserId: string | null;
  jobNumber?: string | null;
  siteAddress: string | null;
  homeownerName: string | null;
};

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim().replace(/[\s.,;:!]+$/, "");

export function matchAudits(
  audits: AuditToMatch[],
  want: { templateId: string; mittiOwnerUserId: string; jobNumber: string; siteAddress: string; homeownerName: string },
): "one" | "none" | "many" {
  const matches = audits.filter((a) => {
    if (a.templateId !== want.templateId || a.mittiOwnerUserId !== want.mittiOwnerUserId) return false;
    if (norm(a.jobNumber)) return norm(a.jobNumber) === norm(want.jobNumber);
    const addr = norm(a.siteAddress), name = norm(a.homeownerName);
    return !!addr && !!name && addr === norm(want.siteAddress) && name === norm(want.homeownerName);
  });
  return matches.length === 0 ? "none" : matches.length === 1 ? "one" : "many";
}

// ---- the office alert ----

export type AlertInput = {
  jobNumber: string; address: string; kind: MittiFormKind;
  tradeName: string | null; tradeEmail: string | null; bookingAt: string | null;
  error: string; jobUrl: string;
};

const KIND_LABEL: Record<MittiFormKind, string> = { ready_check: "Ready Check", piesa: "PIESA", fixes: "Electrical fixes", install_day: "Install day" };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const melbourne = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: false }).format(d);
};

export function alertEmail(i: AlertInput): { subject: string; text: string; html: string } {
  const label = KIND_LABEL[i.kind];
  const trade = [i.tradeName, i.tradeEmail].filter(Boolean).join(" - ");
  const lines: [string, string][] = [
    ["Job", i.jobNumber], ["Address", i.address], ["Form", label],
    ...(trade ? [["Trade", trade] as [string, string]] : []),
    ...(i.bookingAt ? [["Booked", melbourne(i.bookingAt)] as [string, string]] : []),
    ["What went wrong", i.error],
  ];
  const intro = "The Mitti form was not made, even after retrying. Please check Mitti and make it by hand.";
  return {
    subject: `Mitti form not made: ${i.jobNumber} (${label})`,
    text: [intro, "", ...lines.map(([k, v]) => `${k}: ${v}`), "", `Open the job: ${i.jobUrl}`].join("\n"),
    html: `<p>${esc(intro)}</p><p>${lines.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join("<br>")}</p><p><a href="${esc(i.jobUrl)}">Open the job</a></p>`,
  };
}
