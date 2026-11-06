// Installer redesign — Action items stop reasons (spec v2 §4.2): the first trade-safe pre-start problem for each
// confirmed install in the next 7 days. Read in parallel; one job's failed read never stops the screen loading.
import { prestartFacts } from "./prestart.server";
import { classifyPrestartFailures, prestartFailures } from "./prestart.core";
import { tradeSafeFailures } from "./go-email.core";

/** The pre-start problem lines for one install (office wording; made trade-safe below). */
type Read = (jobId: string, start: string) => Promise<string[]>;
const readLines: Read = async (jobId, start) => prestartFailures(await prestartFacts(jobId, start));
const WEEK_MS = 7 * 86_400_000;

export async function homeStops(jobs: { jobId: string; installAt: string | null }[], now: Date, read: Read = readLines): Promise<Map<string, string | null>> {
  const soon = jobs.filter((j) => { if (!j.installAt) return false; const t = new Date(j.installAt).getTime() - now.getTime(); return t > -12 * 3_600_000 && t <= WEEK_MS; });
  const out = new Map<string, string | null>();
  await Promise.all(soon.map(async (j) => {
    try {
      const lines = await read(j.jobId, j.installAt!);
      out.set(j.jobId, tradeSafeFailures(classifyPrestartFailures(lines, { start: j.installAt!, now }))[0]?.line ?? null);
    } catch { out.set(j.jobId, null); }
  }));
  return out;
}
