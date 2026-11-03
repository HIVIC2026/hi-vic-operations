import { beforeEach, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { photoVerdictFrom, PHOTO_CHECK_PROMPT } from "../src/lib/photo-check.core";

// ---- in-memory database + storage; the AI gateway stubbed ----
const tables: Tables = {};
const db = memoryPostgrest(tables);
const stored = new Map<string, Uint8Array>();
mock.module("../src/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => db.from(t),
    storage: {
      from: () => ({
        download: async (p: string) =>
          stored.has(p)
            ? { data: new Blob([stored.get(p)!]), error: null }
            : { data: null, error: { message: "not found" } },
      }),
    },
  },
}));
type AiArgs = { messages: { content: { type: string; mediaType?: string }[] }[] };
const ai = {
  calls: [] as AiArgs[],
  reply: "" as string | Error,
  hang: false,
  baseURL: [] as string[],
  model: [] as string[],
};
mock.module("@ai-sdk/openai", () => ({
  createOpenAI: (o: { baseURL: string }) => {
    ai.baseURL.push(o.baseURL);
    return {
      responses: (m: string) => {
        ai.model.push(m);
        return { modelId: m };
      },
    };
  },
}));
mock.module("ai", () => ({
  streamText: (args: AiArgs) => {
    ai.calls.push(args);
    const r = ai.reply,
      hang = ai.hang;
    return {
      get text() {
        return hang
          ? new Promise<string>(() => undefined)
          : r instanceof Error
            ? Promise.reject(r)
            : Promise.resolve(r);
      },
    };
  },
}));
const server = await import("../src/lib/photo-check.server");
const { checkOwnerMedia, photoCheckTick, photoCheckSettings, clearPhotoCheckBackoff } = server;

const MB = 1024 * 1024;
const doc = (id: string, at: string, mime = "image/jpeg", size = 2 * MB) => ({
  id,
  job_id: "a",
  kind: "intake_media",
  storage_path: `a/capture/${id}`,
  mime_type: mime,
  size_bytes: size,
  created_at: at,
});
const setup = () => {
  for (const k of Object.keys(tables)) delete tables[k];
  stored.clear();
  Object.assign(tables, {
    jobs: [
      {
        id: "a",
        property_id: "pa",
        source: "real",
        stage: "ready_check_ready_to_schedule",
        deleted_at: null,
        qa_archived_at: null,
      },
    ],
    lead_campaign_responses: [
      {
        id: "r1",
        job_id: "a",
        spot_saved_at: "2026-11-01T00:00:00Z",
        opted_out_at: null,
        media_received_at: "2026-11-02T00:00:00Z",
        desk_check_status: "pending",
        desk_check_reason: null,
      },
    ],
    documents: [doc("d1", "2026-11-02T00:00:00Z")],
    property_facts: [],
    workflow_events: [],
  });
  for (const d of tables.documents!) stored.set(String(d.storage_path), new Uint8Array([1, 2, 3]));
};
beforeEach(() => {
  clearPhotoCheckBackoff();
  setup();
  ai.calls = [];
  ai.reply = '{"verdict":"under_r2","reason":"Thin loose-fill between joists"}';
  ai.hang = false;
  ai.baseURL = [];
  ai.model = [];
  photoCheckSettings.aiTimeoutMs = 40_000;
  process.env.LOVABLE_API_KEY = "k";
});
const current = () =>
  tables.property_facts!.filter((f) => f.fact_key === "ai_photo_check" && f.is_current);
const events = (t: string) => tables.workflow_events!.filter((e) => e.event_type === t);

test("photoVerdictFrom reads each verdict and gives cant_tell for junk", () => {
  for (const v of ["none", "under_r2", "over_r2", "cant_tell"] as const)
    expect(photoVerdictFrom(`{"verdict":"${v}","reason":"r"}`)).toEqual({
      verdict: v,
      reason: "r",
    });
  expect(photoVerdictFrom('```json\n{"verdict":"none","reason":"Bare joists"}\n```').verdict).toBe(
    "none",
  );
  expect(photoVerdictFrom("looks thin to me").verdict).toBe("cant_tell");
  expect(photoVerdictFrom('{"verdict":"maybe","reason":"x"}').verdict).toBe("cant_tell");
  expect(photoVerdictFrom("").verdict).toBe("cant_tell");
  expect(
    photoVerdictFrom(`{"verdict":"none","reason":"${"x".repeat(300)}"}`).reason.length,
  ).toBeLessThanOrEqual(120);
  expect(PHOTO_CHECK_PROMPT).toContain(
    "loose-fill, thin, patchy, sparse or perished counts as under_r2",
  );
});

test("a real job: images go to the gateway, one current fact, one internal event, nothing else touched", async () => {
  const before = JSON.stringify({ j: tables.jobs, r: tables.lead_campaign_responses });
  expect(await checkOwnerMedia("a")).toBe("done");
  expect(ai.baseURL).toEqual(["https://ai.gateway.lovable.dev/v1"]);
  expect(ai.model).toEqual(["openai/gpt-6-astra"]);
  const f = current();
  expect(f).toHaveLength(1);
  expect(f[0]).toMatchObject({ source_type: "ai", job_id: "a", property_id: "pa" });
  expect(f[0]!.value).toMatchObject({
    verdict: "under_r2",
    reason: "Thin loose-fill between joists",
    document_ids: ["d1"],
  });
  expect(events("ai_photo_checked").filter((e) => e.internal)).toHaveLength(1);
  expect(JSON.stringify({ j: tables.jobs, r: tables.lead_campaign_responses })).toBe(before);
});

test("TEST job writes the stub verdict and never calls the gateway", async () => {
  tables.jobs![0]!.source = "qa_test";
  expect(await checkOwnerMedia("a")).toBe("done");
  expect(ai.calls).toHaveLength(0);
  expect((current()[0]!.value as { verdict: string }).verdict).toBe("under_r2");
});

test("gateway time-out → failed, no fact, a failed event, no throw", async () => {
  ai.hang = true;
  photoCheckSettings.aiTimeoutMs = 30;
  expect(await checkOwnerMedia("a")).toBe("failed");
  expect(current()).toHaveLength(0);
  expect(events("ai_photo_checked")).toHaveLength(0);
  expect(events("ai_photo_check_failed")).toHaveLength(1);
});

test("desk check row is unchanged after a run", async () => {
  ai.reply = '{"verdict":"over_r2","reason":"Thick batts"}';
  await checkOwnerMedia("a");
  expect(tables.lead_campaign_responses![0]).toMatchObject({
    desk_check_status: "pending",
    desk_check_reason: null,
  });
});

test("re-run with no newer media is skipped; newer media checks again and supersedes", async () => {
  expect(await checkOwnerMedia("a")).toBe("done");
  expect(await checkOwnerMedia("a")).toBe("skipped");
  expect(ai.calls).toHaveLength(1);
  const later = doc("d2", new Date(Date.now() + 60_000).toISOString());
  tables.documents!.push(later);
  stored.set(later.storage_path, new Uint8Array([4]));
  expect(await checkOwnerMedia("a")).toBe("done");
  expect(current()).toHaveLength(1);
  expect(tables.property_facts!.filter((f) => f.fact_key === "ai_photo_check")).toHaveLength(2);
});

test("only video → cant_tell with the check-yourself reason, no gateway call", async () => {
  tables.documents = [doc("v1", "2026-11-02T00:00:00Z", "video/mp4", 30 * MB)];
  expect(await checkOwnerMedia("a")).toBe("done");
  expect(ai.calls).toHaveLength(0);
  expect(current()[0]!.value).toMatchObject({
    verdict: "cant_tell",
    reason: "Only video uploaded — check it yourself",
  });
});

test("sends at most the 4 most recent images under 10 MB, never videos", async () => {
  tables.documents = [
    doc("i1", "2026-11-01T01:00:00Z"),
    doc("i2", "2026-11-01T02:00:00Z"),
    doc("i3", "2026-11-01T03:00:00Z"),
    doc("i4", "2026-11-01T04:00:00Z"),
    doc("i5", "2026-11-01T05:00:00Z"),
    doc("big", "2026-11-01T06:00:00Z", "image/jpeg", 12 * MB),
    doc("v", "2026-11-01T07:00:00Z", "video/mp4", 30 * MB),
  ];
  for (const d of tables.documents) stored.set(String(d.storage_path), new Uint8Array([1]));
  expect(await checkOwnerMedia("a")).toBe("done");
  const parts = ai.calls[0]!.messages[0]!.content.filter((c) => c.type === "file");
  expect(parts).toHaveLength(4);
  expect(parts.every((p) => p.mediaType === "image/jpeg")).toBe(true);
  expect(current()[0]!.value).toMatchObject({ document_ids: ["i5", "i4", "i3", "i2"] });
});

test("tick: picks saved spots with media and no current check, skips TEST and recent failures", async () => {
  expect(await photoCheckTick({ limit: 2 })).toEqual({ done: 1, failed: 0 });
  expect(await photoCheckTick({ limit: 2 })).toEqual({ done: 0, failed: 0 });
  setup();
  tables.jobs![0]!.source = "qa_test";
  expect(await photoCheckTick({ limit: 2 })).toEqual({ done: 0, failed: 0 });
  setup();
  tables.workflow_events!.push({
    id: "f",
    job_id: "a",
    event_type: "ai_photo_check_failed",
    created_at: new Date(Date.now() - 3600_000).toISOString(),
  });
  expect(await photoCheckTick({ limit: 2 })).toEqual({ done: 0, failed: 0 });
  tables.workflow_events![0]!.created_at = new Date(Date.now() - 25 * 3600_000).toISOString();
  expect(await photoCheckTick({ limit: 2 })).toEqual({ done: 1, failed: 0 });
});

test("tick stops for the day after 100 checks since Melbourne midnight", async () => {
  const now = new Date().toISOString();
  for (let i = 0; i < 100; i++)
    tables.workflow_events!.push({
      id: "x" + i,
      job_id: "z" + i,
      event_type: "ai_photo_checked",
      created_at: now,
    });
  expect(await photoCheckTick({ limit: 2 })).toEqual({ done: 0, failed: 0 });
  expect(ai.calls).toHaveLength(0);
  tables.workflow_events = tables.workflow_events!.map((e) => ({
    ...e,
    created_at: new Date(Date.now() - 2 * 24 * 3600_000).toISOString(),
  }));
  expect(await photoCheckTick({ limit: 2 })).toEqual({ done: 1, failed: 0 });
});

test("a database failure never throws", async () => {
  const ev = tables.workflow_events!;
  (ev as unknown as { push: () => never }).push = () => {
    throw new Error("db down");
  };
  ai.reply = new Error("gateway 500");
  expect(await checkOwnerMedia("a")).toBe("failed");
});
