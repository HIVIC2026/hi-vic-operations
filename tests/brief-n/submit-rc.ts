// Brief N — browser-run step E. Drives the SAME portal Ready Check service functions the app calls
// (saveRcDraft / submitRcDraft), because the hivic_sourced onsite form in this build is Mitti-hosted.
// Records the visit evidence first: the disposable stack has no object-storage bucket for a real upload.
import { ID, preflight, serviceAdmin } from "./harness";
import { FULL_RC_VALUES } from "./messages";

await preflight();
const admin = await serviceAdmin();

const { data: req } = await admin.from("evidence_requirements").select("id, status")
  .eq("job_id", ID.jobFlow).eq("category", "measurement").maybeSingle();
if (req && (req as { status: string }).status === "outstanding") {
  const { error } = await admin.from("evidence_files").insert({
    requirement_id: (req as { id: string }).id, job_id: ID.jobFlow,
    storage_path: `${ID.jobFlow}/brief-n/ceiling-measurement.jpg`, file_name: "ceiling-measurement.jpg",
    mime_type: "image/jpeg", size_bytes: 128, uploaded_by: ID.installerAProfile,
    lat: -37.8183, lng: 144.9986, location_accuracy_m: 10, captured_at: new Date().toISOString(),
    distance_m: 5, location_source: "device",
  } as never);
  if (error) throw new Error(`evidence record: ${error.message}`);
  await admin.from("evidence_requirements").update({ status: "uploaded" }).eq("id", (req as { id: string }).id);
}

const { saveRcDraft, submitRcDraft } = await import("@/lib/ready-check-draft.server");
await saveRcDraft(ID.jobFlow, ID.installerAProfile, ID.bizA, FULL_RC_VALUES);
const done = await submitRcDraft(ID.jobFlow, ID.installerAProfile);
console.log(JSON.stringify({ status: done.status, missing: done.progress.evidence.missing }, null, 2));
