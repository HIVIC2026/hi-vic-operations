import { expect, test } from "bun:test";
import { partitionNeeds, needsSection, systemSection, deadlineDisplay } from "../src/lib/needs-sections.core";
import type { NeedsKind, NeedsRow } from "../src/lib/office-needs.core";
const now = Date.parse("2026-11-05T08:42:00Z");
const row = (kind: NeedsKind, line = "Waiting"): NeedsRow => ({ key: kind, kind, line, group: "today", jobId: "test", jobNumber: "HV-TEST", surname: "Test", suburb: null, since: "2026-11-01", button: { to: "job", label: "Open job" } });
test("five sections partition all existing items once without losing actions", () => {
  const rows = [row("esc_window"), row("quote_check"), row("in_house_handed_back"), row("choose_installer"), row("send_failed"), row("email_change"), row("payment_not_in_xero")];
  const sections = partitionNeeds(rows, [], now);
  expect(sections.map(s => s.key)).toEqual(["deadlines", "quotes", "partners", "installers", "forms"]);
  expect(sections.flatMap(s => s.rows).length).toBe(7);
  expect(sections.flatMap(s => s.rows).every(r => rows.includes(r))).toBe(true);
});
test("five and ten business day booking alerts, ESC, prestart and certificate belong to deadlines", () => {
  for (const kind of ["in_house_ready_check_not_booked", "in_house_piesa_overdue", "esc_window", "prestart_failed", "certificate_not_in"] as NeedsKind[]) expect(needsSection(row(kind), now)).toBe("deadlines");
});
test("undated owner replies and money stay in quote review; overdue money remains a deadline", () => {
  expect(needsSection(row("email_change"), now)).toBe("quotes");
  expect(needsSection(row("payment_not_in_xero"), now)).toBe("quotes");
  expect(needsSection(row("payment_overdue"), now)).toBe("deadlines");
});
test("Team approvals, applications, invites and ESC registrations stay visible with partners; failed forms go last", () => {
  for (const tag of ["Person", "Application", "Partner", "Mitti"]) expect(systemSection({ key: "approval", tag, who: "TEST", line: "Waiting for approval", since: null, button: "Review", href: "/admin/partners" })).toBe("partners");
  expect(systemSection({ key: "sync:test", tag: "Mitti", who: "TEST", line: "Sync problem", since: null, button: "Open", href: "/admin/jobs" })).toBe("forms");
});
test("prestart display retains blocker and identifies DON'T START without inventing a due date", () => {
  expect(deadlineDisplay(row("prestart_failed", "Pre-start check failed · signature missing"), now)).toBe("DON'T START · Pre-start check failed · signature missing · waiting 4 days");
});