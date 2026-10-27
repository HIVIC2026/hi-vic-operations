// Probe the running preview before any job/provider mutation. Missing authorisation is a failed prerequisite,
// never replaced by an unsigned website POST (which could enter the real intake/error-log path).
export type Probe = { step: string; status: "pass" | "fail" | "blocked"; detail: string };
export async function probeRunningPreview(base: string, signedPassAvailable: boolean): Promise<Probe[]> {
  let status: number;
  try {
    const response = await fetch(`${base}/api/public/enquiry`, { method: "GET", signal: AbortSignal.timeout(10_000) });
    status = response.status;
  } catch {
    return [{ step: "a: signed TEST website enquiry", status: "fail", detail: "The running preview enquiry endpoint could not be reached." }, ...blockedAfterIntake()];
  }
  return [{ step: "a: signed TEST website enquiry", status: "fail", detail: signedPassAvailable
    ? `Enquiry endpoint responded ${status}, but no implemented signed TEST-pass invocation is available; qa_test creation is not proven.`
    : `Enquiry endpoint responded ${status}; the current website handler has no signed TEST-pass path and the runner has no server-held pass. No enquiry submitted.` }, ...blockedAfterIntake()];
}
function blockedAfterIntake(): Probe[] {
  return ["b: job message held without sending", "c: job-bound Mitti simulator", "d: job Xero Demo Company (AU)"].map(step => ({ step, status: "blocked", detail: "Not probed: safeguard a failed before a run-owned qa_test job could be created." }));
}