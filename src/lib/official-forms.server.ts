// Persistence for signed official PIESA/PIISA copies (table official_form_signed_copies, private bucket
// official-form-copies). Server-only. Fails closed when the storage (migration 0075) isn't present.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildSignedSnapshot, documentSha, officialFormUseBlocker, OFFICIAL_TEMPLATES, type OfficialAnswers, type OfficialKey, type SignedSnapshot, type Signer } from "./official-forms.core";
import { piisaGate, type MaterialFacts, type PiisaPanel, type StoredCopy } from "./piisa-workflow.core";

export const OFFICIAL_BUCKET = "official-form-copies";
// The table is not in the generated types until 0075 is applied; keep the untyped access in one place.
const db = () => supabaseAdmin as unknown as { from: (t: string) => any; storage: typeof supabaseAdmin.storage };
const missing = (e: { code?: string } | null) => !!e && ["42P01", "PGRST205", "PGRST204"].includes(e.code ?? "");

export async function currentCopy(jobId: string, key: OfficialKey): Promise<{ copy: StoredCopy | null; unavailable: boolean }> {
  const { data, error } = await db().from("official_form_signed_copies").select("id,status,signature_date,snapshot,answers").eq("job_id", jobId).eq("form_key", key).eq("status", "current").maybeSingle();
  if (missing(error)) return { copy: null, unavailable: true };
  if (error) throw new Error(error.message);
  return { copy: data ? { id: data.id, status: data.status, signatureDate: data.signature_date, snapshot: data.snapshot as SignedSnapshot } : null, unavailable: false };
}

/** Stores a signed copy. Blocked while the form isn't approved for use. Never overwrites (upsert: false). */
export async function storeSignedCopy(input: { jobId: string; key: OfficialKey; answers: OfficialAnswers; signer: Signer; enteredDate: string; jobFacts: Record<string, string>; acknowledgementIds: string[]; signature: string; attachments?: SignedSnapshot["attachments"] }) {
  const block = officialFormUseBlocker(input.key);
  if (block) throw new Error(block);
  const t = OFFICIAL_TEMPLATES[input.key];
  const snap = buildSignedSnapshot({ ...input, serverTimestamp: new Date().toISOString() });
  const path = `jobs/${input.jobId}/${input.key}/${snap.hash}.json`;
  const up = await db().storage.from(OFFICIAL_BUCKET).upload(path, new Blob([JSON.stringify(snap)], { type: "application/json" }), { upsert: false });
  if (up.error) throw new Error(up.error.message);
  const prev = await currentCopy(input.jobId, input.key);
  if (prev.copy) await invalidateCopy(prev.copy.id, "Superseded by a newly signed copy.", input.signer.userId, "superseded");
  const { data, error } = await db().from("official_form_signed_copies").insert({
    job_id: input.jobId, form_key: input.key, template_title: t.title, template_publication: t.publication, mapping_version: t.mappingVersion,
    source_sha256: t.sha256, document_sha256: documentSha(snap.document), snapshot_sha256: snap.hash, snapshot: snap, answers: input.answers,
    attachments: input.attachments ?? [], job_facts: input.jobFacts, signer_user_id: input.signer.userId, signer_name: input.signer.name,
    signer_role: input.signer.role, signature_date: input.enteredDate, storage_path: path,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function invalidateCopy(id: string, reason: string, actor: string | null, status: "invalidated" | "superseded" = "invalidated") {
  if (!reason.trim()) throw new Error("A reason is required.");
  const { error } = await db().from("official_form_signed_copies").update({ status, invalidation_reason: reason.trim(), invalidated_at: new Date().toISOString(), invalidated_by: actor }).eq("id", id).eq("status", "current");
  if (error) throw new Error(error.message);
}

/** Short-lived signed URL. Visibility is decided by RLS on the caller's own client, never by the admin client. */
export async function signedCopyUrl(userClient: { from: (t: string) => any }, id: string) {
  const { data, error } = await userClient.from("official_form_signed_copies").select("storage_path").eq("id", id).maybeSingle();
  if (error || !data) throw new Error("Not found.");
  const r = await db().storage.from(OFFICIAL_BUCKET).createSignedUrl(data.storage_path, 300);
  if (r.error) throw new Error(r.error.message);
  return r.data.signedUrl;
}

export async function materialFacts(jobId: string, piesa: StoredCopy | null): Promise<{ facts: MaterialFacts; installDate: string | null }> {
  const a = supabaseAdmin;
  const [{ data: job }, { data: inst }, { data: book }, { data: m }] = await Promise.all([
    a.from("jobs").select("life_support").eq("id", jobId).single(),
    a.from("job_assignments").select("user_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    a.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").order("scheduled_start", { ascending: false }).limit(1).maybeSingle(),
    a.from("ceiling_measurements").select("insulation_present").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
  ]);
  const installDate = book?.scheduled_start ? new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(book.scheduled_start)) : null;
  return {
    installDate,
    facts: {
      installDate: installDate ?? "", lifeSupport: String(!!job?.life_support), leadInstallerId: inst?.user_id ?? "",
      piesaCopyId: piesa?.id ?? "", piesaCompletionDate: piesa?.signatureDate ?? "", existingInsulation: String(m?.insulation_present ?? ""),
    },
  };
}

export async function piisaPanel(jobId: string, today: string): Promise<PiisaPanel> {
  const [pe, pi] = await Promise.all([currentCopy(jobId, "piesa"), currentCopy(jobId, "piisa")]);
  if (pe.unavailable || pi.unavailable) return piisaGate({ today, installDate: null, piisa: null, piesa: null, facts: {}, piesaReceivedAt: null, conductiveExistingInsulation: null, conductivityEvidence: null, hazardResolution: null, storageUnavailable: true });
  const { facts, installDate } = await materialFacts(jobId, pe.copy);
  let piesaReceivedAt: string | null = null;
  if (pe.copy) {
    const { data } = await db().from("official_form_deliveries").select("delivered_at").eq("signed_copy_id", pe.copy.id).eq("recipient_role", "installer").order("delivered_at").limit(1).maybeSingle();
    piesaReceivedAt = data?.delivered_at ?? null;
  }
  // Conductivity is portal evidence outside the official form: explicit answer + file, never inferred from a blank.
  const { data: row } = pi.copy ? await db().from("official_form_signed_copies").select("answers").eq("id", pi.copy.id).single() : { data: null };
  const ans = (row?.answers ?? {}) as Record<string, unknown>;
  const c = String(ans["supp.conductive"] ?? "");
  return piisaGate({
    today, installDate, piisa: pi.copy, piesa: pe.copy, facts, piesaReceivedAt,
    conductiveExistingInsulation: c === "Yes" ? true : c === "No" ? false : null,
    conductivityEvidence: ans["supp.conductiveEvidence"] ? String(ans["supp.conductiveEvidence"]) : null,
    hazardResolution: null, // no verified-rectification link exists yet → fail closed
  });
}
