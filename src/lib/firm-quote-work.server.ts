/** Dedicated post-intake branch. No initial Gate 1 processing, estimate email routing or owner delivery. */
export async function processFirmQuoteSizeCheck(jobId: string) {
  const { runPropertyIntelligence } = await import("./intelligence.server");
  const result = await runPropertyIntelligence(jobId, null, "firm quote requested");
  if (!result || result.status === "error") throw new Error("Firm quote size check could not be completed.");
}