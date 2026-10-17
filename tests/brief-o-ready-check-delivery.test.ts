// Brief O — Ready Check delivery: channel availability, submission guards and the Office status fact.
//
// The integrated browser journey (docs/phase1/release/brief-o-evidence/browser) proves the user-facing
// path. This file covers the cases a browser cannot express cleanly: the Mitti-owned row, duplicate
// submission, a missing storage object, cross-business reads and the Office status fact.
//
// Run on its own (bun shares mock.module across files in one process):
//   bun test tests/brief-o-ready-check-delivery.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  ID, asUser, assertAppClientIsReal, failure, preflight, seedFixtures, serviceAdmin, type Admin,
} from "./brief-n/harness";
import { FULL_RC_VALUES } from "./brief-n/messages";

let admin: Admin;

// Brief O's own scratch jobs. Kept out of ALL_JOBS so a Brief O run never disturbs the Brief N fixtures.
const SVC_HIVIC = "fa400000-0000-4000-8000-000000000090";
const SVC_INSTALLER = "fa400000-0000-4000-8000-000000000091";
const SVC_EMPTY = "fa400000-0000-4000-8000-000000000092";
const SVC_JOBS = [SVC_HIVIC, SVC_INSTALLER, SVC_EMPTY];

/** A real, tiny JPEG. Written to the private bucket, so the evidence row points at actual stored bytes. */
const TINY_JPEG = new Blob([new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xff, 0xc4, 0x00, 0x14,
  0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x01, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x37, 0xff, 0xd9,
])], { type: "image/jpeg" });

/** Write the real object to the private bucket and confirm it the way the app does. */
async function uploadRealEvidence(jobId: string, category: string) {
  const { data: req } = await admin.from("evidence_requirements").select("id, label")
    .eq("job_id", jobId).eq("category", category).maybeSingle();
  if (!req) throw new Error(`no ${category} requirement on ${jobId}`);
  const requirementId = (req as { id: string }).id;
  const path = `${jobId}/${category}/${crypto.randomUUID()}-brief-o.jpg`;

  const { error: upErr } = await admin.storage.from("job-files").upload(path, TINY_JPEG, { contentType: "image/jpeg", upsert: false });
  if (upErr) throw new Error(`storage upload: ${upErr.message}`);

  // Same stored-byte validation the confirm server function runs before it records anything.
  const { verifyStoredUpload } = await import("@/lib/upload-safety.server");
  const { allowedUpload } = await import("@/lib/upload-safety.core");
  const mime = allowedUpload("brief-o.jpg", "image/jpeg");
  await verifyStoredUpload("job-files", path, mime);

  const { error } = await admin.from("evidence_files").insert({
    requirement_id: requirementId, job_id: jobId, storage_path: path, file_name: "brief-o.jpg",
    mime_type: "image/jpeg", size_bytes: 402, uploaded_by: ID.installerAProfile,
    lat: -37.8183, lng: 144.9986, location_accuracy_m: 10, captured_at: new Date().toISOString(),
    distance_m: 5, location_source: "device_at_upload",
  } as never);
  if (error) throw new Error(`evidence_files: ${error.message}`);
  const { error: reqErr } = await admin.from("evidence_requirements").update({ status: "uploaded" }).eq("id", requirementId);
  if (reqErr) throw new Error(`evidence_requirements: ${reqErr.message}`);
  return path;
}

/** Wipe this job's mutable rows so the suite is repeatable. Audit history is never touched. */
async function resetScratchJob(jobId: string) {
  for (const table of ["ready_check_observations", "ready_checks", "evidence_files", "job_assignments", "bookings", "partner_offers", "ready_check_windows"]) {
    const { error } = await admin.from(table).delete().eq("job_id", jobId);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  const { error } = await admin.from("evidence_requirements").update({ status: "outstanding" }).eq("job_id", jobId).eq("required", true);
  if (error) throw new Error(`evidence_requirements: ${error.message}`);
}

/** Create the job once, then reuse it. The channel and its originator are permanent by design. */
async function ensureJob(id: string, number: string, channel: string) {
  const { data: existing } = await admin.from("jobs").select("id, channel").eq("id", id).maybeSingle();
  if (!existing) {
    const { error } = await admin.from("jobs").insert({
      id, job_number: number, property_id: ID.property, owner_id: ID.owner, business_unit: "hivic",
      stage: "ready_check_scheduled", source: "qa_test", channel, life_support: false,
      life_support_status: "no", offer_dispatch_override: "office_picks",
      // The channel check constraint requires an originator on installer-sourced jobs and forbids one on
      // HIV-sourced jobs. Both are permanent once inserted, so the channel is chosen here, never flipped.
      ...(channel === "installer_sourced"
        ? { originating_installer_user_id: ID.installerAProfile, originating_installer_business_id: ID.bizA }
        : {}),
    } as never);
    if (error) throw new Error(`job ${number}: ${error.message}`);
  } else if ((existing as { channel: string }).channel !== channel) {
    throw new Error(`job ${number} exists with channel ${(existing as { channel: string }).channel}`);
  }
  const { error: stageErr } = await admin.from("jobs").update({
    stage: "ready_check_scheduled", prior_stage: null, next_action: null, deleted_at: null,
  }).eq("id", id);
  if (stageErr) throw new Error(`job ${number} stage: ${stageErr.message}`);
  const { data: assignment } = await admin.from("job_assignments").select("id").eq("job_id", id).eq("role", "installer").maybeSingle();
  if (!assignment) {
    const { error } = await admin.from("job_assignments").insert({
      job_id: id, user_id: ID.installerAProfile, role: "installer", active: true, business_id: ID.bizA,
    } as never);
    if (error) throw new Error(`assignment ${number}: ${error.message}`);
  }
}

beforeAll(async () => {
  await preflight();
  admin = await serviceAdmin();
  await assertAppClientIsReal();
  await seedFixtures(admin);
  for (const id of SVC_JOBS) await resetScratchJob(id);
  await ensureJob(SVC_HIVIC, "BRIEF-O-SVC-1", "hivic_sourced");
  await ensureJob(SVC_INSTALLER, "BRIEF-O-SVC-2", "installer_sourced");
  await ensureJob(SVC_EMPTY, "BRIEF-O-SVC-3", "hivic_sourced");
});

afterAll(async () => {
  // Leave the disposable stack clean of Brief O's transient state; the two scratch jobs stay, because
  // deleting a job would mean deleting the audit rows that hang off it.
  for (const id of SVC_JOBS) await resetScratchJob(id);
});

describe("1 — the native Ready Check is available on a hivic_sourced job", () => {
  test("1a nothing is recorded before the installer starts", async () => {
    const { readyCheckState } = await import("@/lib/ready-check-draft.server");
    expect(await readyCheckState(SVC_HIVIC)).toBeNull();
  });

  test("1b a partial save creates a draft on a hivic_sourced job (no channel guard blocks it)", async () => {
    const { saveRcDraft, loadRcDraft } = await import("@/lib/ready-check-draft.server");
    const saved = await saveRcDraft(SVC_HIVIC, ID.installerAProfile, ID.bizA, { "measure.eligible_area_m2": "118" });
    expect(saved.status).toBe("draft");
    expect(saved.fromMitti).toBe(false);
    expect(saved.values["measure.eligible_area_m2"]).toBe("118");
    // Saving never submits.
    expect(saved.readyCheckId).toBeTruthy();
    const { readyCheckState } = await import("@/lib/ready-check-draft.server");
    expect((await readyCheckState(SVC_HIVIC))?.status).toBe("draft");
    expect((await loadRcDraft(SVC_HIVIC)).status).toBe("draft");
  });

  test("1c an incomplete Ready Check cannot be submitted, and says exactly what is missing", async () => {
    const { submitRcDraft } = await import("@/lib/ready-check-draft.server");
    const message = await failure(() => submitRcDraft(SVC_HIVIC, ID.installerAProfile));
    expect(message).toContain("Not ready to submit:");
    expect(message).toContain("Answer needed: Attended at");
    expect(message).toContain("Photo or video needed: Ceiling measurement evidence");
    const { readyCheckState } = await import("@/lib/ready-check-draft.server");
    expect((await readyCheckState(SVC_HIVIC))?.status).toBe("draft");
  });

  test("1d complete answers alone are still not enough — the evidence gate holds", async () => {
    const { saveRcDraft, submitRcDraft } = await import("@/lib/ready-check-draft.server");
    await saveRcDraft(SVC_HIVIC, ID.installerAProfile, ID.bizA, FULL_RC_VALUES);
    const message = await failure(() => submitRcDraft(SVC_HIVIC, ID.installerAProfile));
    expect(message).toContain("Not ready to submit:");
    expect(message).toContain("Photo or video needed:");
    expect(message).not.toContain("Answer needed:");
  });

  test("1e real uploaded evidence unblocks the submission", async () => {
    const ceiling = await uploadRealEvidence(SVC_HIVIC, "measurement");
    await uploadRealEvidence(SVC_HIVIC, "existing_insulation_r_value");
    const { submitRcDraft, readyCheckState } = await import("@/lib/ready-check-draft.server");
    const submitted = await submitRcDraft(SVC_HIVIC, ID.installerAProfile);
    expect(submitted.status).toBe("submitted");
    const state = await readyCheckState(SVC_HIVIC);
    expect(state?.status).toBe("submitted");
    expect(state?.submittedAt).toBeTruthy();
    // The stored object really is in the private bucket under the job's prefix.
    const { data: listed } = await admin.storage.from("job-files").list(`${SVC_HIVIC}/measurement`);
    expect((listed ?? []).some((f) => ceiling.endsWith((f as { name: string }).name))).toBe(true);
  });

  test("1f a second submission is a no-op, not a duplicate record", async () => {
    const { submitRcDraft } = await import("@/lib/ready-check-draft.server");
    const { data: before } = await admin.from("ready_checks").select("id, submitted_at").eq("job_id", SVC_HIVIC);
    const again = await submitRcDraft(SVC_HIVIC, ID.installerAProfile);
    const { data: after } = await admin.from("ready_checks").select("id, submitted_at").eq("job_id", SVC_HIVIC);
    expect(again.status).toBe("submitted");
    expect(after?.length).toBe(1);
    expect(after?.[0]?.id).toBe(before?.[0]?.id);
    expect(after?.[0]?.submitted_at).toBe(before?.[0]?.submitted_at);
  });

  test("1g a submitted Ready Check cannot be edited", async () => {
    const { saveRcDraft } = await import("@/lib/ready-check-draft.server");
    const message = await failure(() => saveRcDraft(SVC_HIVIC, ID.installerAProfile, ID.bizA, { "measure.eligible_area_m2": "200" }));
    expect(message).toContain("already submitted");
  });
});

describe("2 — a Mitti-owned Ready Check is never edited through the portal", () => {
  test("2a the portal refuses to save onto a Mitti row", async () => {
    const { saveRcDraft } = await import("@/lib/ready-check-draft.server");
    // Point the existing row at a Mitti form, as a synced Ready Check would be.
    await admin.from("ready_checks").update({ external_mitti_id: "brief-o-mitti-fixture", status: "draft", submitted_at: null }).eq("job_id", SVC_HIVIC);
    const message = await failure(() => saveRcDraft(SVC_HIVIC, ID.installerAProfile, ID.bizA, { "measure.eligible_area_m2": "121" }));
    expect(message).toBe("This Ready Check came from Mitti — complete or correct it there.");
  });

  test("2b the portal refuses to submit a Mitti row", async () => {
    const { submitRcDraft } = await import("@/lib/ready-check-draft.server");
    const message = await failure(() => submitRcDraft(SVC_HIVIC, ID.installerAProfile));
    expect(message).toBe("This Ready Check came from Mitti — submit it there.");
  });

  test("2c the form reports the row as Mitti-owned so the UI can show a read-only notice", async () => {
    const { loadRcDraft, readyCheckState } = await import("@/lib/ready-check-draft.server");
    expect((await loadRcDraft(SVC_HIVIC)).fromMitti).toBe(true);
    expect((await readyCheckState(SVC_HIVIC))?.fromMitti).toBe(true);
  });
});

describe("3 — installer_sourced jobs keep working", () => {
  test("3a the same native form saves and submits on an installer_sourced job", async () => {
    const { saveRcDraft, submitRcDraft, readyCheckState } = await import("@/lib/ready-check-draft.server");
    const draft = await saveRcDraft(SVC_INSTALLER, ID.installerAProfile, ID.bizA, FULL_RC_VALUES);
    expect(draft.status).toBe("draft");
    expect(draft.fromMitti).toBe(false);
    await uploadRealEvidence(SVC_INSTALLER, "measurement");
    await uploadRealEvidence(SVC_INSTALLER, "existing_insulation_r_value");
    expect((await submitRcDraft(SVC_INSTALLER, ID.installerAProfile)).status).toBe("submitted");
    expect((await readyCheckState(SVC_INSTALLER))?.status).toBe("submitted");
  });
});

describe("4 — evidence cannot be claimed without real stored bytes", () => {
  test("4a a row pointing at a missing object fails the stored-byte check", async () => {
    const { verifyStoredUpload } = await import("@/lib/upload-safety.server");
    const { allowedUpload } = await import("@/lib/upload-safety.core");
    const mime = allowedUpload("brief-o.jpg", "image/jpeg");
    const message = await failure(() => verifyStoredUpload("job-files", `${SVC_INSTALLER}/measurement/does-not-exist.jpg`, mime));
    expect(message.length).toBeGreaterThan(0);
  });

  test("4b the private bucket is not publicly readable", async () => {
    const { data: bucket } = await admin.storage.getBucket("job-files");
    expect((bucket as { public: boolean }).public).toBe(false);
  });
});

describe("5 — cross-business access is refused by RLS, not by the UI", () => {
  test("5a the assigned installer can read the job's Ready Check", async () => {
    const asA = await asUser(ID.installerAProfile);
    const { data, error } = await asA.from("ready_checks").select("id").eq("job_id", SVC_INSTALLER);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
  });

  test("5b the other business reads nothing", async () => {
    const asB = await asUser(ID.installerBProfile);
    const { data, error } = await asB.from("ready_checks").select("id").eq("job_id", SVC_INSTALLER);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });
});

describe("6 — the Office status fact distinguishes a clear transition from finished work", () => {
  test("6a at ready_check_scheduled the fact reports the real submission state", async () => {
    const { nextStepBlockers } = await import("@/lib/workflow.server");
    const r = await nextStepBlockers(SVC_INSTALLER);
    expect(r.stage).toBe("ready_check_scheduled");
    expect(r.next).toBe("ready_check_complete");
    expect(r.readyCheck?.status).toBe("submitted");
  });

  test("6b before any Ready Check is recorded the fact says so, while the transition stays clear", async () => {
    const { nextStepBlockers } = await import("@/lib/workflow.server");
    const r = await nextStepBlockers(SVC_EMPTY);
    expect(r.stage).toBe("ready_check_scheduled");
    expect(r.next).toBe("ready_check_complete");
    // The move is not guarded (no permission change was made) — but the fact is reported, so the Office
    // screen can no longer read "no stage checks" as "the Ready Check is done".
    expect(r.readyCheck).toBeNull();
  });
});
