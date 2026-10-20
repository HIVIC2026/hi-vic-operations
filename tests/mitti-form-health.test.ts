import { test } from "bun:test";
import assert from "node:assert/strict";
import { inspectSavedMittiForm, canonicalMittiTemplateId } from "../src/lib/mitti-form-health.core";
import { MittiError } from "../src/lib/mitti.core";

const ID = "template_11111111111111111111111111111111";
const OTHER = "template_22222222222222222222222222222222";
const checkedAt = "2026-10-20T09:30:00.000Z";
const clock = () => checkedAt;
const valid = { template: { template_id: ID, name: "TEST Ready Check", items: [] } };
const input = { key: "ready_check" as const, savedId: ID, approvalBlocker: null };
const validate = () => ({ ok: true, issues: [] as string[] });

test("a missing saved ID performs no provider request and remains clearly unchecked", async () => {
  let calls = 0;
  const result = await inspectSavedMittiForm({ ...input, savedId: null }, async () => { calls++; return valid; }, validate, clock);
  assert.equal(calls, 0);
  assert.equal(result.connection, "not_checked");
  assert.equal(result.ok, false);
  assert.equal(result.checkedAt, checkedAt);
});

test("health reports the actual returned name, ID and check time", async () => {
  const ids: string[] = [];
  const result = await inspectSavedMittiForm(input, async id => { ids.push(id); return valid; }, validate, clock);
  assert.deepEqual(ids, [ID]);
  assert.equal(result.connection, "reachable");
  assert.equal(result.identity, "verified");
  assert.equal(result.templateName, "TEST Ready Check");
  assert.equal(result.returnedId, ID);
  assert.equal(result.schema, "valid");
  assert.equal(result.checkedAt, checkedAt);
  assert.equal(result.ok, true);
});

test("UUID and template-prefixed spellings are the same actual Mitti identity", async () => {
  const uuid = "11111111-1111-1111-1111-111111111111";
  assert.equal(canonicalMittiTemplateId(uuid), canonicalMittiTemplateId(ID));
  const result = await inspectSavedMittiForm({ ...input, savedId: uuid }, async () => valid, validate, clock);
  assert.equal(result.identity, "verified");
  assert.equal(result.ok, true);
});

test("a different returned ID is not accepted even with a valid-looking name", async () => {
  let validations = 0;
  const result = await inspectSavedMittiForm(input, async () => ({ template: { ...valid.template, template_id: OTHER } }),
    () => { validations++; return validate(); }, clock);
  assert.equal(result.identity, "mismatch");
  assert.equal(result.ok, false);
  assert.equal(validations, 0);
});

test("a successful response without a verifiable template ID stays unconfirmed", async () => {
  const result = await inspectSavedMittiForm(input, async () => ({ template: { name: "TEST Ready Check", items: [] } }), validate, clock);
  assert.equal(result.connection, "reachable");
  assert.equal(result.identity, "missing");
  assert.equal(result.schema, "not_checked");
  assert.equal(result.ok, false);
});

test("missing required questions are reported separately from working access", async () => {
  const result = await inspectSavedMittiForm(input, async () => valid, () => ({ ok: false, issues: ["Missing: Portal Job Number"] }), clock);
  assert.equal(result.connection, "reachable");
  assert.equal(result.identity, "verified");
  assert.equal(result.schema, "invalid");
  assert.deepEqual(result.schemaIssues, ["Missing: Portal Job Number"]);
  assert.equal(result.ok, false);
});

test("valid provider identity and schema do not override an official approval blocker", async () => {
  const blocker = "The PIESA mapping has not been approved.";
  const result = await inspectSavedMittiForm({ ...input, key: "piesa", approvalBlocker: blocker }, async () => valid, validate, clock);
  assert.equal(result.connection, "reachable");
  assert.equal(result.schema, "valid");
  assert.equal(result.approvalBlocker, blocker);
  assert.equal(result.ok, false);
});

test("missing access, rejected access and missing form are different failure states", async () => {
  for (const [error, expected] of [
    [new MittiError("missing", { code: "not_configured" }), "not_configured"],
    [new MittiError("rejected", { status: 401, code: "api_error" }), "access_denied"],
    [new MittiError("forbidden", { status: 403, code: "api_error" }), "access_denied"],
    [new MittiError("absent", { status: 404, code: "api_error" }), "not_found"],
  ] as const) {
    const result = await inspectSavedMittiForm(input, async () => { throw error; }, validate, clock);
    assert.equal(result.connection, expected);
    assert.equal(result.identity, "not_checked");
    assert.equal(result.schema, "not_checked");
    assert.equal(result.ok, false);
  }
});

test("unexpected provider failures return no raw bodies or secret values", async () => {
  const result = await inspectSavedMittiForm(input, async () => { throw new Error("PRIVATE_PROVIDER_BODY_AND_TOKEN"); }, validate, clock);
  assert.equal(result.connection, "unavailable");
  assert.equal(JSON.stringify(result).includes("PRIVATE_PROVIDER_BODY_AND_TOKEN"), false);
});

test("invalid saved IDs do not reach the provider", async () => {
  let calls = 0;
  const result = await inspectSavedMittiForm({ ...input, savedId: "../another-account" }, async () => { calls++; return valid; }, validate, clock);
  assert.equal(calls, 0);
  assert.equal(result.ok, false);
});

test("a malformed definition remains blocked when validation throws", async () => {
  const result = await inspectSavedMittiForm(input, async () => valid, () => { throw new Error("bad format"); }, clock);
  assert.equal(result.schema, "invalid");
  assert.equal(result.ok, false);
  assert.match(result.schemaIssues[0], /could not be validated/);
});

