export type LaterReadyCheck = { startsAt: string; area?: number; method?: string; notes?: string };
export function laterReadyCheckProblems(x: LaterReadyCheck): string[] {
  const problems: string[] = [];
  if (!x.startsAt || !Number.isFinite(Date.parse(x.startsAt))) problems.push("Enter the booked Ready Check date and time");
  if (x.area !== undefined && (!Number.isFinite(x.area) || x.area <= 0 || x.area > 5000)) problems.push("Enter a valid ceiling area (m²)");
  if (x.area !== undefined && !x.method?.trim()) problems.push("Tell us how the ceiling area was measured");
  return problems;
}