export function melbourneDateTimeLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(d);
}
