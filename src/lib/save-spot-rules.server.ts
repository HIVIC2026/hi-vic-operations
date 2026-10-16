// P1-R3-S103: server side of the Office-configurable automatic Save-my-spot sending rules.
//
// FAIL CLOSED EVERYWHERE. A missing, empty, unreadable or invalid configuration, or a configuration
// whose automatic selection is off, means NOTHING is automatically sent. This module never sends,
// never reserves an idempotency key, never writes a delivery record and never changes a status: it
// only reads and decides. The single caller that sends is `maybeAutoRouteLeadEmail`, and only after
// this gate returns allowed.
//
// The same gate function is used by the Office preview, so what an Office user sees is exactly what
// the automatic router would apply. The preview and the gate share every read and every decision; the
// only difference is that the preview stops before the sender.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { declaredExtras } from "./enquiry.core";
import { normaliseInsulation } from "./eligibility.core";
import { automaticLeadEmail } from "./enquiry-groups.core";
import { LAUNCH_CAMPAIGN } from "./launch-campaign.core";
import { SERVICE_AREA_REASON } from "./service-coverage.server";
import {
  AUTOMATIC_RULES_VERSION,
  CATEGORY_MISMATCH_REASON,
  CATEGORY_UNKNOWN_REASON,
  ELIGIBILITY_LABEL,
  FILTER_CATEGORIES,
  INSULATION_LABEL,
  describeRules,
  defaultFilters,
  jobStatusLabel,
  lifecycleExclusion,
  matchAutomaticRules,
  unknownCategories,
  validateConfig,
  validateFilters,
  type AutomaticRuleFilters,
  type AutomaticRulesConfig,
  type AutomaticSaveSpotFacts,
  type EligibilityOutcomeValue,
  type FilterCategory,
} from "./save-spot-rules.core";

/** How many recent decided enquiries the Office preview scans. A bound, not an exhaustive history. */
export const PREVIEW_SCAN_LIMIT = 500;
export const PREVIEW_PAGE_SIZE = 25;

export const AUTOMATIC_SELECTION_OFF_REASON = "Automatic Save my spot selection is off.";
export const RULES_UNAVAILABLE_REASON = "Automatic sending rules are unavailable, so nothing is automatically sent.";
export const BACKLOG_REASON = "This enquiry was created before the current rules were switched on, so it is not sent automatically.";

export type AutomaticRulesRead =
  | { state: "ok"; config: AutomaticRulesConfig }
  | { state: "missing" | "invalid" | "unreadable"; reason: string };

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * Read the stored configuration. `workflow_settings.save_my_spot_auto_rules` is the ONE proposed
 * column (see docs/pending-migrations/0206_save_my_spot_auto_rules.sql — proposed, NOT applied).
 * Until that column exists the select errors and every caller fails closed.
 */
export async function readAutomaticRules(): Promise<AutomaticRulesRead> {
  const { data, error } = await admin.from("workflow_settings").select("save_my_spot_auto_rules").eq("id", 1).maybeSingle();
  if (error || !data) return { state: "unreadable", reason: "Automatic sending rules could not be read from settings." };
  const blob = (data as { save_my_spot_auto_rules?: unknown }).save_my_spot_auto_rules;
  if (blob == null || (typeof blob === "object" && Object.keys(blob as Record<string, unknown>).length === 0)) {
    return { state: "missing", reason: "No automatic sending rules have been saved yet." };
  }
  const record = asRecord(blob);
  const checked = validateConfig(blob);
  if (!record || !checked.ok) return { state: "invalid", reason: checked.ok ? "The stored rule configuration is not a readable object." : checked.errors.join(" ") };
  return {
    state: "ok",
    config: {
      version: AUTOMATIC_RULES_VERSION,
      enabled: checked.enabled,
      rules: checked.value,
      updatedAt: typeof record["updatedAt"] === "string" ? record["updatedAt"] : null,
      updatedBy: typeof record["updatedBy"] === "string" ? record["updatedBy"] : null,
      activatedAt: checked.activatedAt,
    },
  };
}

/** Validate untrusted Office input and build the persisted document. Throws a readable error instead of saving junk. */
export function prepareRulesForSave(input: { rules: unknown; enabled: boolean; previousEnabled: boolean; previousActivatedAt: string | null; actorId: string | null }): AutomaticRulesConfig {
  const filters = validateFilters(input.rules);
  if (!filters.ok) throw new Error(filters.errors.join(" "));
  const at = new Date().toISOString();
  return {
    version: AUTOMATIC_RULES_VERSION,
    enabled: input.enabled,
    rules: filters.value,
    updatedAt: at,
    updatedBy: input.actorId,
    // Turning automatic selection ON stamps a NEW activation so earlier enquiries are never swept up.
    // A disabled configuration keeps its last activation as history but can never use it.
    activatedAt: input.enabled ? (input.previousEnabled ? input.previousActivatedAt : at) : input.previousActivatedAt,
  };
}

export type AutomaticCandidateFacts = AutomaticSaveSpotFacts & { jobNumber: string | null };

const candidateSelect = "id, job_number, stage, created_at, source, channel, eligibility_outcome, eligibility_decision_source, eligibility_review_required, estimated_area_m2, estimated_area_unknown, properties(postcode, enrichment)";

type CandidateRow = {
  id: string; job_number: string | null; stage: string | null; created_at: string | null; source: string | null; channel: string | null;
  eligibility_outcome: string | null; eligibility_decision_source: string | null; eligibility_review_required: boolean | null;
  estimated_area_m2: number | null; estimated_area_unknown: boolean | null;
  properties: { postcode: string | null; enrichment: Record<string, unknown> | null } | { postcode: string | null; enrichment: Record<string, unknown> | null }[] | null;
};

const propertyOf = (v: unknown): { postcode: string | null; enrichment: Record<string, unknown> | null } | null => {
  const one = (Array.isArray(v) ? v[0] : v) as { postcode: string | null; enrichment: Record<string, unknown> | null } | null | undefined;
  return one ?? null;
};

/** Only recorded facts are read. Nothing is inferred, defaulted or invented to make a rule pass. */
export function candidateFacts(row: CandidateRow): AutomaticCandidateFacts {
  const property = propertyOf(row.properties);
  const base44 = (property?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } };
  const unknownFlag = row.estimated_area_unknown === true;
  const recordedArea = unknownFlag ? null : Number(row.estimated_area_m2);
  return {
    jobNumber: row.job_number ?? null,
    eligibilityOutcome: row.eligibility_outcome ?? null,
    insulation: normaliseInsulation(declaredExtras(base44.raw?.answers ?? null).existing_insulation),
    areaM2: recordedArea != null && Number.isFinite(recordedArea) && recordedArea > 0 ? recordedArea : null,
    // Unknown whenever the owner supplied no area (the intake invariant's own flag) or none is usable.
    areaUnknown: unknownFlag || !(Number(row.estimated_area_m2) > 0),
    postcode: property?.postcode ?? null,
    stage: row.stage ?? null,
    createdAt: row.created_at ?? null,
  };
}

/** Read one job's candidate facts for the live gate. Returns null when the job cannot be read. */
export async function loadAutomaticCandidate(jobId: string): Promise<AutomaticCandidateFacts | null> {
  const { data, error } = await admin.from("jobs").select(candidateSelect).eq("id", jobId).maybeSingle();
  if (error || !data) return null;
  return candidateFacts(data as unknown as CandidateRow);
}

export type AutomaticGateBlock =
  | "rules_unavailable" | "selection_disabled" | "job_unreadable" | "lifecycle" | "historical"
  | "not_offer_spot" | "service_area" | "rule_mismatch";

export type AutomaticGateVerdict = { allowed: boolean; block: AutomaticGateBlock | null; reason: string; failedCategories: FilterCategory[] };

const ALLOWED: AutomaticGateVerdict = { allowed: true, block: null, reason: "Automatic sending rules allow this enquiry.", failedCategories: [] };
const blocked = (block: AutomaticGateBlock, reason: string, failedCategories: FilterCategory[] = []): AutomaticGateVerdict => ({ allowed: false, block, reason, failedCategories });

/**
 * THE selection gate used by the live automatic router and by the Office preview.
 *
 * Order matters and is fixed:
 *  1. configuration readable + valid       (fail closed)
 *  2. automatic selection enabled          (default DISABLED)
 *  3. job facts readable                   (fail closed)
 *  4. mandatory lifecycle exclusion        (never configurable)
 *  5. enquiry created at/after activation  (no historical backlog sweep)
 *  6. the existing single-route selector must choose offer_spot
 *  7. S102 service-coverage gate           (a postcode filter match below never replaces this)
 *  8. the configured filters               (AND across categories, OR within)
 *
 * Steps 1–7 are mandatory safety controls; step 8 is the only configurable one.
 *
 * DELIBERATELY NOT RE-CHECKED HERE: the COM-04 switches, owner consent, opt-out/suppression,
 * duplicate/idempotency, uncertain-delivery protection, approved templates, the S102 test-recipient
 * boundary and sender permissions. Those all live in `sendOne` (`hot-leads-send.server`) and run
 * immediately after this gate, before any provider call. Re-implementing them here would duplicate one
 * safety rulebook and would change the route/reason S102 already guarantees. The Office preview DOES
 * report those controls (it is read-only reporting), which is why a preview row can show a mandatory
 * exclusion that the gate itself would not raise.
 */
export async function automaticSaveSpotGate(jobId: string, opts: { route?: string | null; coverageVerified?: boolean } = {}): Promise<AutomaticGateVerdict> {
  const read = await readAutomaticRules();
  if (read.state !== "ok") return blocked("rules_unavailable", RULES_UNAVAILABLE_REASON);
  const config = read.config;
  if (!config.enabled) return blocked("selection_disabled", AUTOMATIC_SELECTION_OFF_REASON);

  const facts = await loadAutomaticCandidate(jobId);
  if (!facts) return blocked("job_unreadable", "This job could not be read, so nothing is automatically sent.");

  const lifecycle = lifecycleExclusion(facts.stage);
  if (lifecycle) return blocked("lifecycle", lifecycle);

  if (!config.activatedAt) return blocked("rules_unavailable", RULES_UNAVAILABLE_REASON);
  const created = facts.createdAt ? Date.parse(facts.createdAt) : NaN;
  if (!Number.isFinite(created) || created < Date.parse(config.activatedAt)) return blocked("historical", BACKLOG_REASON);

  let route: string | null | undefined = opts.route;
  if (route === undefined) {
    const { selectLeadEmailRoute } = await import("./lead-email-routing.server");
    const selected = await selectLeadEmailRoute(jobId);
    route = selected?.email ?? null;
  }
  if (route !== "offer_spot") return blocked("not_offer_spot", "This enquiry is not on the Save my spot automatic route.");

  if (!opts.coverageVerified) {
    const { serviceCoverageEstablished } = await import("./service-coverage.server");
    if (!(await serviceCoverageEstablished(jobId))) return blocked("service_area", SERVICE_AREA_REASON);
  }

  const match = matchAutomaticRules(facts, config.rules, Date.now());
  if (!match.eligible) {
    const reasons = match.failedCategories.map((c) => (facts && CATEGORY_MISMATCH_REASON[c]) ?? "Outside the configured filters");
    return blocked("rule_mismatch", reasons.join("; "), match.failedCategories);
  }
  return ALLOWED;
}

// ---------- Office preview (read-only) ----------

export type PreviewVerdict = "eligible" | "mandatory_excluded" | "needs_office_review" | "rule_excluded" | "records_unavailable";

export type PreviewRow = {
  jobId: string;
  jobNumber: string | null;
  eligibilityOutcome: string | null;
  insulation: string | null;
  areaM2: number | null;
  postcode: string | null;
  stage: string | null;
  stageLabel: string;
  enquiryDate: string | null;
  verdict: PreviewVerdict;
  reason: string;
};

export type AutomaticRulesPreview = {
  readState: AutomaticRulesRead["state"];
  readReason: string;
  automaticSelectionEnabled: boolean;
  com04Ready: boolean;
  deliveryConfigured: boolean;
  activeRules: string[];
  activatedAt: string | null;
  scanned: number;
  scanLimit: number;
  counts: { matching: number; mandatoryExcluded: number; needsOfficeReview: number; ruleExcluded: number; recordsUnavailable: number; eligible: number };
  /** True when any mandatory-record batch could not be read. No row may be reported ready on partial data. */
  recordsUnavailable: boolean;
  /** Operator-visible detail of which mandatory records failed and how many of their batches. */
  recordsError: string | null;
  page: number;
  pageSize: number;
  pages: number;
  rows: PreviewRow[];
};

type MandatoryFacts = { consentGranted: boolean; optedOut: boolean; alreadySent: boolean; coverage: boolean };

/** Shown on every row whose mandatory status could not be determined. Deliberately distinct from a rule exclusion. */
export const RECORDS_UNAVAILABLE_REASON = "Preview cannot determine this result: the mandatory safety records could not be read.";

/**
 * P1-R1-S111: how many ids go into ONE PostgREST request.
 *
 * `.in()` values travel in the GET query string. The preview scans up to
 * `PREVIEW_SCAN_LIMIT = 500` enquiries, and 500 uuid ids build a ~19-20 KB URL, which the gateway
 * rejects — that made every mandatory-record read fail and the whole preview report
 * "Mandatory records could not be read." The codebase already bounds the SAME tables: `CHUNK = 150`
 * in `enquiry-groups.server.ts` and 150 in `operations-preview.server.ts`. 150 ids ≈ 5.9 KB, well under
 * the common 8 KB request-line limit. Same convention, same size.
 */
export const MANDATORY_BATCH_SIZE = 150;

type BatchRead<T> = { rows: T[]; batches: number; failedBatches: number; error: string | null };

/**
 * Read `values` in bounded batches and COMBINE the successful results.
 *
 * A failed batch is never silently dropped: it is counted and its message kept, so the caller can fail
 * closed and show the operator what went wrong. Partial rows are returned (they are correct for the
 * batches that succeeded) but are never sufficient on their own — `failedBatches > 0` is the signal.
 */
export async function readInBatches<T>(
  values: string[],
  read: (batch: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<BatchRead<T>> {
  const rows: T[] = [];
  let batches = 0;
  let failedBatches = 0;
  let error: string | null = null;
  for (let i = 0; i < values.length; i += MANDATORY_BATCH_SIZE) {
    batches += 1;
    const batch = values.slice(i, i + MANDATORY_BATCH_SIZE);
    const { data, error: batchError } = await read(batch);
    if (batchError) {
      failedBatches += 1;
      error ??= batchError.message;
      continue;
    }
    rows.push(...(data ?? []));
  }
  return { rows, batches, failedBatches, error };
}

/**
 * The mandatory, non-configurable reasons a preview row can never be automatically sent. Read-only
 * reporting, deliberately in the SAME order as `automaticSaveSpotGate` and then extended with the
 * sender-side controls the gate leaves to `sendOne`. Returns null when nothing mandatory blocks.
 *
 * P1-R1-S111: a mandatory-record READ FAILURE is no longer expressed here. It is a different thing —
 * "we could not look" rather than "this enquiry is excluded" — and it is carried by
 * `recordsUnavailable` so the Office can tell the two apart. Never call this with unreadable records.
 */
export function previewMandatoryBlock(x: {
  lifecycle: string | null; routeEmail: string; routeBlocker: string | null;
  coverage: boolean; com04Ready: boolean; deliveryConfigured: boolean;
  consentGranted: boolean; optedOut: boolean; alreadySent: boolean;
  enabled: boolean; activatedAt: string | null; createdAt: string | null;
}): string | null {
  if (x.lifecycle) return x.lifecycle;
  if (x.routeEmail !== "offer_spot") return x.routeBlocker ?? "Not on the Save my spot automatic route.";
  if (!x.coverage) return SERVICE_AREA_REASON;
  if (!x.com04Ready) return "Customer communications or Save my spot sending are switched off.";
  if (!x.deliveryConfigured) return "Customer email delivery is not configured.";
  if (!x.consentGranted) return "No contact consent from the owner on record.";
  if (x.optedOut) return "Owner opted out.";
  if (x.alreadySent) return "A Save my spot email already exists for this enquiry.";
  if (!x.enabled) return AUTOMATIC_SELECTION_OFF_REASON;
  if (!x.activatedAt) return RULES_UNAVAILABLE_REASON;
  const created = x.createdAt ? Date.parse(x.createdAt) : NaN;
  return Number.isFinite(created) && created >= Date.parse(x.activatedAt) ? null : BACKLOG_REASON;
}

/**
 * READ-ONLY. Loads the mandatory per-job safety facts for the scanned enquiries in bulk and returns
 * the same verdict the live gate would reach. It sends nothing, reserves no idempotency key, writes
 * no delivery record, changes no status and triggers no workflow.
 */
export async function previewAutomaticSaveSpotMatching(page = 1): Promise<AutomaticRulesPreview> {
  const nowMs = Date.now();
  const read = await readAutomaticRules();
  const rules: AutomaticRuleFilters = read.state === "ok" ? read.config.rules : defaultFilters();
  const enabled = read.state === "ok" && read.config.enabled;
  const activatedAt = read.state === "ok" ? read.config.activatedAt : null;

  const { realSendingOn } = await import("./hot-leads-send.server");
  const com04Ready = await realSendingOn();
  const { data: delivery } = await admin.from("customer_delivery_settings").select("enabled").eq("id", 1).maybeSingle();
  const deliveryConfigured = (delivery as { enabled?: boolean } | null)?.enabled === true;

  const { data: rowsRaw, error: jobsError } = await admin
    .from("jobs")
    .select(candidateSelect)
    .not("eligibility_decision_source", "is", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(PREVIEW_SCAN_LIMIT);
  if (jobsError) throw new Error(`Automatic sending preview could not load enquiries: ${jobsError.message}`);
  const rows = (rowsRaw ?? []) as unknown as CandidateRow[];
  const ids = rows.map((r) => r.id);

  // One coverage read for every scanned postcode (S102 gate: the same positive signal, fail-closed).
  const distinctPostcodes = [...new Set(rows.map((r) => String(propertyOf(r.properties)?.postcode ?? "").trim()).filter(Boolean))];

  // P1-R1-S111: every id list is read in bounded batches of MANDATORY_BATCH_SIZE. Same five reads, same
  // filters, same order — only the request size changed. A batch that fails is counted and reported; it is
  // never dropped silently and never treated as "no rows".
  const nothing = <T>(): Promise<BatchRead<T>> => Promise.resolve({ rows: [], batches: 0, failedBatches: 0, error: null });
  type ConsentRow = { job_id: string; consent_status: string };
  type OptOutRow = { job_id: string; opted_out_at: string | null };
  type SendRow = { job_id: string; status: string };
  type PostcodeRow = { postcode: string };
  type JobRow = { job_id: string };
  const [consents, optouts, sends, postcodes, intakeWork] = await Promise.all([
    ids.length ? readInBatches<ConsentRow>(ids, (b) => admin.from("owner_contact_consents").select("job_id, consent_status, created_at").in("job_id", b).order("created_at", { ascending: false })) : nothing<ConsentRow>(),
    ids.length ? readInBatches<OptOutRow>(ids, (b) => admin.from("customer_email_optouts").select("job_id, opted_out_at").in("job_id", b)) : nothing<OptOutRow>(),
    ids.length ? readInBatches<SendRow>(ids, (b) => admin.from("customer_email_sends").select("job_id, status").eq("purpose", LAUNCH_CAMPAIGN).in("job_id", b)) : nothing<SendRow>(),
    distinctPostcodes.length ? readInBatches<PostcodeRow>(distinctPostcodes, (b) => admin.from("veu_location_variables").select("postcode").in("postcode", b)) : nothing<PostcodeRow>(),
    ids.length ? readInBatches<JobRow>(ids, (b) => admin.from("post_intake_work").select("job_id").in("job_id", b).in("status", ["queued", "processing", "retry"])) : nothing<JobRow>(),
  ]);

  // Fail closed on any unreadable mandatory record set: no row is reported ready on partial data, and the
  // operator is told which records failed. A read failure is NOT a rule exclusion.
  const reads: { label: string; read: { batches: number; failedBatches: number; error: string | null } }[] = [
    { label: "owner contact consents", read: consents },
    { label: "opt-outs", read: optouts },
    { label: "existing Save my spot sends", read: sends },
    { label: "VEU service coverage", read: postcodes },
    { label: "intake work in progress", read: intakeWork },
  ];
  const failedReads = reads.filter((r) => r.read.failedBatches > 0);
  const recordsUnavailable = failedReads.length > 0;
  const recordsError = recordsUnavailable
    ? failedReads.map((r) => `${r.label} (${r.read.failedBatches} of ${r.read.batches} batches failed${r.read.error ? `: ${r.read.error}` : ""})`).join("; ")
    : null;

  const consented = new Map<string, boolean>();
  for (const c of consents.rows) {
    if (!consented.has(c.job_id)) consented.set(c.job_id, c.consent_status === "granted");
  }
  const optedOut = new Set(optouts.rows.filter((o) => !!o.opted_out_at).map((o) => o.job_id));
  const sent = new Set(sends.rows.filter((s) => s.status !== "failed").map((s) => s.job_id));
  const covered = new Set(postcodes.rows.map((p) => String(p.postcode).trim()));
  const intakeActive = new Set(intakeWork.rows.map((w) => w.job_id));

  const counts = { matching: 0, mandatoryExcluded: 0, needsOfficeReview: 0, ruleExcluded: 0, recordsUnavailable: 0, eligible: 0 };
  const all: PreviewRow[] = [];
  for (const row of rows) {
    const facts = candidateFacts(row);
    const postcode = (facts.postcode ?? "").trim();
    const mandatory: MandatoryFacts = {
      consentGranted: consented.get(row.id) === true,
      optedOut: optedOut.has(row.id),
      alreadySent: sent.has(row.id),
      coverage: covered.has(postcode),
    };
    const lifecycle = lifecycleExclusion(facts.stage);
    // The ONE existing post-Gate-1 selector decides the route for preview rows too — never a second
    // rulebook that could drift from what the automatic router actually does.
    const route = automaticLeadEmail({
      source: row.source, channel: row.channel, decisionSource: row.eligibility_decision_source,
      reviewRequired: row.eligibility_review_required === true, outcome: row.eligibility_outcome,
      intakeWorkActive: intakeActive.has(row.id), declaredInsulation: facts.insulation,
      ownerEnteredArea: !facts.areaUnknown && (facts.areaM2 ?? 0) > 0,
    });

    const mandatoryBlock = recordsUnavailable
      ? null // never conclude a rule exclusion from records we could not read
      : previewMandatoryBlock({
        lifecycle, routeEmail: route.email, routeBlocker: route.blocker,
        coverage: mandatory.coverage, com04Ready, deliveryConfigured,
        consentGranted: mandatory.consentGranted, optedOut: mandatory.optedOut, alreadySent: mandatory.alreadySent,
        enabled, activatedAt, createdAt: facts.createdAt,
      });

    const match = matchAutomaticRules(facts, rules, nowMs);
    const unknownOnly = !match.eligible && unknownCategories(facts, rules, match.failedCategories).length === match.failedCategories.length;
    const filterReason = match.failedCategories.map((c) => CATEGORY_MISMATCH_REASON[c]).join("; ");
    let verdict: PreviewVerdict;
    let reason: string;
    // P1-R1-S111 counting semantics. Invariants the Office can rely on:
    //   matching === eligible + mandatoryExcluded + recordsUnavailable
    //   scanned  === matching + ruleExcluded + needsOfficeReview
    // "Excluded by a mandatory rule" therefore ONLY ever means "matched the filters AND a mandatory
    // control excluded it". A filter mismatch is never reported as a mandatory exclusion.
    if (match.eligible) {
      counts.matching += 1;
      if (recordsUnavailable) {
        verdict = "records_unavailable";
        reason = `${RECORDS_UNAVAILABLE_REASON} This enquiry matches the selection rules; its mandatory checks were not evaluated.`;
        counts.recordsUnavailable += 1;
      } else if (mandatoryBlock) {
        verdict = "mandatory_excluded";
        reason = mandatoryBlock;
        counts.mandatoryExcluded += 1;
      } else {
        verdict = "eligible";
        reason = "Matches the selection rules only. The final sending checks in the email sender still apply.";
        counts.eligible += 1;
      }
    } else if (unknownOnly) {
      // Reachable from job facts alone — still accurate while the mandatory records are unavailable.
      verdict = "needs_office_review";
      reason = match.failedCategories.map((c) => CATEGORY_UNKNOWN_REASON[c]).join("; ");
      counts.needsOfficeReview += 1;
    } else {
      verdict = "rule_excluded";
      reason = filterReason;
      counts.ruleExcluded += 1;
    }
    all.push({
      jobId: row.id,
      jobNumber: facts.jobNumber,
      eligibilityOutcome: (ELIGIBILITY_LABEL[facts.eligibilityOutcome as EligibilityOutcomeValue] ?? facts.eligibilityOutcome),
      insulation: facts.insulation ? INSULATION_LABEL[facts.insulation] : null,
      areaM2: facts.areaM2,
      postcode: facts.postcode,
      stage: facts.stage,
      stageLabel: facts.stage ? jobStatusLabel(facts.stage) : "—",
      enquiryDate: facts.createdAt,
      verdict,
      reason,
    });
  }

  const pages = Math.max(1, Math.ceil(all.length / PREVIEW_PAGE_SIZE));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pages);
  return {
    readState: read.state,
    readReason: read.state === "ok" ? "Automatic sending rules are saved." : read.reason,
    automaticSelectionEnabled: enabled,
    com04Ready,
    deliveryConfigured,
    activeRules: read.state === "ok" ? describeRules(rules) : ["No saved rules — every enquiry is excluded from automatic sending."],
    activatedAt,
    scanned: all.length,
    scanLimit: PREVIEW_SCAN_LIMIT,
    counts,
    recordsUnavailable,
    recordsError,
    page: current,
    pageSize: PREVIEW_PAGE_SIZE,
    pages,
    rows: all.slice((current - 1) * PREVIEW_PAGE_SIZE, current * PREVIEW_PAGE_SIZE),
  };
}

/** The filter categories an Office user may switch on, in display order. */
export const RULE_CATEGORIES = FILTER_CATEGORIES;