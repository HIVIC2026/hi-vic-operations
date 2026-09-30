// TO ACTION list: pure derivation over live records. Nothing is stored, so an item disappears
// the moment the underlying record shows the step was done. Staff never tick anything off here.

export type TodoItem = {
  key: string; // stable per underlying record + task
  category: "Payments" | "Eligibility" | "Pricing" | "Measure-up" | "Scheduling" | "Compliance" | "Partners";
  jobId: string | null; jobNumber: string | null; property: string | null;
  title: string; action: string; tab: string | null; since: string | null; urgent: boolean;
};

type Job = { id: string; job_number: string | null; property: string | null; stage: string; eligibility_review_required: boolean | null };
export type TodoInput = {
  jobs: Job[];
  invoices: { id: string; job_id: string; xero_invoice_id: string | null; xero_invoice_number: string | null; deposit_request_raised_at: string | null; deposit_amount: number | null; deposit_cleared: boolean | null; status: string; last_sync_error: string | null; xero_update_pending: boolean | null; created_at: string | null }[];
  rectOther: { id: string; job_id: string; description: string | null; created_at: string | null }[];
  measureReview: { id: string; job_id: string; created_at: string | null }[];
  reassignments: { id: string; job_id: string; role: string; reason: string | null; created_at: string | null }[];
  partnerEnquiries: { id: string; name: string | null; kind: string | null; created_at: string | null }[];
  now: number;
};

/** Stages where the next move sits with HI VIC office staff. */
export const OFFICE_STAGE_ACTIONS: Record<string, { category: TodoItem["category"]; title: string; action: string; tab: string }> = {
  eligibility_review: { category: "Eligibility", title: "Decide eligibility", action: "Open the Eligibility tab, check the numbered checklist and record the decision.", tab: "eligibility" },
  awaiting_electrician: { category: "Scheduling", title: "Assign an electrician", action: "Open the Overview tab and assign an approved electrician for the PIESA.", tab: "overview" },
  ready_for_installer_quotes: { category: "Pricing", title: "Prepare the quote", action: "Open the Quotes tab and generate the installation quote options.", tab: "quotes" },
  ap_review: { category: "Compliance", title: "Complete AP review", action: "Open the Evidence and VEEC tabs, verify every item and pass AP review.", tab: "evidence" },
  ready_for_veec: { category: "Compliance", title: "Lodge VEECs", action: "Lodge with the ESC, then record the quantity and submission reference on the VEEC tab.", tab: "veec" },
};

const DAY = 86_400_000;
const older = (iso: string | null, days: number, now: number) => !!iso && now - new Date(iso).getTime() > days * DAY;

export function buildTodos(i: TodoInput): TodoItem[] {
  const jobs = new Map(i.jobs.map((j) => [j.id, j]));
  const out: TodoItem[] = [];
  const push = (jobId: string | null, t: Omit<TodoItem, "jobId" | "jobNumber" | "property">) => {
    if (jobId && !jobs.has(jobId)) return; // job finalised / cancelled / test — not active work
    const j = jobId ? jobs.get(jobId)! : null;
    out.push({ ...t, jobId, jobNumber: j?.job_number ?? null, property: j?.property ?? null });
  };

  for (const v of i.invoices) {
    if (v.status === "xero_sync_error" || v.last_sync_error) {
      push(v.job_id, { key: `inv-sync:${v.id}`, category: "Payments", title: "Fix Xero sync error", action: `Xero said: "${v.last_sync_error ?? "sync failed"}". Fix it in Xero or the job, then retry sync on the Quotes tab.`, tab: "quotes", since: v.created_at, urgent: true });
      continue;
    }
    if (v.xero_invoice_id && !v.deposit_request_raised_at && !v.deposit_cleared && v.status !== "fully_paid") {
      const amt = v.deposit_amount != null ? ` for $${Number(v.deposit_amount).toFixed(2)}` : "";
      push(v.job_id, { key: `inv-dep:${v.id}`, category: "Payments", title: "Request deposit in Xero", action: `In Xero open invoice ${v.xero_invoice_number ?? ""} → "Request deposit" (50%${amt}). Then press "Mark deposit request raised" on the Quotes tab.`, tab: "quotes", since: v.created_at, urgent: older(v.created_at, 1, i.now) });
    }
    if (v.xero_update_pending) {
      push(v.job_id, { key: `inv-due:${v.id}`, category: "Payments", title: "Update invoice due date in Xero", action: `The install date changed. Set invoice ${v.xero_invoice_number ?? ""} due date in Xero to the new install date.`, tab: "quotes", since: v.created_at, urgent: false });
    }
  }
  for (const j of i.jobs) {
    if (j.eligibility_review_required) {
      push(j.id, { key: `gate1:${j.id}`, category: "Eligibility", title: "REVIEW REQUIRED – Gate 1", action: "Open the Eligibility tab, resolve the flagged checks and record the decision.", tab: "eligibility", since: null, urgent: false });
      continue;
    }
    const s = OFFICE_STAGE_ACTIONS[j.stage];
    if (s) push(j.id, { key: `stage:${j.stage}:${j.id}`, category: s.category, title: s.title, action: s.action, tab: s.tab, since: null, urgent: false });
  }
  for (const r of i.rectOther) push(r.job_id, { key: `rect:${r.id}`, category: "Pricing", title: "Price an 'Other' electrical item", action: `Enter description, quantity, price and explanation for "${r.description ?? "item"}" on the PIESA tab.`, tab: "piesa", since: r.created_at, urgent: false });
  for (const m of i.measureReview) push(m.job_id, { key: `meas:${m.id}`, category: "Measure-up", title: "Review the measure-up", action: "Open the Assessment tab, check the measure-up and evidence, then accept or reject it.", tab: "assessment", since: m.created_at, urgent: false });
  for (const r of i.reassignments) push(r.job_id, { key: `reassign:${r.id}`, category: "Scheduling", title: `Decide ${r.role} reassignment`, action: `Reason given: "${r.reason ?? "none"}". Approve or decline on the Overview tab.`, tab: "overview", since: r.created_at, urgent: older(r.created_at, 1, i.now) });
  for (const p of i.partnerEnquiries) push(null, { key: `penq:${p.id}`, category: "Partners", title: `Contact new partner enquiry${p.name ? ` – ${p.name}` : ""}`, action: `${p.kind ?? "Partner"} enquiry. Contact them, then set the status on Partner applications.`, tab: null, since: p.created_at, urgent: older(p.created_at, 2, i.now) });

  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.since ?? "").localeCompare(b.since ?? ""));
}
