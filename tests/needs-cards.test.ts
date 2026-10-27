// Needs me grouped by kind (Jo 26 Oct 2026). Pure: regroups decided rows only. Run: bun test tests/needs-cards.test.ts
import { describe, expect, test } from "bun:test";
import { NEEDS_CARD_TITLE, bulkMatchable, cardOf, confidentGuess, needsCards, needsHeadline, systemFoldLabel, unavailableNote } from "../src/lib/needs-cards.core";
import type { NeedsKind, NeedsRow } from "../src/lib/office-needs.core";

const row = (key: string, kind: NeedsKind, since = "2026-10-25T00:00:00Z"): NeedsRow => ({
  key, kind, group: "today", jobId: key, jobNumber: key, surname: "S", suburb: null, line: kind, since, button: { label: "Open job", to: "job" },
});

describe("needs me cards", () => {
  test("cards follow their most urgent row; rows keep their order inside a card", () => {
    const cards = needsCards([row("a", "choose_again"), row("b", "email_unmatched"), row("c", "choose_again"), row("d", "quote_check"), row("e", "email_change")]);
    expect(cards.map((c) => c.id)).toEqual(["offers", "unmatched", "quotes", "emails"]);
    expect(cards[0]!.rows.map((r) => r.key)).toEqual(["a", "c"]);
    expect(cards[1]!.rows.map((r) => r.key)).toEqual(["b"]);
    expect(cards[3]!.rows.map((r) => r.key)).toEqual(["e"]);
  });
  test("no row is dropped or added", () => {
    const rows = [row("a", "send_failed"), row("b", "robot_failed"), row("c", "payment_overdue"), row("d", "final_check")];
    expect(needsCards(rows).flatMap((c) => c.rows)).toHaveLength(rows.length);
  });
  test("oldest age per card", () => {
    const [c] = needsCards([row("a", "quote_check", "2026-10-25T00:00:00Z"), row("b", "fixes_quote_check", "2026-10-20T00:00:00Z")]);
    expect(c!.oldestSince).toBe("2026-10-20T00:00:00Z");
  });
  test("every kind has a named card", () => {
    const kinds: NeedsKind[] = ["choose_again", "quote_check", "fixes_quote_check", "sign_consent", "esc_window", "final_check", "send_failed", "email_change", "email_unmatched", "robot_failed", "piisa_form_failed", "choose_electrician", "veec_a_held", "piesa_owner_unsigned", "piesa_fixes_owner_unsigned", "fixes_times_missing", "payment_not_in_xero", "payment_overdue", "ten_days_left", "second_no_access", "veec_day_10", "lapsed_window", "release_lapsed", "piesa_form_failed", "prestart_failed"];
    for (const k of kinds) expect(cardOf(k)).not.toBe("other");
    expect(NEEDS_CARD_TITLE.other).toBe("Other");
  });
});

describe("needs me headline", () => {
  test("spots waiting for an installer are named apart, not counted as needing you", () => {
    expect(needsHeadline(40, 325)).toBe("40 need you today · 325 spots waiting for an installer");
    expect(needsHeadline(1, 1)).toBe("1 needs you today · 1 spot waiting for an installer");
    expect(needsHeadline(0, 0)).toBe("Nothing needs you today");
  });
});

describe("match all best guesses", () => {
  const email = (key: string, jobId: string | null, why: string[]): NeedsRow => ({ ...row(key, "email_unmatched"), jobId, guessWhy: why });
  test("only specific reasons count: HV number, address or full owner name", () => {
    expect(confidentGuess(email("a", "j", ["mentions HV-3117"]))).toBe(true);
    expect(confidentGuess(email("b", "j", ["address 12 Smith St"]))).toBe(true);
    expect(confidentGuess(email("c", "j", ["owner name Wayne Materazzo"]))).toBe(true);
    expect(confidentGuess(email("d", "j", ["surname kirby", "postcode 3132"]))).toBe(false);
    expect(confidentGuess(email("e", null, ["mentions HV-1"]))).toBe(false);
    expect(confidentGuess({ ...row("f", "email_change"), guessWhy: ["mentions HV-1"] })).toBe(false);
  });
  test("bulkMatchable keeps order and drops the rest", () => {
    const rows = [email("a", "j1", ["mentions HV-1"]), email("b", "j2", ["suburb Croydon"]), row("c", "quote_check"), email("d", "j3", ["owner name A B"])];
    expect(bulkMatchable(rows).map((r) => r.key)).toEqual(["a", "d"]);
  });
});

describe("emails card says what it counts (Enquiries' \"Emails to match\" counts the unmatched ones)", () => {
  test("owner emails on a job and unmatched emails are never one card under one name", () => {
    expect(NEEDS_CARD_TITLE[cardOf("email_change")]).toBe("Owner emails to act on");
    expect(cardOf("email_unmatched")).not.toBe(cardOf("email_change"));
    expect(NEEDS_CARD_TITLE[cardOf("email_unmatched")]).toBe("Emails not matched to a job");
    expect(Object.values(NEEDS_CARD_TITLE)).not.toContain("Emails to sort");
  });
});

describe("partner & system fold count", () => {
  const ok = (count: number) => ({ status: "success" as const, count });
  test("no number until every part is known (never a number that changes on opening)", () => {
    expect(systemFoldLabel([ok(3), { status: "pending", count: 0 }, ok(0)])).toBe("… partner & system items");
  });
  test("all known: the full total, Mitti included", () => {
    expect(systemFoldLabel([ok(3), ok(2), ok(1)])).toBe("6 partner & system items");
    expect(systemFoldLabel([ok(1), ok(0), ok(0)])).toBe("1 partner & system item");
    expect(systemFoldLabel([ok(0), ok(0), ok(0)])).toBe("0 partner & system items");
  });
  test("a part that failed is said, never counted as nothing", () => {
    expect(systemFoldLabel([ok(3), { status: "error", count: 0 }, ok(1)])).toBe("At least 4 partner & system items · some couldn't be checked");
  });
});

describe("parts of Needs me that failed to load", () => {
  test("named, with a plain warning; nothing when all loaded", () => {
    expect(unavailableNote(undefined)).toBeNull();
    expect(unavailableNote([])).toBeNull();
    expect(unavailableNote(["install deposits"])).toBe("Some checks couldn't load: install deposits. This does NOT mean nothing needs you there.");
  });
});
