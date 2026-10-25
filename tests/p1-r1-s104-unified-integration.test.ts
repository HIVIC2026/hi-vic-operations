// P1-R1-S104: unified RC1 integration verification — focused tests.
//
// SCOPE (integration + minimal remediation only, no new features):
//   A. Step 3 — the Office preview must not imply that a matching customer is guaranteed an email,
//      must disclose its own scope, and must keep the 500-record limit and the read-only architecture.
//   B. Step 4 — the live automatic path order and the ten safety confirmations, plus the distinction
//      between a VEU postcode (a covered Victorian rebate location) and installer availability.
//
// No network, no provider call, no production access, no migration, no COM-04 activation, fictional data.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const PAGE = readFileSync("src/routes/_authenticated/admin.save-my-spot-rules.tsx", "utf8");
const PREVIEW_SERVER = readFileSync("src/lib/save-spot-rules.server.ts", "utf8");
const ROUTER = readFileSync("src/lib/lead-email-routing.server.ts", "utf8");
const SENDER = readFileSync("src/lib/hot-leads-send.server.ts", "utf8");
const COVERAGE = readFileSync("src/lib/service-coverage.server.ts", "utf8");
const OFFER_COPY = readFileSync("src/lib/save-spot-offer.core.ts", "utf8");
const VITE = readFileSync("vite.config.ts", "utf8");
const OFFER_BRANCH = ROUTER.slice(ROUTER.indexOf('if (route.email === "offer_spot")'), ROUTER.indexOf('if (route.email === "request_insulation")'));
const GATE = PREVIEW_SERVER.slice(PREVIEW_SERVER.indexOf("export async function automaticSaveSpotGate"), PREVIEW_SERVER.indexOf("// ---------- Office preview"));

// ============================================================ A. PREVIEW ACCURACY
describe("Step 3 — the preview does not promise that an email will be sent", () => {
  test("the overclaim 'shows exactly what the automatic route would do' is gone", () => {
    expect(PAGE).not.toContain("shows exactly what the automatic route would do");
  });

  test("the eligible bucket is labelled as selection-only, not 'eligible'/'finally eligible'", () => {
    expect(PAGE).toContain("Matches selection rules — final sending checks pending");
    expect(PAGE).not.toContain('"Finally eligible"');
    expect(PAGE).not.toContain('eligible: "Eligible"');
  });

  test("the intro states the preview is read-only and not a promise of a send", () => {
    expect(PAGE).toContain("not a promise that an email is sent");
    expect(PAGE).toContain("Read-only");
    expect(PAGE).toContain("never reserves a send");
  });

  test("the sender-side checks the preview does NOT model are disclosed", () => {
    for (const item of ["a secure estimate link exists", "a current preliminary price exists", "the spot is not already saved", "the approved email template for this outcome"]) {
      expect(PAGE).toContain(item);
    }
    expect(PAGE).toContain("Not modelled here");
  });

  test("the preview scope and its limit are disclosed from the server value, not hard-coded", () => {
    expect(PAGE).toContain("not a full history report");
    expect(PAGE).toContain("{d.scanLimit}");
    expect(PREVIEW_SERVER).toContain("scanLimit: PREVIEW_SCAN_LIMIT");
    expect(PREVIEW_SERVER).toContain("export const PREVIEW_SCAN_LIMIT = 500;");
  });

  test("the eligible reason is qualified server-side too", () => {
    expect(PREVIEW_SERVER).toContain("Matches the selection rules only. The final sending checks in the email sender still apply.");
    expect(PREVIEW_SERVER).not.toContain('reason = "Matches every configured filter and every mandatory rule."');
  });

  test("the preview architecture is unchanged: read-only, no sender, no second sending engine", () => {
    // Comment and JSDoc lines mention the sender by name (explaining that it is NOT called), so assert on code.
    const code = PREVIEW_SERVER.split("\n")
      .map((l) => l.trimStart())
      .filter((l) => !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*"))
      .join("\n");
    expect(code).not.toContain("sendSaveMySpot");
    expect(code).not.toContain("sendOne");
    expect(code).not.toContain("resendSend");
    // Zero-write proof: the module only ever selects.
    expect(code).not.toContain(".insert(");
    expect(code).not.toContain(".update(");
    expect(code).not.toContain(".delete(");
    // It reuses the ONE existing selector and the ONE coverage signal.
    expect(PREVIEW_SERVER).toContain("automaticLeadEmail");
    expect(PAGE).toContain("Read-only");
  });
});

// ============================================================ B. VEU POSTCODE vs INSTALLER AVAILABILITY
describe("Step 4 — a VEU postcode is not installer availability", () => {
  test("the coverage module states the distinction explicitly", () => {
    expect(COVERAGE).toContain("does NOT infer installer availability from a postcode");
  });

  test("the Office screen says so where the coverage rule and the postcode filter are shown", () => {
    expect(PAGE).toContain("not installer availability");
  });

  test("the approved Save-my-spot copy makes no installer-availability or service-area promise", () => {
    const customerFacing = OFFER_COPY.split("\n").filter((l) => l.includes("`")).join("\n").toLowerCase();
    for (const claim of ["we service", "service your area", "an installer is available", "we can install", "installer availability", "available in your area", "we cover your area"]) {
      expect(customerFacing).not.toContain(claim);
    }
    // Decision 388: spot-only wording instead — never a Ready Check before the spot is released.
    expect(OFFER_COPY).not.toContain("Ready Check"); expect(OFFER_COPY).toContain("spots are released in the order they were saved");
  });

  test("no installer-coverage claim is derived from the postcode filter alone", () => {
    expect(PAGE).toContain("A postcode match never proves service coverage");
  });
});

// ============================================================ C. LIVE AUTOMATIC PATH ORDER
describe("Step 4 — live automatic path order is intact", () => {
  test("offer_spot branch runs selector → coverage → rules gate → sender, in that order", () => {
    const iSelector = OFFER_BRANCH.indexOf("syncStep3");
    const iCoverage = OFFER_BRANCH.indexOf("serviceCoverageEstablished");
    const iGate = OFFER_BRANCH.indexOf("automaticSaveSpotGate");
    const iSend = OFFER_BRANCH.indexOf("await sendSaveMySpot(");
    expect(iSelector).toBeGreaterThan(-1);
    expect(iCoverage).toBeGreaterThan(iSelector);
    expect(iGate).toBeGreaterThan(iCoverage);
    expect(iSend).toBeGreaterThan(iGate);
  });

  test("there is exactly one gate call (S102 is not applied twice)", () => {
    expect(OFFER_BRANCH.match(/serviceCoverageEstablished\(/g)?.length).toBe(1);
    expect(OFFER_BRANCH.match(/automaticSaveSpotGate\(/g)?.length).toBe(1);
    expect(ROUTER.match(/automaticSaveSpotGate\(/g)?.length).toBe(1);
    expect(ROUTER.match(/serviceCoverageEstablished\(/g)?.length).toBe(1);
  });

  test("every gate failure returns route none / sent false (never a partial send)", () => {
    expect(ROUTER).toContain('if (!gate.allowed) return { route: "none", sent: false, reason: gate.reason };');
    expect(ROUTER).toContain('return { route: "none", sent: false, reason: SERVICE_AREA_REASON };');
  });
});

// ============================================================ D. THE TEN SAFETY CONFIRMATIONS
describe("Step 4 — Office rules can only restrict selection", () => {
  test("1-2 COM-04: both switches, fail closed, enforced in the sender not the rules gate", () => {
    expect(SENDER).toContain("save_my_spot_real_send_enabled === true && ws.customer_comms_enabled === true");
    expect(SENDER).toContain('if (mode === "send" && !isTest && !followup && !realOn) return r("blocked", "Sending is switched off.");');
    expect(GATE).not.toContain("realSendingOn");
  });

  test("3 consent is enforced inside sendOne, after the rules gate", () => {
    expect(SENDER).toContain("hasCurrentOwnerContactConsent");
    expect(SENDER).toContain('if (!(await hasCurrentOwnerContactConsent(jobId))) return r("skipped", "No current contact consent.");');
  });

  test("4 opt-out / suppression is enforced inside sendOne and fails closed on read error", () => {
    expect(SENDER).toContain("customer_email_optouts");
    expect(SENDER).toContain('if (optError || responseError || linkError || estimateError) return r("blocked"');
    expect(SENDER).toContain('if (opt?.opted_out_at || resp?.opted_out_at) return r("skipped", "Owner opted out.");');
  });

  test("5 duplicate prevention / idempotency is enforced inside sendOne", () => {
    expect(SENDER).toContain("idempotency_key");
    expect(SENDER).toContain("reservationAllowed");
    expect(SENDER).toContain('if (mode === "send" && ex && !reservationAllowed(ex)) return r("skipped", "Already sent to this home.");');
    expect(SENDER).toContain("delivered_unrecorded");
  });

  test("6 approved templates only", () => {
    expect(SENDER).toContain("INSULATION_DETAILS_REAL_SEND_APPROVED");
    expect(SENDER).toContain('if (!isTest && mode === "send" && !INSULATION_DETAILS_REAL_SEND_APPROVED) return r("blocked", "Insulation email awaits final visual approval");');
  });

  test("7 recipient restrictions: checked early AND on the final recipient immediately before the provider call", () => {
    const boundaryIdx = SENDER.indexOf("const boundary = testRecipientBoundary(to, job.source);");
    const finalIdx = SENDER.indexOf("const finalBoundary = testRecipientBoundary(to, job.source);");
    const providerIdx = SENDER.indexOf("await resendSend(to, mail.subject");
    expect(boundaryIdx).toBeGreaterThan(-1);
    expect(finalIdx).toBeGreaterThan(boundaryIdx);
    expect(providerIdx).toBeGreaterThan(finalIdx);
    expect(SENDER).toContain('finalBoundary.status === "blocked"');
  });

  test("8 missing / invalid / unreadable rules configuration fails closed", () => {
    expect(PREVIEW_SERVER).toContain('if (read.state !== "ok") return blocked("rules_unavailable"');
    expect(PREVIEW_SERVER).toContain('if (!config.enabled) return blocked("selection_disabled"');
    expect(PREVIEW_SERVER).toContain('if (!facts) return blocked("job_unreadable"');
  });

  test("9 historical backlog is never processed", () => {
    expect(PREVIEW_SERVER).toContain('return blocked("historical", BACKLOG_REASON);');
    expect(PREVIEW_SERVER).toContain("created < Date.parse(config.activatedAt)");
  });

  test("10 manual Office sending is unaffected (the gate is called only from the automatic router)", () => {
    expect(ROUTER.match(/automaticSaveSpotGate\(/g)?.length).toBe(1);
    expect(GATE).not.toContain("actorId");
  });

  test("the rules gate cannot widen the route: it only receives an already-selected offer_spot", () => {
    expect(ROUTER).toContain('automaticSaveSpotGate(jobId, { route: "offer_spot", coverageVerified: true })');
  });
});

// ============================================================ E. INTEGRATION PRESERVATION
describe("Step 2 — S101 environment/client-bundle protection survived integration", () => {
  test("the S101 orphan-chunk prune plugin is present and registered", () => {
    expect(VITE).toContain("hiv-prune-orphan-server-chunks-s101");
    expect(VITE).toContain("[s101-prune]");
    expect(VITE).toContain('apply: "build"');
  });

  test("the S101 report travelled with the integration", () => {
    expect(readFileSync("P1-R1-S101_ENVIRONMENT_REMEDIATION.md", "utf8")).toContain("B3-06");
  });

  test("S102 and S103 deliverables are all present", () => {
    for (const f of [
      "docs/phase1/release/P1-R3-S102_COM04_DUAL_MODE_REMEDIATION.md",
      "docs/phase1/release/P1-R3-S102_STEP_RECORD.md",
      "docs/phase1/release/P1-R3-S103_OFFICE_CONFIGURABLE_AUTOMATIC_SENDING.md",
      "docs/phase1/release/P1-R3-S103_STEP_RECORD.md",
      "docs/pending-migrations/0206_save_my_spot_auto_rules.sql",
      "docs/pending-migrations/0206_save_my_spot_auto_rules.rollback.sql",
    ]) {
      expect(readFileSync(f, "utf8").length).toBeGreaterThan(0);
    }
  });

  test("fail-closed defaults: selection DISABLED by default, 0206 still a proposal only", () => {
    expect(PREVIEW_SERVER).toContain('Automatic sending rules are unavailable');
    const migration = readFileSync("docs/pending-migrations/0206_save_my_spot_auto_rules.sql", "utf8");
    expect(migration).toContain("NOT APPLIED");
    expect(migration).toContain("Empty object = not configured");
  });
});