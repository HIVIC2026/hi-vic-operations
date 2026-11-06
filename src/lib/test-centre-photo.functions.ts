// Test Centre photo (Jo 6 Nov 2026, approved): lets a dummy journey carry one ceiling photo so
// the firm-quote flow can run end to end on TEST data. TEST jobs only; admin or the verified TEST
// office; the photo is stored as private intake media exactly like a real website upload.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { WorkflowError } from "./workflow.server";
import { testPhotoFileBlocker, testPhotoPathOk, TEST_PHOTO_PATH_PREFIX } from "./test-centre-photo.core";

const fileInput = z.object({
  name: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().min(3).max(100),
  sizeBytes: z.number().int().positive(),
});

async function requireOffice(context: { supabase: never; userId: string }) {
  const { requireOfficeIdentity } = await import("./qa-office-access.server");
  await requireOfficeIdentity(context.supabase, context);
}

function checkedFile(data: { name: string; mimeType: string; sizeBytes: number }) {
  const blocker = testPhotoFileBlocker(data);
  if (blocker) throw new WorkflowError(blocker);
  return data.name;
}

/** Step 1: mint a one-off upload slot for the photo. */
export const testEnquiryPhotoUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => fileInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireOffice(context as never);
    const { sanitizeFilename } = await import("./enquiry.core");
    const path = `${TEST_PHOTO_PATH_PREFIX}${crypto.randomUUID()}_${sanitizeFilename(checkedFile(data))}`;
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await db.storage.from("job-files").createSignedUploadUrl(path);
    if (error || !signed) throw new WorkflowError("The upload could not start. Try again.");
    return { path, token: signed.token };
  });

/** Step 2: after the browser uploads, record the photo as intake media on the TEST job. */
export const attachTestEnquiryPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), path: z.string().trim().min(1).max(500), ...fileInput.shape }).parse(d))
  .handler(async ({ data, context }) => {
    await requireOffice(context as never);
    const { sanitizeFilename } = await import("./enquiry.core");
    const name = sanitizeFilename(checkedFile(data));
    if (!testPhotoPathOk(data.path)) throw new WorkflowError("That upload cannot be attached.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: job, error } = await db.from("jobs").select("id, source").eq("id", data.jobId).maybeSingle();
    if (error) throw new WorkflowError("Could not check that TEST journey.");
    if (!job || job.source !== "qa_test") throw new WorkflowError("Photos can only be attached to TEST journeys here.");
    const { error: docError } = await db.from("documents").insert({
      job_id: data.jobId, kind: "intake_media", title: `Test Centre upload: ${name}`, storage_path: data.path,
      mime_type: data.mimeType, source_system: "qa_test", original_name: name, size_bytes: data.sizeBytes,
    });
    if (docError) throw new WorkflowError("The photo could not be saved. Try again.");
    return { ok: true };
  });
