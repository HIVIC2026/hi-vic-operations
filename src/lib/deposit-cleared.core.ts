/** Pure: which jobs have the $349 safety check cleared for the office screens (Needs me, job status).
 *  Cleared = paid on the installation invoice (`invoice_status.deposit_cleared`) OR an admin deposit override recorded
 *  on that same invoice (`payment_overrides`, gate "deposit") — the same override `paymentGate` already accepts.
 *  `overridden` = cleared only by the override, so the office line can say "$349 overridden" rather than "$349 paid".
 *  Jo 1 Nov 2026 (HV-3666): an overridden job sat as "waiting for payment" and never showed "Choose electrician". */
type Row = Record<string, unknown>; // invoice_status rows (id, job_id, deposit_cleared) and payment_overrides rows (invoice_id, job_id)

export function depositClearedJobs(invoices: Row[], overrides: Row[]): { paid: Set<string>; overridden: Set<string> } {
  const overriddenInvoices = new Set(overrides.map((o) => String(o["invoice_id"])));
  const paid = new Set<string>();
  const overridden = new Set<string>();
  for (const v of invoices) {
    const job = String(v["job_id"]);
    if (v["deposit_cleared"] === true) paid.add(job);
    else if (overriddenInvoices.has(String(v["id"]))) { paid.add(job); overridden.add(job); }
  }
  for (const job of paid) if (overridden.has(job) && invoices.some((v) => String(v["job_id"]) === job && v["deposit_cleared"] === true)) overridden.delete(job);
  return { paid, overridden };
}
