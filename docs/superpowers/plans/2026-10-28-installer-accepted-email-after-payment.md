# Installer "Owner accepted" email after payment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The installer's "Owner accepted … has paid for the electrical safety check" email goes only once the $349 safety check is actually paid, not at quote acceptance.

**Architecture:** Remove the call from `invoiceAfterAcceptance` (quote accepted). Add a small helper in `installer-accepted-email.server.ts` that finds the invoice's accepted quote and calls the existing `emailInstallerQuoteAccepted`. Call that helper from `afterPaymentsChanged` in the same `isStepPaid(v.steps, "safety_check")` branch that already sends the owner's O22 email.

**Tech Stack:** TypeScript, Supabase (admin client), bun:test (repo uses source-reading tests for server wiring).

**Spec:** `docs/superpowers/specs/2026-10-28-installer-accepted-email-after-payment-design.md`

## Global Constraints

- Email wording unchanged (`renderInstallerAcceptedEmail` untouched).
- Same recipient, same test-job rules, same once-per-quote check (`installer_accepted_email` event with `quote_id`).
- No waiver handling (HIV never waives the safety check).
- Email failure never blocks payment processing (best-effort, caught + logged).

## Review Focus

1. Payment synced from Xero several times after it's paid → email still goes once (existing per-quote check; test pins the helper uses `emailInstallerQuoteAccepted`).
2. Invoice with no quote, or quote not "accepted" → no email (helper returns early).
3. Jobs where the early email already went (HV-3385) → no second email on payment (same per-quote check).
4. Owner accepts but never pays → no installer email ever.
5. Email error while a payment lands → payment flow carries on (call wrapped in `.catch`).

---

### Task 1: Move the installer email from acceptance to safety-check-paid

**Files:**
- Modify: `src/lib/installer-accepted-email.server.ts` (add helper, update header comment)
- Modify: `src/lib/portal.functions.ts` (`invoiceAfterAcceptance`, ~line 829–831: remove the email call)
- Modify: `src/lib/payments.server.ts` (`afterPaymentsChanged`, ~line 223: call the helper in the safety-check-paid branch)
- Test: `tests/installer-accepted-email.test.ts` (replace the second test)

**Interfaces:**
- Consumes: `emailInstallerQuoteAccepted(jobId: string, quoteId: string): Promise<string>` (existing).
- Produces: `emailInstallerOnSafetyCheckPaid(jobId: string, invoiceId: string): Promise<string>` in `src/lib/installer-accepted-email.server.ts`.

- [ ] **Step 1: Write the failing test** — replace test "sent once per quote after acceptance…" with:

```ts
test("sent once per quote only when the safety check is paid — never at acceptance (Jo 28 Oct 2026)", () => {
  const srv = readFileSync("src/lib/installer-accepted-email.server.ts", "utf8");
  expect(srv).toContain('eq("event_type", "installer_accepted_email").contains("details", { quote_id: quoteId })');
  expect(srv).toContain("sendOfficeEmail(");
  expect(srv).toContain("sendTestEmail(");
  expect(srv).toContain("export async function emailInstallerOnSafetyCheckPaid(jobId: string, invoiceId: string)");
  expect(srv).toMatch(/status\s*!==\s*"accepted"/);
  const pf = readFileSync("src/lib/portal.functions.ts", "utf8");
  const acc = pf.slice(pf.indexOf("async function invoiceAfterAcceptance"), pf.indexOf("// ---------- Payments"));
  expect(acc).not.toContain("emailInstallerQuoteAccepted");
  const pay = readFileSync("src/lib/payments.server.ts", "utf8");
  const branch = pay.slice(pay.indexOf('if (isStepPaid(v.steps, "safety_check"))'), pay.indexOf("if (v.plan.fixesCents > 0"));
  expect(branch).toContain("emailInstallerOnSafetyCheckPaid(jobId, invoiceId)");
  expect(branch).toContain('console.error("installer accepted email skipped"');
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `bun test tests/installer-accepted-email.test.ts`
Expected: FAIL (helper missing; acceptance still calls the email).

- [ ] **Step 3: Add `emailInstallerOnSafetyCheckPaid(jobId, invoiceId)`** in `installer-accepted-email.server.ts`: read `invoices.quote_id, quotes(status)` for `invoiceId`; return `"not due — no quote"` if no quote_id, `"not due — quote not accepted"` if `status !== "accepted"`; otherwise `return emailInstallerQuoteAccepted(jobId, quote_id)`. Update the file's header comment to say it sends once the safety check is paid (Jo 28 Oct 2026).

- [ ] **Step 4: Remove the call from `invoiceAfterAcceptance`** in `portal.functions.ts` (the `// Jo 24 Oct: tell the installer` line + its try/catch). Update the F13 comment above to point to the payment hook.

- [ ] **Step 5: Call it in `afterPaymentsChanged`** — turn the `isStepPaid(v.steps, "safety_check")` line into a block that keeps the O22 call and adds:
`await (await import("./installer-accepted-email.server")).emailInstallerOnSafetyCheckPaid(jobId, invoiceId).catch((e) => console.error("installer accepted email skipped", (e as Error).message));`

- [ ] **Step 6: Run tests, expect PASS**

Run: `bun test tests/installer-accepted-email.test.ts tests/owner-fixes-flow.test.ts tests/add-job-confirmations.test.ts tests/approved-email-designs.test.ts`
Expected: all pass. Then full suite: `bun run test` — no new failures. Then `bunx tsc --noEmit` — no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/installer-accepted-email.server.ts src/lib/portal.functions.ts src/lib/payments.server.ts tests/installer-accepted-email.test.ts docs/superpowers
git commit -m "fix: installer 'owner accepted' email waits until the safety check is paid"
```

### Task 2: Ship and check live

- [ ] **Step 1:** Push to `HIVIC2026/hi-vic-operations` main (Lovable syncs from GitHub); confirm the portal rebuilt.
- [ ] **Step 2:** Read-only DB check: no new `installer_accepted_email` events on jobs whose safety check isn't paid (`workflow_events` joined to `invoices.total_paid`), from the deploy time on.
