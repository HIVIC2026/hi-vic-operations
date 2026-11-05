export function electricianAllocationMessage(reason: string, name?: string | null): string {
  if (/needs a Mitti email/i.test(reason)) return `${name || "This electrician"} — add their email on the Team page first.`;
  if (/not found in Mitti|add this electrician in Mitti/i.test(reason)) return `${name || "This electrician"} isn't set up in Mitti yet. Check their details on the Team page.`;
  return `The electrician couldn't be put on the job: ${reason || "the allocation could not be confirmed"}. Your choice is saved.`;
}