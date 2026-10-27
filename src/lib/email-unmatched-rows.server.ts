// Jo 26 Oct 2026: emails that can't be matched to a job show on Enquiries ("Emails to match") for Jo to match.
// Same rows, best guess and Match / Not a customer actions as before (decision 247), read-only here.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { emailRow, type NeedsRow } from "./office-needs.core";
import { openEmailItems } from "./email-office.server";

type Guess = { job_id: string; job_number: string; why?: string[] };
const surnameOf = (full: string | null | undefined) => (full ?? "").trim().split(/\s+/).slice(-1)[0] ?? "";

export async function unmatchedEmailRows(): Promise<NeedsRow[]> {
  const items = await openEmailItems();
  const unmatched = items.unmatched as unknown as ({ eventId: string; at: string; from?: string | null; subject?: string | null; guesses?: Guess[] })[];
  const ids = [...new Set(unmatched.map((u) => u.guesses?.[0]?.job_id).filter((x): x is string => !!x))];
  const jobs = new Map<string, { jobNumber: string; surname: string; suburb: string | null }>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin.from("jobs").select("id, job_number, owners(full_name), properties(suburb)").in("id", ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as unknown as { id: string; job_number: string; owners: { full_name?: string } | null; properties: { suburb?: string } | null }[])
      jobs.set(r.id, { jobNumber: r.job_number, surname: surnameOf(r.owners?.full_name), suburb: r.properties?.suburb ?? null });
  }
  return unmatched.map((u) => {
    const g = u.guesses?.[0] ?? null;
    const j = g ? jobs.get(g.job_id) : undefined;
    return emailRow({ type: "unmatched", eventId: u.eventId, guessJobId: g?.job_id ?? null, guessWhy: g?.why ?? [], jobNumber: j?.jobNumber ?? g?.job_number ?? null, surname: j?.surname ?? "", suburb: j?.suburb ?? null,
      line: `Email from ${u.from ?? "an unknown sender"}${u.subject ? ` · “${String(u.subject).slice(0, 60)}”` : ""}${g ? ` · best guess ${g.job_number}${g.why?.length ? ` (${g.why[0]})` : ""}` : " · no guess"}`, at: u.at });
  }).sort((a, b) => b.since.localeCompare(a.since));
}
