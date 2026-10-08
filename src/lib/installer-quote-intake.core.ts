export function quotedIntakeProblems(x: { quoted: string | null | undefined; area: unknown; method: unknown; amount: unknown; includes: unknown }): string[] {
  if (x.quoted !== "yes") return [];
  const out: string[] = [];
  const area = Number(x.area), amount = Number(x.amount);
  if (!Number.isFinite(area) || area <= 0 || area > 5000) out.push("Enter the ceiling area (m²)");
  if (typeof x.method !== "string" || !x.method.trim()) out.push("Tell us how the ceiling area was measured");
  if (!Number.isFinite(amount) || amount <= 0) out.push("Enter the quote amount inc GST");
  if (typeof x.includes !== "string" || !x.includes.trim()) out.push("Tell us what the quote includes");
  return out;
}