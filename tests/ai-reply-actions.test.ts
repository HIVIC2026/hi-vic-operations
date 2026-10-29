// AI replies step 2 task 5: R6/R7 prices in the AI's facts, and the AI's proposed actions (a note for the installer,
// a new ceiling size) — shown ticked under the reply, applied only after Jo's Send goes. Own file: mocks modules.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

type Row = Record<string, any>;
let tables: Record<string, Row[]> = {};
let n = 0;
function from(table: string) {
  const f: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "update" = "select", payload: Row = {}, one = false;
  let order: { c: string; asc: boolean } | null = null;
  const rows = () => (tables[table] ??= []);
  const get = (r: Row, c: string) => (c.includes("->>") ? r[c.split("->>")[0]!]?.[c.split("->>")[1]!] : r[c]);
  const run = () => {
    if (op === "insert") { const row = { id: `${table}${++n}`, created_at: `2026-10-29T00:00:${String(n).padStart(2, "0")}Z`, ...payload }; rows().push(row); return { data: { id: row.id }, error: null }; }
    let hit = rows().filter((r) => f.every((x) => x(r)));
    if (op === "update") { for (const r of hit) Object.assign(r, payload); return { data: null, error: null }; }
    if (order) { const o = order; hit = [...hit].sort((a, b) => (String(a[o.c]) < String(b[o.c]) ? -1 : 1) * (o.asc ? 1 : -1)); }
    return { data: one ? hit[0] ?? null : hit, error: null };
  };
  const b: Record<string, any> = {
    select: () => b, limit: () => b, neq: () => b,
    order: (c: string, o?: { ascending?: boolean }) => { order = { c, asc: o?.ascending !== false }; return b; },
    insert: (p: Row) => { op = "insert"; payload = p; return b; },
    update: (p: Row) => { op = "update"; payload = p; return b; },
    single: () => { one = true; return b; },
    eq: (c: string, v: unknown) => { f.push((r) => get(r, c) === v); return b; },
    in: (c: string, v: unknown[]) => { f.push((r) => v.includes(get(r, c))); return b; },
    contains: (c: string, v: Row) => { f.push((r) => Object.entries(v).every(([k, x]) => r[c]?.[k] === x)); return b; },
    maybeSingle: () => { one = true; return b; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
let guardResult = "sent";
mock.module("../src/lib/owner-email-send.server", () => ({ sendGuardedOwnerEmail: async () => guardResult }));
mock.module("../src/lib/outlook-sync.server", () => ({ archiveOutlookMessage: async () => undefined }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => {}, customerCommsEnabled: async () => true }));
mock.module("../src/lib/spot-release.server", () => ({ spotReleaseStates: async (ids: string[]) => new Map(ids.map((i) => [i, { state: "confirmed" }])) }));
afterAll(() => mock.restore());

const core = await import("../src/lib/ai-email-reply.core");
const { higherRFacts, splitAiOutput, draftActions, aiReplyInstructions, AI_REPLY_INSTRUCTIONS, newSizeFacts, cleanActions } = core;
const { sendAiDraft, installerNotes } = await import("../src/lib/ai-email-reply.server");
const { readyCheckBookedInstallerText } = await import("../src/lib/installer-texts.core");
const { readyCheckOfferText } = await import("../src/lib/ready-check-times.core");

describe("R6/R7 prices", () => {
  test("Mohamed: 90 m², $3,398 before, $840 rebate, R5 $30/m²", () => {
    const lines = higherRFacts(90, { before: 3398, rebate: 840 }, 30);
    expect(lines.find((l) => l.startsWith("R7.0"))).toContain("R7.0 for 90 m²: $3,008 after the $840 rebate ($3,848 before)");
    expect(lines.find((l) => l.startsWith("R6.0"))).toContain("R6.0 for 90 m²: $2,828 after the $840 rebate ($3,668 before)");
    expect(lines).toHaveLength(2);
  });
  test("a new size gets its own R5 line and R6/R7 lines", () => {
    const lines = newSizeFacts(90, { before: 3398, rebate: 840, after: 2558 }, 30);
    expect(lines[0]).toContain("90 m²");
    expect(lines[0]).toContain("$2,558 after the $840 rebate ($3,398 before)");
    expect(lines.some((l) => l.includes("R7.0 for 90 m²: $3,008"))).toBe(true);
  });
});

describe("ACTIONS line", () => {
  const body = "Hi Mohamed,\n\nThanks for that.";
  test("parsed into actions and never kept in the body", () => {
    const o = splitAiOutput(`${body}\nACTIONS: {"installer_note":"Owner wants R7.0 (asked by email 29 Oct)","new_area_m2":90}`);
    expect(o.body).toBe(body);
    expect(o.actions).toEqual({ installerNote: "Owner wants R7.0 (asked by email 29 Oct)", newAreaM2: 90 });
  });
  test("malformed JSON → no actions, body still there", () => {
    for (const bad of ["ACTIONS: {installer_note: nope", "ACTIONS: [1,2]", "ACTIONS: null", "ACTIONS:", 'ACTIONS: {"installer_note": 5}']) {
      const o = splitAiOutput(`${body}\n${bad}`);
      expect(o.actions).toEqual({});
      expect(o.body).toBe(body);
    }
  });
  test("area 5 / 5000 / 90.5 / '90' / 0 → no area action", () => {
    for (const a of ["5", "5000", "90.5", '"90"', "0", "-90"]) expect(splitAiOutput(`${body}\nACTIONS: {"new_area_m2":${a}}`).actions).toEqual({});
    expect(splitAiOutput(`${body}\nACTIONS: {"new_area_m2":10}`).actions).toEqual({ newAreaM2: 10 });
    expect(splitAiOutput(`${body}\nACTIONS: {"new_area_m2":1000}`).actions).toEqual({ newAreaM2: 1000 });
  });
  test("note trimmed, 1–200 chars", () => {
    expect(splitAiOutput(`${body}\nACTIONS: {"installer_note":"  R7  "}`).actions).toEqual({ installerNote: "R7" });
    expect(splitAiOutput(`${body}\nACTIONS: {"installer_note":"   "}`).actions).toEqual({});
    expect(splitAiOutput(`${body}\nACTIONS: {"installer_note":"${"x".repeat(201)}"}`).actions).toEqual({});
    expect(splitAiOutput(`${body}\nACTIONS: {"installer_note":"${"x".repeat(200)}"}`).actions.installerNote).toHaveLength(200);
  });
  test("draftActions reads saved details safely", () => {
    expect(draftActions({ actions: { installerNote: "R7", newAreaM2: 90 } })).toEqual({ installerNote: "R7", newAreaM2: 90 });
    expect(draftActions({ actions: { installerNote: 3, newAreaM2: 5 } })).toEqual({});
    expect(draftActions(null)).toEqual({});
  });
  test("both prompts ask for the ACTIONS line", () => {
    for (const p of [AI_REPLY_INSTRUCTIONS, aiReplyInstructions({ preRelease: true })]) {
      expect(p).toContain('ACTIONS: {"installer_note":');
      expect(p).toContain("new_area_m2");
    }
  });
});

const BODY = "Hi Mohamed,\n\nYes, R7.0 is $3,008 after the $840 rebate.\n\nCheers, the Home Insulation Victoria team";
const seed = (actions: Row = { installerNote: "Owner wants R7.0 (asked by email 29 Oct)", newAreaM2: 90 }) => {
  tables = {
    jobs: [{ id: "J", source: "website", owner_id: "O", channel: "hivic_sourced", stage: "ready_check_scheduled", estimated_area_m2: 120, estimated_area_unknown: true }],
    owners: [{ id: "O", email: "mo@example.com" }],
    workflow_events: [{ id: "D1", job_id: "J", event_type: "email_ai_draft", created_at: "2026-10-29T00:00:00Z", details: { message_id: "M1", to: "mo@example.com", subject: "Re: R7", body: BODY, actions } }],
  };
};
const events = (t: string) => (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === t);
beforeEach(() => { n = 0; guardResult = "sent"; });

describe("Send applies the ticked actions", () => {
  test("both ticked: note event written and ceiling size updated", async () => {
    seed();
    expect((await sendAiDraft("D1", BODY, "jo", { applyNote: true, applyArea: true })).status).toBe("sent");
    const note = events("installer_note");
    expect(note).toHaveLength(1);
    expect(note[0]!["internal"]).toBe(true);
    expect(note[0]!["details"]).toEqual({ note: "Owner wants R7.0 (asked by email 29 Oct)", source: "ai_reply", draft_event_id: "D1" });
    expect(tables["jobs"]![0]).toMatchObject({ estimated_area_m2: 90, estimated_area_unknown: false });
    expect(events("ceiling_size_updated_from_email")).toHaveLength(1);
    expect(events("ceiling_size_updated_from_email")[0]!["details"]).toMatchObject({ area_m2: 90, previous_area_m2: 120, draft_event_id: "D1" });
  });
  test("delivery uncertain counts as sent", async () => {
    seed(); guardResult = "delivery uncertain — not retried";
    await sendAiDraft("D1", BODY, "jo", { applyNote: true, applyArea: true });
    expect(events("installer_note")).toHaveLength(1);
    expect(tables["jobs"]![0]!["estimated_area_m2"]).toBe(90);
  });
  test("unticked: nothing written", async () => {
    seed();
    expect((await sendAiDraft("D1", BODY, "jo", { applyNote: false, applyArea: false })).status).toBe("sent");
    expect(events("installer_note")).toHaveLength(0);
    expect(events("ceiling_size_updated_from_email")).toHaveLength(0);
    expect(tables["jobs"]![0]!["estimated_area_m2"]).toBe(120);
  });
  test("no options passed (older callers): nothing applied", async () => {
    seed();
    await sendAiDraft("D1", BODY, "jo");
    expect(events("installer_note")).toHaveLength(0);
    expect(tables["jobs"]![0]!["estimated_area_m2"]).toBe(120);
  });
  test("only the note ticked: note only", async () => {
    seed();
    await sendAiDraft("D1", BODY, "jo", { applyNote: true, applyArea: false });
    expect(events("installer_note")).toHaveLength(1);
    expect(tables["jobs"]![0]!["estimated_area_m2"]).toBe(120);
  });
  test("ticked but the draft proposed nothing: nothing written", async () => {
    seed({});
    await sendAiDraft("D1", BODY, "jo", { applyNote: true, applyArea: true });
    expect(events("installer_note")).toHaveLength(0);
    expect(tables["jobs"]![0]!["estimated_area_m2"]).toBe(120);
  });
  test("a bad saved action (area 5000) is never applied", async () => {
    seed({ newAreaM2: 5000 });
    await sendAiDraft("D1", BODY, "jo", { applyNote: true, applyArea: true });
    expect(tables["jobs"]![0]!["estimated_area_m2"]).toBe(120);
  });
  test("send fails: nothing applied", async () => {
    seed(); guardResult = "failed: Outlook couldn't send it";
    await expect(sendAiDraft("D1", BODY, "jo", { applyNote: true, applyArea: true })).rejects.toThrow();
    expect(events("installer_note")).toHaveLength(0);
    expect(tables["jobs"]![0]!["estimated_area_m2"]).toBe(120);
  });
  test("skipped send (opted out): nothing applied", async () => {
    seed(); guardResult = "skipped: owner opted out";
    await expect(sendAiDraft("D1", BODY, "jo", { applyNote: true, applyArea: true })).rejects.toThrow();
    expect(events("installer_note")).toHaveLength(0);
  });
  test("rewritten (blocked body): nothing applied", async () => {
    seed();
    const r = await sendAiDraft("D1", "Hi Mo,\n\nCall us on 0412 345 678.\n\nCheers, the Home Insulation Victoria team", "jo", { applyNote: true, applyArea: true });
    expect(r.status).toBe("rewritten");
    expect(events("installer_note")).toHaveLength(0);
    expect(events("ceiling_size_updated_from_email")).toHaveLength(0);
    expect(tables["jobs"]![0]!["estimated_area_m2"]).toBe(120);
  });
});

describe("installer sees the note", () => {
  test("installerNotes: newest first, AI-reply notes on this job only", async () => {
    tables = { workflow_events: [
      { id: "a", job_id: "J", event_type: "installer_note", created_at: "2026-10-29T01:00:00Z", details: { note: "old" } },
      { id: "b", job_id: "J", event_type: "installer_note", created_at: "2026-10-29T02:00:00Z", details: { note: "new" } },
      { id: "c", job_id: "K", event_type: "installer_note", created_at: "2026-10-29T03:00:00Z", details: { note: "other job" } },
      { id: "d", job_id: "J", event_type: "installer_note", created_at: "2026-10-29T04:00:00Z", details: { note: "  " } },
    ] };
    expect(await installerNotes("J")).toEqual(["new", "old"]);
  });
  test("Ready Check booked text adds the latest note (≤100 chars)", () => {
    const f = { startIso: "2026-10-27T22:00:00.000Z", address: "12 Smith St, Frankston", jobNumber: "HV-1", link: "https://x/field/J" };
    const plain = readyCheckBookedInstallerText(f);
    expect(readyCheckBookedInstallerText(f, [])).toBe(plain);
    const t = readyCheckBookedInstallerText(f, ["Owner wants R7.0", "older"]);
    expect(t.startsWith(plain)).toBe(true);
    expect(t).toContain("Note: Owner wants R7.0");
    expect(t).not.toContain("older");
    const long = readyCheckBookedInstallerText(f, ["y".repeat(180)]);
    expect(long.slice(plain.length).replace(/^\s*Note: /, "").length).toBeLessThanOrEqual(100);
  });
  test("fix 1-2: the pre-award offer text never carries a note (trades get details only once they accept)", () => {
    expect(readFileSync("src/lib/ready-check-times.core.ts", "utf8")).not.toContain("installerNoteSuffix");
    const t = readyCheckOfferText("Frankston", "https://x/field/offer/1", 120);
    expect(t).not.toContain("Note:");
  });
  test("only the booked (after award) sender passes the job's notes", () => {
    expect(readFileSync("src/lib/installer-texts.server.ts", "utf8")).toMatch(/readyCheckBookedInstallerText\([^;]*\}, notes\)/);
    const offer = readFileSync("src/lib/ready-check-offer-text.server.ts", "utf8");
    expect(offer).not.toContain("installerNotes(");
    expect(offer).not.toMatch(/readyCheckOfferText\([^;]*notes\)/);
  });
  test("installer job page lists the notes", () => {
    expect(readFileSync("src/lib/trade-view.server.ts", "utf8")).toContain("installerNotes(jobId)");
    const page = readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8");
    expect(page).toContain("(page.notes ?? [])");
    expect(page).toContain("Notes from the office");
  });
});

describe("screens", () => {
  test("both cards show the actions as ticked boxes and pass the ticks to Send", () => {
    const kit = readFileSync("src/components/portal/ai-needs-answer.tsx", "utf8");
    expect(kit).toContain("Add note for the installer: ");
    expect(kit).toContain("Update ceiling size to ");
    for (const f of ["src/components/portal/EmailsScreen.tsx", "src/components/portal/AiReplyDrafts.tsx"]) {
      const s = readFileSync(f, "utf8");
      expect(s).toContain("<ActionChecks");
      expect(s).toContain("applyNote");
      expect(s).toContain("applyArea");
    }
    expect(readFileSync("src/lib/emails-tab.server.ts", "utf8")).toMatch(/sendAiDraft\(draftEventId, body, actorId, apply\)/);
  });
});

// The owner gives a new size: the draft is written once more with prices for that size; the second pass's actions are kept.
describe("new size second pass", () => {
  test("first draft proposes 90 m² (saved 120) → AI asked twice, second input has 90 m² prices, actions saved", async () => {
    const { V25_LOCATIONS } = await import("../src/lib/activity48.core");
    tables = {
      jobs: [{ id: "J", job_number: "HV-9", stage: "ready_check_scheduled", owner_id: "O", deleted_at: null, channel: "hivic_sourced", estimated_area_m2: 120, properties: { postcode: "3000" } }],
      owners: [{ id: "O", full_name: "Mohamed A", email: "mo@example.com" }],
      lead_campaign_responses: [{ job_id: "J", spot_saved_at: "2026-10-20T00:00:00Z", saved_area_m2: 120, saved_total: 3000, saved_veu_discount: 1000, saved_gross_total: 4000, saved_insulation: null }],
      veu_location_variables: [V25_LOCATIONS.get("3000")!],
    };
    const inputs: string[] = [];
    const replies = [
      'Hi Mohamed,\n\nThanks.\nACTIONS: {"installer_note":"Owner wants R7.0","new_area_m2":90}',
      'Hi Mohamed,\n\nFor 90 m², R7.0 is the price in the facts.\nACTIONS: {"installer_note":"Owner wants R7.0 (90 m²)","new_area_m2":90}',
    ];
    mock.module("ai", () => ({ streamText: (o: { messages: { content: string }[] }) => { inputs.push(o.messages[0]!.content); return { text: Promise.resolve(replies[inputs.length - 1] ?? "") }; } }));
    mock.module("@ai-sdk/openai", () => ({ createOpenAI: () => ({ responses: () => ({}) }) }));
    mock.module("../src/lib/owner-email-auto-reply.server", () => ({ ownerJobFacts: async () => ({ spotSaved: true, questionsAnswered: false, nextVisit: null, quoteStatus: null, myJobLink: null, questionsLink: null }) }));
    mock.module("../src/lib/ai-answers.server", () => ({ loadAiAnswers: async () => ({ answers: null }) }));
    const settings = { id: "s", version: 1, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 10, piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349, access_standard_multiplier: 1, access_moderate_multiplier: 1, access_difficult_multiplier: 1, indicative_veec_value: 70, veec_value_source_label: "", veec_value_source_url: "", veec_value_checked_at: "", minimum_customer_copayment_inc_gst: 200, spec_version: "25", spec_source_url: "" };
    mock.module("../src/lib/estimate.server", () => ({ currentRetailSettings: async () => settings }));
    process.env["LOVABLE_API_KEY"] = "test";
    const { writeAiReplyDraft } = await import("../src/lib/ai-email-reply.server");
    const r = await writeAiReplyDraft({ jobId: "J", kind: "other", reason: "t", message: { direction: "inbound", providerMessageId: "M9", threadId: "T", from: "mo@example.com", subject: "R7", body: "My ceiling is 90 m². How much for R7?" } as never });
    expect(r).toBe("drafted");
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toContain("R7.0 for 120 m²");
    expect(inputs[0]).not.toContain("90 m² ceiling, R5.0");
    expect(inputs[1]).toContain("Price for the size they gave (90 m² ceiling, R5.0)");
    expect(inputs[1]).toContain("R7.0 for 90 m²");
    const d = events("email_ai_draft")[0]!;
    expect(d["details"]["actions"]).toEqual({ installerNote: "Owner wants R7.0 (90 m²)", newAreaM2: 90 });
    expect(d["details"]["body"]).toContain("For 90 m²");
    expect(d["details"]["body"]).not.toContain("ACTIONS");
  });
  test("same size as saved → one AI call only", async () => {
    const { V25_LOCATIONS } = await import("../src/lib/activity48.core");
    tables = {
      jobs: [{ id: "J", job_number: "HV-9", stage: "ready_check_scheduled", owner_id: "O", deleted_at: null, channel: "hivic_sourced", properties: { postcode: "3000" } }],
      owners: [{ id: "O", full_name: "Mohamed A", email: "mo@example.com" }],
      lead_campaign_responses: [{ job_id: "J", spot_saved_at: "2026-10-20T00:00:00Z", saved_area_m2: 90, saved_total: 2558, saved_veu_discount: 840, saved_gross_total: 3398, saved_insulation: null }],
      veu_location_variables: [V25_LOCATIONS.get("3000")!],
    };
    const inputs: string[] = [];
    mock.module("ai", () => ({ streamText: (o: { messages: { content: string }[] }) => { inputs.push(o.messages[0]!.content); return { text: Promise.resolve('Hi Mohamed,\n\nR7.0 is $3,008.\nACTIONS: {"new_area_m2":90}') }; } }));
    const { writeAiReplyDraft } = await import("../src/lib/ai-email-reply.server");
    expect(await writeAiReplyDraft({ jobId: "J", kind: "other", reason: "t", message: { direction: "inbound", providerMessageId: "M10", threadId: "T", from: "mo@example.com", subject: "R7", body: "90 m², R7?" } as never })).toBe("drafted");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toContain("R7.0 for 90 m²: $3,008 after the $840 rebate ($3,848 before)");
  });
});

describe("fix round 1: ACTIONS over several lines never reach the owner", () => {
  const body = "Hi Mohamed,\n\nThanks for that.";
  const clean = (b: string) => { expect(b).toBe(body); expect(b).not.toMatch(/ACTIONS|installer_note|new_area_m2|[{}]|```/); };
  test("multi-line JSON is stripped and parsed", () => {
    const o = splitAiOutput(`${body}\nACTIONS: {\n  "installer_note": "Owner wants R7.0",\n  "new_area_m2": 90\n}`);
    clean(o.body);
    expect(o.actions).toEqual({ installerNote: "Owner wants R7.0", newAreaM2: 90 });
  });
  test("fenced json block after ACTIONS: is stripped and parsed", () => {
    for (const raw of [`${body}\nACTIONS:\n\`\`\`json\n{"installer_note":"R7","new_area_m2":90}\n\`\`\``, `${body}\nACTIONS: \`\`\`json\n{\n"installer_note":"R7"\n}\n\`\`\``]) {
      const o = splitAiOutput(raw);
      clean(o.body);
      expect(o.actions.installerNote).toBe("R7");
    }
  });
  test("ACTIONS: on its own line followed by the JSON", () => {
    const o = splitAiOutput(`${body}\nACTIONS:\n{"new_area_m2":90}`);
    clean(o.body);
    expect(o.actions).toEqual({ newAreaM2: 90 });
  });
  test("unbalanced braces: no actions, still stripped to the end", () => {
    const o = splitAiOutput(`${body}\nACTIONS: {\n  "installer_note": "R7",\n  "new_area_m2": 90`);
    clean(o.body);
    expect(o.actions).toEqual({});
  });
  test("malformed multi-line JSON: no actions, still stripped", () => {
    const o = splitAiOutput(`${body}\nACTIONS: {\n  installer_note: R7\n}`);
    clean(o.body);
    expect(o.actions).toEqual({});
  });
  test("NEEDS_JO after a multi-line ACTIONS block still parsed", () => {
    const o = splitAiOutput(`${body}\nACTIONS: {\n"new_area_m2": 90\n}\nNEEDS_JO: solar?`);
    clean(o.body);
    expect(o.needsAnswer).toEqual(["solar?"]);
  });
});

describe("fix round 1: notes never carry owner details", () => {
  const body = "Hi Mohamed,\n\nThanks.";
  const note = (n: string, first?: string) => splitAiOutput(`${body}\nACTIONS: ${JSON.stringify({ installer_note: n })}`, { ownerFirstName: first }).actions.installerNote;
  test("email, 8+ digit run or the owner's first name → note dropped", () => {
    expect(note("Email mo@example.com first")).toBeUndefined();
    expect(note("Call 0412345678")).toBeUndefined();
    expect(note("Ask Mohamed about R7", "Mohamed")).toBeUndefined();
    expect(note("ask MOHAMED about R7", "Mohamed")).toBeUndefined();
  });
  test("ordinary notes kept (short numbers, name inside another word)", () => {
    expect(note("Owner wants R7.0 (asked 29 Oct), 90 m²", "Mohamed")).toBe("Owner wants R7.0 (asked 29 Oct), 90 m²");
    expect(note("Annex roof too", "Ann")).toBe("Annex roof too");
    expect(note("Owner wants R7.0")).toBe("Owner wants R7.0");
  });
  test("cleanActions takes the first name too", () => {
    expect(cleanActions({ installerNote: "Jo said R7" }, undefined, "Jo")).toEqual({});
  });
  test("the prompt says about the job only", () => {
    for (const p of [AI_REPLY_INSTRUCTIONS, aiReplyInstructions({ preRelease: true })]) expect(p).toContain("about the job only — never the owner's name, address, phone or email");
  });
  test("writeAiReplyDraft passes the owner's first name", () => {
    // Both passes (first draft and the new-size pass).
    expect((readFileSync("src/lib/ai-email-reply.server.ts", "utf8").match(/splitAiOutput\(await aiText\([^;]*\{ ownerFirstName \}\)/g) ?? []).length).toBe(2);
  });
});

describe("fix round 1: second pass keeps the first pass's flags and the priced size", () => {
  test("needs_you / needs_answer merged; area action dropped if it differs from the priced size", async () => {
    const { V25_LOCATIONS } = await import("../src/lib/activity48.core");
    tables = {
      jobs: [{ id: "J", job_number: "HV-9", stage: "ready_check_scheduled", owner_id: "O", deleted_at: null, channel: "hivic_sourced", properties: { postcode: "3000" } }],
      owners: [{ id: "O", full_name: "Mohamed A", email: "mo@example.com" }],
      lead_campaign_responses: [{ job_id: "J", spot_saved_at: "2026-10-20T00:00:00Z", saved_area_m2: 120, saved_total: 3000, saved_veu_discount: 1000, saved_gross_total: 4000, saved_insulation: null }],
      veu_location_variables: [V25_LOCATIONS.get("3000")!],
    };
    const replies = [
      'Hi Mohamed,\n\nThanks.\nNEEDS_YOU: complaint\nNEEDS_JO: solar?\nACTIONS: {"new_area_m2":90}',
      'Hi Mohamed,\n\nFor 90 m² it is the price.\nNEEDS_JO: payment plan?\nACTIONS: {"installer_note":"R7","new_area_m2":95}',
    ];
    let k = 0;
    mock.module("ai", () => ({ streamText: () => ({ text: Promise.resolve(replies[k++] ?? "") }) }));
    const { writeAiReplyDraft } = await import("../src/lib/ai-email-reply.server");
    expect(await writeAiReplyDraft({ jobId: "J", kind: "other", reason: "t", message: { direction: "inbound", providerMessageId: "M11", threadId: "T", from: "mo@example.com", subject: "R7", body: "90 m²" } as never })).toBe("drafted");
    const d = events("email_ai_draft").find((e) => e["details"]["message_id"] === "M11")!;
    expect(d["details"]["needs_you"]).toBe(true);
    expect(d["details"]["needs_answer"]).toEqual(["solar?", "payment plan?"]);
    expect(d["details"]["actions"]).toEqual({ installerNote: "R7" });
  });
});
