// Tax invoice PDF (website look, approved sample tax-invoice-sample.pdf). Server-only. Xero stays the book of record: nothing here writes to Xero.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { PdfBlock } from "./pdf-look.core";
import { renderPdf } from "./pdf-look.server";
import { PDF_LOOK_APPROVED } from "./pdf-approvals.core";
import { BUSINESS_NAME_LINE, REBATE_LABEL, removalM2ForInvoice, taxInvoiceModel, taxInvoicePayments, taxInvoiceProductLine, type TaxInvoiceFacts, type TaxInvoiceModel, type TaxInvoiceSeam } from "./tax-invoice-pdf.core";

export type { TaxInvoiceFacts } from "./tax-invoice-pdf.core";

export function taxInvoiceBlocks(f: TaxInvoiceFacts, m: TaxInvoiceModel): PdfBlock[] {
  const tick = m.balance.includes("✓");
  return [
    // Part 10 Task 7: an own customer's invoice carries the installer's logo beside ours (model.partnerLogo); absent = Part 1's header.
    { id: "t-head", kind: "header", eyebrow: `TAX INVOICE${f.jobNumber ? ` · JOB ${f.jobNumber}` : ""}`, compact: true, withAddress: true, ...(m.partnerLogo ? { partnerLogo: m.partnerLogo } : {}) },
    { id: "t-title", kind: "title", text: "Tax invoice", sub: `Invoice ${f.invoiceNumber} · Date ${f.invoiceDate}`, compact: true },
    { id: "t-facts", kind: "facts", compact: true, fullFrom: 2, rows: [
      ["Bill to", f.ownerName], ["Installation address", f.installAddress],
      ["Contracting business (Accredited Person)", BUSINESS_NAME_LINE], ["Installed by", `${f.installerName}, on ${f.installedOn}`],
    ] },
    { id: "t-items", kind: "ledger", head: { label: "Installed", amount: "Amount" }, note: m.gstLine,
      rows: [...m.rows, { label: m.priceBeforeLabel ?? "Price before VEU rebate", amount: m.priceBeforeRebate, strong: true }, { label: m.rebateLabel ?? REBATE_LABEL, amount: m.rebate }],
      total: { label: m.payableLabel ?? "Amount payable after rebate (incl. GST)", amount: m.payable } },
    { id: "t-paid", kind: "ledger", head: { label: "Payments", amount: "" }, rows: m.payments,
      total: { label: "Balance", amount: m.balance.replace(/\s*✓$/, ""), ...(tick ? { tick } : {}) } },
  ];
}

export async function taxInvoicePdf(f: TaxInvoiceFacts, seam: TaxInvoiceSeam = {}): Promise<{ held: string } | { bytes: Uint8Array; layout: import("./pdf-look.core").PdfLayoutReport }> {
  const m = taxInvoiceModel(f, seam);
  if ("held" in m) return m;
  const { bytes, layout } = await renderPdf({ title: "Tax invoice", blocks: taxInvoiceBlocks(f, m) });
  return { bytes, layout };
}

/** Part 10 Task 7: the installer's logo bytes for the PDF (Part 5's https URL only; PNG/JPG under 2 MB; anything else → null = our logo alone). */
async function fetchPartnerLogo(url: string | null): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length || bytes.length > 2_000_000) return null;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50, jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!png && !jpg) return null;
    const { PDFDocument } = await import("pdf-lib");
    const probe = await PDFDocument.create();
    const img = png ? await probe.embedPng(bytes) : await probe.embedJpg(bytes);
    return { bytes, width: img.width, height: img.height };
  } catch { return null; }
}

const TAX_INVOICE_KIND = "tax_invoice";
const MELB = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", ...o });
const fmtLong = (iso: string) => MELB({ weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)).replace(",", "");
const fmtShort = (iso: string) => MELB({ day: "numeric", month: "short" }).format(new Date(iso));
const cents = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);

/** Reads the installation invoice, ledger, completion date and confirmed product (existing readers), builds the tax invoice and
 *  files it as documents kind `tax_invoice`, once per invoice and amount received. Anything missing returns `{ held }`; Xero is never written. */
export async function fileTaxInvoicePdf(jobId: string): Promise<{ path: string } | { held: string }> {
  // Held until Jo approves the tax invoice sample (pdf-approvals.core).
  if (!PDF_LOOK_APPROVED.taxInvoice) return { held: "Tax invoice not made: the new tax invoice layout is awaiting approval" };
  const [{ jobPaymentView }, { reachedOn }, { installedProductFacts }, { insulationLine }, { formatPropertyAddress }] = await Promise.all([
    import("./payments.server"), import("./receipt-pdf.core"), import("./invoice-itemisation.server"), import("./invoice-itemisation.core"), import("./address"),
  ]);
  const [{ data: job, error: jobErr }, view, { data: asg, error: asgErr }] = await Promise.all([
    admin.from("jobs").select("job_number, installation_completed_at, channel, originating_installer_business_id, owners(full_name), properties(address_line, suburb, state, postcode)").eq("id", jobId).maybeSingle(),
    jobPaymentView(jobId),
    admin.from("job_assignments").select("businesses(name, trading_name)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
  ]);
  if (jobErr || asgErr) return { held: "Tax invoice not made: the job could not be read" };
  if (!job) return { held: "Tax invoice not made: the job was not found" };
  const inv = view?.invoices.install;
  if (!view || !inv) return { held: "Tax invoice not made: the job has no installation invoice yet" };
  if (!inv.quote_id) return { held: "Tax invoice not made: the installation invoice has no quote" };
  const [{ data: q, error: qErr }, { data: items, error: iErr }, { data: invRow, error: dErr }, { data: internals, error: nErr }, { data: meas, error: mErr }] = await Promise.all([
    admin.from("quotes").select("veec_discount_inc_gst").eq("id", inv.quote_id).maybeSingle(),
    admin.from("quote_items").select("code, line_total_inc_gst").eq("quote_id", inv.quote_id),
    admin.from("invoices").select("created_at").eq("id", inv.id).maybeSingle(),
    admin.from("quote_internals").select("calc_snapshot").eq("quote_id", inv.quote_id).maybeSingle(),
    admin.from("ceiling_measurements").select("removal_required, removal_m2").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
  ]);
  if (qErr || iErr || dErr || nErr || mErr) return { held: "Tax invoice not made: the quote or invoice could not be read" };
  if (!q || !items?.length) return { held: "Tax invoice not made: the quote lines are missing" };
  const piesaCents = items.filter((r) => r.code === "PIESA").reduce((s, r) => s + cents(r.line_total_inc_gst), 0);
  // Part 10 Task 7: an installer's own customer (co-brand approved) — the insulation line is INSTALLER_PRICE alone; the
  // separately agreed extras (their own words) and the Home Insulation Victoria fee are extra lines, by code never description.
  const { OWN_CUSTOMER_COBRAND_APPROVED } = await import("./cobrand.core");
  const jobRow = job as { channel?: string | null; originating_installer_business_id?: string | null };
  const ownJob = OWN_CUSTOMER_COBRAND_APPROVED && jobRow.channel === "installer_sourced" && !!jobRow.originating_installer_business_id;
  let extraLines: { label: string; cents: number }[] | undefined;
  let productCents: number;
  if (ownJob) {
    const { data: named, error: namedErr } = await admin.from("quote_items").select("code, description, line_total_inc_gst, sort").eq("quote_id", inv.quote_id);
    if (namedErr) return { held: "Tax invoice not made: the quote or invoice could not be read" };
    const sorted = [...(named ?? [])].sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));
    productCents = sorted.filter((r) => r.code === "INSTALLER_PRICE").reduce((s, r) => s + cents(r.line_total_inc_gst), 0);
    const { OWN_CUSTOMER_LABELS } = await import("./own-customer-price.core");
    extraLines = [
      ...sorted.filter((r) => (r.code === "INSTALLER_REMOVAL" || r.code === "INSTALLER_EXTRA") && cents(r.line_total_inc_gst) > 0).map((r) => ({ label: String(r.description ?? ""), cents: cents(r.line_total_inc_gst) })),
      ...sorted.filter((r) => r.code === "AP_FEE").map((r) => ({ label: OWN_CUSTOMER_LABELS.apFee, cents: cents(r.line_total_inc_gst) })),
    ];
    const other = sorted.filter((r) => !["INSTALLER_PRICE", "INSTALLER_REMOVAL", "INSTALLER_EXTRA", "AP_FEE", "PIESA"].includes(String(r.code)) && cents(r.line_total_inc_gst) > 0);
    if (other.length || !(productCents > 0)) return { held: "Tax invoice not made: the quote lines are not the approved own-customer lines" };
  } else {
    productCents = items.filter((r) => r.code !== "PIESA" && cents(r.line_total_inc_gst) > 0).reduce((s, r) => s + cents(r.line_total_inc_gst), 0);
  }
  const extrasCents = (extraLines ?? []).reduce((s, e) => s + e.cents, 0);
  const rebateCents = cents(q.veec_discount_inc_gst);
  if (productCents + extrasCents + piesaCents - rebateCents !== cents(inv.total_inc_gst)) return { held: "Tax invoice not made: the quote lines do not add up to the invoice total" };

  const line = insulationLine(await installedProductFacts(jobId, { afterInstall: true }));
  const o = job.owners as unknown as { full_name: string | null } | null;
  const biz = (asg?.businesses ?? null) as { name: string | null; trading_name: string | null } | null;
  // `view.ledger` is the effective ledger of THIS installation invoice only (rawPaymentLedger filters by invoice id), so fixes and repeat PIESA payments never count.
  const { payments, received } = taxInvoicePayments(view.plan, view.ledger, fmtShort);
  const removalM2 = removalM2ForInvoice(internals?.calc_snapshot as { removal_m2?: unknown } | null, meas);

  const facts: TaxInvoiceFacts = {
    invoiceNumber: inv.xero_invoice_number, // invoiceDate = invoices.created_at: no Xero invoice date is stored; use that column instead if one is added.
    invoiceDate: invRow?.created_at ? fmtLong(invRow.created_at) : "", jobNumber: job.job_number,
    ownerName: o?.full_name ?? "", installAddress: formatPropertyAddress(job.properties as never), installerName: (biz?.trading_name ?? biz?.name ?? "").replace(/^\[TEST PARTNER\]\s*/, ""),
    installedOn: job.installation_completed_at ? fmtLong(job.installation_completed_at) : "",
    productLine: taxInvoiceProductLine(line, removalM2),
    productCents, piesaCents, rebateCents, payments,
    ...(extraLines ? { extraLines } : {}),
  };
  if (ownJob) {
    // The originating business's name and Part 5's logo; a failed read or fetch = our logo alone, never a broken image.
    const bizId = jobRow.originating_installer_business_id!;
    const [{ data: ob }, logoUrl] = await Promise.all([
      admin.from("businesses").select("name, trading_name").eq("id", bizId).maybeSingle(),
      (await import("./trade-view.server")).businessLogoUrl(bizId).catch(() => null),
    ]);
    const own = ob as { name: string | null; trading_name: string | null } | null;
    const installerName = (own?.trading_name ?? own?.name ?? "").replace(/^\[TEST PARTNER\]\s*/, "").trim();
    facts.ownCustomer = installerName ? { installerName, installerLogoUrl: logoUrl, installerLogo: await fetchPartnerLogo(logoUrl) } : null;
  }
  const made = await taxInvoicePdf(facts);
  if ("held" in made) return made;

  const key = `${inv.id}:${received}`;
  const { data: have, error: haveErr } = await admin.from("documents").select("storage_path").eq("job_id", jobId).eq("kind", TAX_INVOICE_KIND).eq("external_id", key).limit(1).maybeSingle();
  if (haveErr) return { held: "Tax invoice not made: the job file could not be checked" };
  if (have?.storage_path) return { path: have.storage_path };
  const path = `${jobId}/tax-invoices/${key.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
  const up = await admin.storage.from("job-files").upload(path, new Blob([made.bytes as BlobPart], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
  if (up.error && !/exist|duplicate/i.test(up.error.message)) return { held: "Tax invoice not made: the file could not be saved" };
  const ins = await admin.from("documents").insert({ job_id: jobId, kind: TAX_INVOICE_KIND, title: `Tax invoice ${facts.invoiceNumber}`, storage_path: path, mime_type: "application/pdf", uploaded_by: null, source_system: "portal", external_id: key, size_bytes: made.bytes.byteLength });
  if (ins.error) {
    const { data: again } = await admin.from("documents").select("storage_path").eq("job_id", jobId).eq("kind", TAX_INVOICE_KIND).eq("external_id", key).limit(1).maybeSingle();
    if (again?.storage_path) return { path: again.storage_path };
    return { held: "Tax invoice not made: the file could not be recorded" };
  }
  return { path };
}
