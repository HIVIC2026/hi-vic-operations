// Automatic retry rules for failed Mitti form creation (pure: no I/O). The sweep (server) feeds it
// workflow_events rows and acts on the answers; the alert email wording lives here too.
import type { MittiFormKind } from "./mitti-create-claim.core";
import { UNCERTAIN_EVENT } from "./mitti-create-claim.core";
import { PIESA_AUTOFORM_FAILED_EVENT } from "./piesa-autoform.core";
import { PIISA_AUTOSEND_FAILED_EVENT, PIISA_AUDIT_CREATED_EVENT } from "./piisa-autosend.core";
import { FIXES_DAY_Q, FIXES_FORM_CREATED_EVENT, FIXES_FORM_HELD_EVENT } from "./fixes-day.core";
import { INSTALL_DAY_Q } from "./install-day.core";
import { flatten, norm as labelNorm } from "./mitti.core";

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

/** Which kinds a "this is fine now" event resolves (empty if it is not a resolver). */
function resolvesKinds(e: WorkflowEventRow): MittiFormKind[] {
  const own = asKind(e.details?.["kind"]);
  switch (e.event_type) {
    case RETRY_LINKED_EVENT:
    case ALERT_SENT_EVENT:
      return own ? [own] : [];
    case "mitti_audit_created":
    case "mitti_audit_reshared":
    case "mitti_access_override":
      // Newer events say which form they were for; older ones did not, so they clear both Ready Check and PIESA.
      return own ? [own] : ["ready_check", "piesa"];
    case "mitti_audit_linked": // the link function only handles Ready Check forms
      return ["ready_check"];
    case PIISA_AUDIT_CREATED_EVENT:
      return ["install_day"];
    case FIXES_FORM_CREATED_EVENT:
      return ["fixes"];
    default:
      return [];
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
    for (const rk of resolvesKinds(e)) lastResolved.set(key(e.job_id, rk), ms(e.created_at));
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

/** The fields matchAudits reads (read from a Mitti audit by auditIdentity). */
export type AuditToMatch = {
  templateId: string;
  mittiOwnerUserId: string | null;
  jobNumber?: string | null;
  siteAddress: string | null;
  homeownerName: string | null;
  /** Two fields with the same label disagree: the form cannot be read safely. */
  ambiguous?: boolean;
};

/** Each form type's own job-number / address / owner-name questions (exact wording). The Ready Check reads header items
 *  only, exactly as the pickup / link step does (parsePickupAudit); the other forms carry them in the body too. */
const IDENTITY_LABELS: Record<MittiFormKind, { job: string[]; address: string[]; name: string[]; headerOnly?: boolean; addressPrefix?: boolean }> = {
  // Jo 23 Oct: the Ready Check address question may carry an instruction suffix ("Site address (please edit…)").
  ready_check: { job: ["Portal Job Number", "Job Reference ID"], address: ["Site address"], name: ["Homeowner name", "Owner name"], headerOnly: true, addressPrefix: true },
  piesa: { job: ["Job Reference ID", "Portal Job Number"], address: ["Address including postcode", "Site address"], name: [] },
  fixes: { job: [FIXES_DAY_Q.jobNumber], address: [FIXES_DAY_Q.address], name: [] },
  // A5 Install day, or the older official PIISA forms that the same creator still handles.
  install_day: { job: [INSTALL_DAY_Q.jobNumber, "Job Reference ID"], address: [INSTALL_DAY_Q.address, "Address including postcode"], name: [] },
};

/** Read one Mitti audit's identity using ITS form type's labels (C1). Null when it has no audit id. Two answers to the
 *  same question that disagree make it ambiguous (never matched). */
export function auditIdentity(kind: MittiFormKind, audit: unknown): (Omit<AuditToMatch, "templateId"> & { auditId: string }) | null {
  const a = audit as { audit_id?: unknown; audit_data?: { authorship?: { owner_id?: unknown } } } | null;
  const auditId = String(a?.audit_id ?? "").trim();
  if (!auditId) return null;
  const L = IDENTITY_LABELS[kind];
  const entries = flatten(audit).filter((e) => !L.headerOnly || e.header);
  let ambiguous = false;
  const read = (labels: string[], prefix = false): string | null => {
    const want = labels.map(labelNorm);
    const hits = entries.filter((e) => want.includes(e.norm) || (prefix && want.some((w) => e.norm.startsWith(w + " "))));
    const values = [...new Set(hits.map((e) => (e.value ?? "").trim()).filter(Boolean))];
    if (new Set(values.map((v) => norm(v))).size > 1) ambiguous = true;
    return values[0] ?? null;
  };
  const out = {
    auditId,
    mittiOwnerUserId: String(a?.audit_data?.authorship?.owner_id ?? "").trim() || null,
    jobNumber: read(L.job),
    siteAddress: read(L.address, L.addressPrefix),
    homeownerName: L.name.length ? read(L.name) : null,
  };
  return { ...out, ...(ambiguous ? { ambiguous: true } : {}) };
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim().replace(/[\s.,;:!]+$/, "");

export type MatchVerdict = "one" | "none" | "many" | "unclear" | "elsewhere";

/**
 * Is exactly one form in Mitti this job's form, sitting with the trade (or still with the portal's own Mitti API account
 * after a lost reply, I1)? Never guesses:
 *  - "unclear": a candidate's job number and address can't be read (or are contradictory) — can't tell, never create (C1).
 *  - "elsewhere": a form for this job sits with someone else (or with the API account while that account is unknown).
 *  - "many": more than one form for this job.
 */
export function matchAudits(
  audits: AuditToMatch[],
  want: { templateId: string; mittiOwnerUserId: string; apiOwnerUserId?: string | null; jobNumber: string; siteAddress: string; homeownerName: string },
): MatchVerdict {
  let matches = 0, unclear = false, elsewhere = false;
  for (const a of audits) {
    if (a.templateId !== want.templateId) continue;
    const ownerOk = !!a.mittiOwnerUserId && (a.mittiOwnerUserId === want.mittiOwnerUserId || (!!want.apiOwnerUserId && a.mittiOwnerUserId === want.apiOwnerUserId));
    let job: "ours" | "other" | "unclear";
    if (a.ambiguous) job = "unclear";
    else if (norm(a.jobNumber)) job = norm(a.jobNumber) === norm(want.jobNumber) ? "ours" : "other";
    else {
      const addr = norm(a.siteAddress), name = norm(a.homeownerName);
      if (!addr) job = "unclear";
      else if (addr !== norm(want.siteAddress)) job = "other";
      else if (!name) job = "unclear";
      else job = name === norm(want.homeownerName) ? "ours" : "other";
    }
    // An unreadable form can only be ours when it is with the trade, with the API account, or the API account is unknown.
    if (job === "unclear") { if (ownerOk || !want.apiOwnerUserId || !a.mittiOwnerUserId) unclear = true; }
    else if (job === "ours") { if (ownerOk) matches++; else elsewhere = true; }
  }
  if (matches > 1) return "many";
  if (unclear) return "unclear";
  if (elsewhere) return "elsewhere";
  return matches === 1 ? "one" : "none";
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
