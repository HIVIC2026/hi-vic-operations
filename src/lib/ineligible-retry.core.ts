export type IneligibleRetryRecord = { job_id: string; purpose: string; status: string; idempotency_key: string };
export async function retryFailedIneligible(jobId: string, deps: {
  read: () => Promise<IneligibleRetryRecord | null>;
  send: (jobId: string) => Promise<{ sent: boolean; reason?: string }>;
}): Promise<{ outcome: "sent" | "blocked"; detail: string }> {
  const row = await deps.read();
  if (!row || row.job_id !== jobId || row.purpose !== "preliminary_ineligible" || row.status !== "failed" || row.idempotency_key !== `preliminary_ineligible:${jobId}`)
    return { outcome: "blocked", detail: "No matching failed ineligible send." };
  const result = await deps.send(jobId);
  return result.sent ? { outcome: "sent", detail: "Email accepted for sending." }
    : { outcome: "blocked", detail: result.reason ?? "Delivery blocked." };
}
