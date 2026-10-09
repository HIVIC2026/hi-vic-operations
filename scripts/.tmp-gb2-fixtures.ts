import { writeFileSync } from "node:fs";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { createGroupBTestLink } from "@/lib/group-b-test-fixture.server";
import { groupBMediaForJob } from "@/lib/group-b-media.server";
const out: Record<string, unknown> = {};
for (const k of ["declared", "overr2", "origmedia", "unknown"]) {
  const f = await createGroupBTestLink("HV-1609");
  if (k === "origmedia" || k === "unknown") {
    const { data: j } = await admin.from("jobs").select("source, property_id, properties(enrichment)").eq("id", f.jobId).single();
    if (j!.source !== "qa_test") throw new Error("SAFETY");
    const raw = (j!.properties as any).enrichment.base44.raw;
    if (k === "origmedia") { raw.answers.media = [{ url: "https://fictitious.hivic-test.example/TEST-attic.jpg", type: "image/jpeg", name: "TEST-attic.jpg" }]; }
    else { delete raw.answers.media; delete raw.original_media_verification; }
    const { error } = await admin.from("properties").update({ enrichment: { base44: { raw } } } as never).eq("id", j!.property_id);
    if (error) throw error;
  }
  out[k] = { ...f, media: await groupBMediaForJob(f.jobId) };
}
writeFileSync("/tmp/browser/gb2/fixtures.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]: any) => [k, { job: v.jobNumber, media: v.media }]))));
