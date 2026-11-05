// Photo-quote installers Part 2 (Jo 5 Nov 2026): a "From photos" installer's OWN customer gets the photo quote on Add a job.
// Reads/writes behind own-photo-quote.core; the quote itself goes through the existing own-customer draft
// (installer-quote.server intake-price path) and the one guarded auto-send. No senders here.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { quoteMethodOf, isMissingQuoteMethodColumn, PHOTO_QUOTE_SUBMITTED_EVENT, sqm1, type QuoteMethod } from "./photo-quote.core";
import { ownPhotoIncludes, ownPhotoQuotePreview, ownPhotoQuoteProblems, type OwnPhotoPreview, type OwnPhotoQuoteInput } from "./own-photo-quote.core";
import { insulationProduct } from "./insulation-product.core";
import { isUniqueViolation, stableUuid } from "./mitti-create-claim.core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

/** How the business quotes; a missing column (pending SQL) reads as Ready Check. A real read failure throws. */
export async function businessQuoteMethod(businessId: string, db: Db = admin as unknown as Db): Promise<QuoteMethod> {
  const r = await db.from("businesses").select("quote_method").eq("id", businessId).maybeSingle();
  if (r.error) { if (isMissingQuoteMethodColumn(r.error)) return "ready_check"; throw new Error("Couldn't check how this installer quotes."); }
  return quoteMethodOf(r.data as { quote_method?: string | null } | null);
}

/** The live quote box on Add a job. Price-seeing people of a From photos business only. */
export async function ownPhotoQuotePreviewFor(userId: string, i: { businessId: string; priceIncGst: number; installM2: number; removeM2: number | null; postcode: string; product: string | null }): Promise<OwnPhotoPreview> {
  const c = await (await import("./trade-view.server")).pricesOrThrow(userId);
  if (c.biz.id !== i.businessId) throw new WorkflowError("You are not part of this business.");
  if ((await businessQuoteMethod(i.businessId)) !== "photos") throw new WorkflowError("This installer quotes from a Ready Check.");
  const m2 = sqm1(i.installM2);
  if (!(m2 && m2 > 0) || !(i.priceIncGst > 0)) return { held: "Enter the sqm and your price" };
  const [{ data: loc }, { data: rs }, piesa] = await Promise.all([
    admin.from("veu_location_variables").select("*").eq("postcode", i.postcode.trim()).maybeSingle(),
    admin.from("retail_estimator_settings").select("indicative_veec_value, minimum_customer_copayment_inc_gst").eq("is_current", true).maybeSingle(),
    (await import("./installer-paid-electricians.server")).installerSafetyCheckPrice(i.businessId),
  ]);
  const { wholeVeecDiscount } = await import("./estimate.core");
  const wholeVeec = loc && rs ? wholeVeecDiscount(m2, loc as never, Number(rs.indicative_veec_value)) : null;
  if (!wholeVeec) return { held: "Check the postcode — the rebate can't be worked out" };
  return ownPhotoQuotePreview({ priceIncGst: i.priceIncGst, installM2: m2, removeM2: i.removeM2, product: i.product, piesaIncGst: piesa,
    wholeVeec, metropolitan: (loc as { metropolitan_or_regional?: string }).metropolitan_or_regional === "Metropolitan", minCopay: rs ? Number(rs.minimum_customer_copayment_inc_gst) : 200 });
}

/** Refuses before any write: a photos business must send the photo quote fields and they must be right; a Ready Check
 *  business must not send them. */
export function ownPhotoQuoteGate(method: QuoteMethod, i: OwnPhotoQuoteInput | null | undefined): string[] {
  if (method !== "photos") return i ? ["This installer quotes from a Ready Check."] : [];
  if (!i) return ["Fill in the photo quote: existing insulation, sqm and your price."];
  return ownPhotoQuoteProblems(i);
}

type Logger = (jobId: string, actorId: string | null, type: string, summary: string, details?: Record<string, unknown>, opts?: { internal?: boolean }) => Promise<unknown>;
export type OwnPhotoDeps = {
  db: Db; logEvent: Logger;
  draft: (jobId: string, userId: string, ref: string, price: { totalIncGst: number; includes: string; areaM2: number }) => Promise<unknown>;
  autoSend: (jobId: string, o: { formCompleted: true; formModifiedAt: string | null; entries: []; enabled?: boolean }) => Promise<{ sent: boolean; reasons: string[] }>;
  sendOnPress: boolean;
};
function ownPhotoDeps(): OwnPhotoDeps {
  return {
    db: admin as unknown as Db,
    logEvent: async (...a) => (await import("./workflow.server")).logEvent(...(a as Parameters<typeof import("./workflow.server").logEvent>)),
    draft: async (jobId, userId, ref, price) => (await import("./installer-quote.server")).draftInstallerQuoteFromReadyCheck(jobId, userId, [], ref, price),
    autoSend: async (jobId, o) => (await import("./auto-quote-send.server")).maybeAutoSendInstallerQuote(jobId, o),
    sendOnPress: false,
  };
}

export const OWN_PHOTO_REF = "photo:own";
/** After the Add a job save: the photo quote's measurement, product, eligibility and the boss's price (once per job — a
 *  Try again resumes), then the own-customer draft and the one guarded release (send-on-press rule unchanged). */
export async function recordOwnPhotoQuote(jobId: string, userId: string, businessId: string, i: OwnPhotoQuoteInput, over: Partial<OwnPhotoDeps> = {}): Promise<{ sent: boolean; held: string[] }> {
  const { OWN_CUSTOMER_SEND_ON_PRESS_ENABLED } = await import("./auto-quote-send.core");
  const d = { ...ownPhotoDeps(), sendOnPress: OWN_CUSTOMER_SEND_ON_PRESS_ENABLED, ...over };
  const removeM2 = sqm1(i.removeM2) ?? 0, installM2 = sqm1(i.installM2)!, product = insulationProduct(i.product)!;
  const price = Math.round(i.priceIncGst! * 100) / 100;
  const inputs = { underR2: true, removeM2, installM2, product: product.option, priceIncGst: price };
  const claimId = await stableUuid(`photo-quote:${jobId}:own`);
  const ins = await d.db.from("workflow_events").insert({ id: claimId, job_id: jobId, actor_id: userId, event_type: PHOTO_QUOTE_SUBMITTED_EVENT, internal: true,
    summary: `Photo quote on Add a job: ${installM2} m² to install, ${removeM2} m² to remove, ${product.option}`, details: { own_customer: true, business_id: businessId, ref: OWN_PHOTO_REF, inputs } });
  if (ins.error && !isUniqueViolation(ins.error)) throw new Error(`The photo quote could not be saved: ${ins.error.message}`);
  const cur = await d.db.from("ceiling_measurements").select("id,external_source").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  if (cur.error) throw new Error("Could not read the job's measurement.");
  if ((cur.data as { external_source?: string } | null)?.external_source !== "photo_quote") {
    if (cur.data) await d.db.from("ceiling_measurements").update({ is_current: false }).eq("id", (cur.data as { id: string }).id).eq("is_current", true);
    const m = await d.db.from("ceiling_measurements").insert({ job_id: jobId, is_current: true, status: "complete", completed_at: new Date().toISOString(), completed_by: userId, created_by: userId,
      source_role: "installer", measured_by_business_id: businessId, external_source: "photo_quote", external_id: OWN_PHOTO_REF,
      measured_area_m2: installM2, removal_required: removeM2 > 0, removal_m2: removeM2, insulation_present: removeM2 > 0, access_difficulty: "easy", review_flags: [], raw_snapshot: { photo_quote: inputs } });
    if (m.error) throw new Error(`The photo quote measurement could not be saved: ${m.error.message}`);
  }
  const prior = await d.db.from("workflow_events").select("event_type").eq("job_id", jobId).in("event_type", ["mitti_product_recorded", "ready_check_form_eligible", "installer_price_set"]).contains("details", { source_ref: OWN_PHOTO_REF });
  if (prior.error) throw new Error("Could not read the photo quote records.");
  const have = new Set(((prior.data ?? []) as { event_type: string }[]).map((e) => e.event_type));
  if (!have.has("mitti_product_recorded")) await d.logEvent(jobId, userId, "mitti_product_recorded", `Insulation product recorded from the photo quote (declared, not verified): ${product.option}`, { ready: true, product, source: "photo_quote", reasons: [], declared_not_verified: true, source_ref: OWN_PHOTO_REF }, { internal: true });
  if (!have.has("ready_check_form_eligible")) await d.logEvent(jobId, userId, "ready_check_form_eligible", "Eligible from the installer's photo quote (existing insulation under R2)", { audit_id: OWN_PHOTO_REF, basis: "photo_quote", source_ref: OWN_PHOTO_REF, ruleset: "photo-quote-v1" }, { internal: true });
  if (!have.has("installer_price_set")) {
    const { validateInstallerPrice } = await import("./installer-price.core");
    const { INCLUDED_OPTIONS } = await import("./ready-check-lean.core");
    const v = validateInstallerPrice({ priceIncGst: price, included: removeM2 > 0 ? [INCLUDED_OPTIONS[0], INCLUDED_OPTIONS[1]] : [INCLUDED_OPTIONS[0]], productOption: product.option, removalRequired: removeM2 > 0 });
    if (!v.ok || !v.record) throw new Error(v.issues.join(" "));
    await d.logEvent(jobId, userId, "installer_price_set", `Price set on Add a job (photo quote): $${price}`, { ...v.record, business_id: businessId, set_by: userId, declared_not_verified: true, source_ref: OWN_PHOTO_REF }, { internal: true });
  }
  await d.draft(jobId, userId, OWN_PHOTO_REF, { totalIncGst: price, includes: ownPhotoIncludes({ product: product.option, removeM2 }), areaM2: installM2 });
  const r = await d.autoSend(jobId, { formCompleted: true, formModifiedAt: new Date().toISOString(), entries: [], ...(d.sendOnPress ? { enabled: true } : {}) });
  return { sent: r.sent, held: r.reasons };
}

/** "View quote (PDF)": the owner's quote as a PDF with both logos. Refused (server side) unless the job is the caller's
 *  business's OWN customer and the caller can see prices (boss, or Office with Money on) — never on a Home Insulation Victoria lead. */
export async function ownQuotePdfFor(jobId: string, userId: string): Promise<{ base64: string; fileName: string }> {
  const tv = await import("./trade-view.server");
  const c = await tv.requireTradeJob(userId, jobId);
  const { data: j, error } = await admin.from("jobs").select("job_number, channel, originating_installer_business_id, owners(full_name), properties(address_line, suburb, postcode)").eq("id", jobId).maybeSingle();
  if (error || !j) throw new WorkflowError("Job not found.");
  const { viewQuoteAllowed, ownQuotePdfBlocks } = await import("./own-photo-quote.core");
  if (!viewQuoteAllowed({ channel: j.channel, originatingBusinessId: j.originating_installer_business_id, businessId: c.biz.id, seesPrices: c.prices === true && (c.boss || c.money === true) }))
    throw new WorkflowError("The quote isn't available here.");
  const { data: q, error: qe } = await admin.from("quotes").select("id, status, customer_total_inc_gst, veec_discount_inc_gst, quote_items(code, description, line_total_inc_gst, sort)").eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (qe || !q) throw new WorkflowError("There's no quote yet.");
  const items = ([...((q as { quote_items?: { code: string | null; description: string | null; line_total_inc_gst: number | string; sort: number | null }[] }).quote_items ?? [])])
    .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0)).map((i) => ({ code: i.code, description: String(i.description ?? ""), line_total_inc_gst: Number(i.line_total_inc_gst) }));
  const logoUrl = await tv.businessLogoUrl(c.biz.id).catch(() => null);
  const logo = await (await import("./tax-invoice-pdf.server")).fetchPartnerLogo(logoUrl);
  const prop = j.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | null;
  const address = prop ? (await import("./address")).fullAddress(prop.address_line, prop.suburb, prop.postcode) || null : null;
  const status = q.status === "accepted" ? "Accepted" : q.status === "issued" ? "Sent to the owner" : "Being checked before it goes to the owner";
  let blocks;
  try {
    blocks = ownQuotePdfBlocks({ jobNumber: j.job_number, owner: (j.owners as { full_name: string | null } | null)?.full_name ?? null, address, items, rebateIncGst: Number(q.veec_discount_inc_gst ?? 0), totalIncGst: Number(q.customer_total_inc_gst), status },
      logo ? { ...logo, alt: c.biz.name ?? "Installer" } : null);
  } catch { throw new WorkflowError("This quote can't be shown as a PDF. Email us and we'll send it."); }
  const { renderPdf } = await import("./pdf-look.server");
  const { bytes } = await renderPdf({ title: "Quote", blocks });
  return { base64: Buffer.from(bytes).toString("base64"), fileName: `Quote-${j.job_number ?? "job"}.pdf` };
}
