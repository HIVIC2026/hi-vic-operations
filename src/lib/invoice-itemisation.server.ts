// Job facts behind the tax-invoice itemisation (decision 209): read-only. Used by the Xero push at acceptance and by the
// final-invoice / completion-pack emails after install. Never writes product or measurement data.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { type InstalledProductFacts, type InsulationLine, insulationLine } from "./invoice-itemisation.core";

/**
 * Product = the product declared on the Mitti form (`mitti_product_recorded`, decisions 148/149); area = the current Ready
 * Check measurement (office-verified figure first). After install, the installer's signed declaration area and any office-
 * reviewed product label codes are preferred when `afterInstall` is set. Failures read as "unknown" (the caller flags), never throw.
 */
export async function installedProductFacts(jobId: string, opts: { afterInstall?: boolean } = {}): Promise<InstalledProductFacts> {
  const facts: InstalledProductFacts = { product: null, areaM2: null, escModelCodes: [] };
  try {
    const [{ productForHivQuote }, { data: m }] = await Promise.all([
      import("./insulation-product.server"),
      admin.from("ceiling_measurements").select("measured_area_m2, verified_area_m2").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    ]);
    facts.product = (await productForHivQuote(jobId)).product;
    const measured = m ? Number(m.verified_area_m2 ?? m.measured_area_m2) : NaN;
    facts.areaM2 = Number.isFinite(measured) && measured > 0 ? measured : null;
    if (opts.afterInstall) {
      const { data: decl } = await admin.from("installer_declarations").select("installed_area_m2").eq("job_id", jobId).eq("status", "signed").maybeSingle();
      const declared = decl?.installed_area_m2 != null ? Number(decl.installed_area_m2) : NaN;
      if (Number.isFinite(declared) && declared > 0) facts.areaM2 = declared;
      // Exact ESC model codes recorded by the office from the packaging/label photos (when the review stores them).
      const { data: prod } = await admin.from("evidence_requirements").select("status, notes").eq("job_id", jobId).eq("category", "product_evidence");
      const codes = (prod ?? []).filter((r) => r.status === "verified").flatMap((r) => {
        try { return ((JSON.parse(r.notes ?? "") as { products?: { code?: string }[] }).products ?? []).map((p) => p.code ?? "").filter(Boolean); } catch { return []; }
      });
      facts.escModelCodes = codes;
    }
  } catch (e) {
    console.error("installed product facts unavailable", jobId, (e as Error).message);
  }
  return facts;
}

/** The itemised insulation line for owner emails, or null when the facts are incomplete (the email then omits it). */
export async function installedProductLine(jobId: string): Promise<InsulationLine | null> {
  return insulationLine(await installedProductFacts(jobId, { afterInstall: true }));
}
