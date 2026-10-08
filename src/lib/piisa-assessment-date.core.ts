/** Expected completion is the captured PIISA assessment/signing day, not actual work completion. */
export function piisaAssessmentDay(capturedAt: string | null): string | null {
  if (!capturedAt || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(capturedAt)) return null;
  const instant = new Date(capturedAt);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}