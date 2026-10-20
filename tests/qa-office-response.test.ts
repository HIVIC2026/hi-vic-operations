import { describe, expect, test } from "bun:test";
import { toCrossJSONAsync } from "seroval";
import { defaultSerovalDeserializerPlugins } from "@tanstack/router-core/ssr/server";
import { asJobList, asPipeline, decodeFnResponse, isAdminDenial, isOkWrite, requireRow } from "../scripts/qa-office-response";
import { resolveServerFns } from "../scripts/qa-serverfn-resolve";

const enc = async (v: unknown) => JSON.stringify(await toCrossJSONAsync(v, { refs: new Map() }));
const J = "application/json";

describe("QA server-function reply decoding", () => {
  test("HTTP 200 serialized error envelope is a function error, never a result or a pass", async () => {
    const d = decodeFnResponse(200, J, await enc({ error: new Error("Admin only."), result: undefined }));
    expect(d.kind).toBe("fn_error"); expect(isOkWrite(d)).toBe(false); expect(isAdminDenial(d)).toBe(true);
    const thrown = decodeFnResponse(200, J, await enc(new Error("boom")));
    expect(thrown).toMatchObject({ kind: "fn_error", message: "boom" });
  });
  test("framework-format thrown handler error (server plugin encoding) decodes to the admin refusal", async () => {
    class WorkflowError extends Error {}
    const t = JSON.stringify(await toCrossJSONAsync(new WorkflowError("Admin only."), { refs: new Map(), plugins: [...defaultSerovalDeserializerPlugins] as never }));
    expect(isAdminDenial(decodeFnResponse(500, J, t))).toBe(true);
  });
  test("only a decoded {ok:true} write counts", async () => {
    expect(isOkWrite(decodeFnResponse(200, J, await enc({ result: { ok: true } })))).toBe(true);
    expect(isOkWrite(decodeFnResponse(200, J, await enc({ result: { ok: false } })))).toBe(false);
    expect(isOkWrite(decodeFnResponse(200, J, await enc({ result: null })))).toBe(false);
  });
  test("HTML, redirect, non-JSON, undecodable and envelope-less replies are blocked", async () => {
    expect(decodeFnResponse(200, "text/html", "<!doctype html><p>sign in").kind).toBe("blocked");
    expect(decodeFnResponse(302, null, "").kind).toBe("blocked");
    expect(decodeFnResponse(200, J, "{not json").kind).toBe("blocked");
    expect(decodeFnResponse(200, J, JSON.stringify({ t: 999, weird: true })).kind).toBe("blocked");
    expect(decodeFnResponse(200, J, await enc({ nothing: 1 })).kind).toBe("blocked");
  });
  test("generic 500/403 are not admin-denial evidence", async () => {
    expect(isAdminDenial(decodeFnResponse(500, J, await enc(new Error("Internal error"))))).toBe(false);
    expect(isAdminDenial(decodeFnResponse(403, "text/plain", "Forbidden"))).toBe(false);
    expect(isAdminDenial(decodeFnResponse(500, J, await enc(new Error("Not Admin only for you"))))).toBe(false);
  });
  test("malformed pipeline/list results are rejected", () => {
    expect(asPipeline({ stages: [{ rows: [{ key: "a", label: "A", total: 1 }] }], ended: [], waitingList: [] })).not.toBeNull();
    expect(asPipeline({ stages: [{ rows: [{ key: "a", label: "A", total: "1" }] }], ended: [], waitingList: [] })).toBeNull();
    expect(asPipeline({ stages: [] })).toBeNull();
    expect(asJobList({ rows: [{ jobNumber: "HV-1", status: "x" }], total: 1 })).not.toBeNull();
    expect(asJobList({ rows: [{ jobNumber: 1 }], total: 1 })).toBeNull();
    expect(asJobList({ rows: [], total: -1 })).toBeNull();
  });
  test("DB read failure or missing TEST row throws (null===null can't prove unchanged)", () => {
    expect(() => requireRow({ data: null, error: { message: "timeout" } }, "TEST job")).toThrow(/read failed/);
    expect(() => requireRow({ data: null, error: null }, "TEST job")).toThrow(/missing/);
    expect(requireRow({ data: { id: 1 }, error: null }, "x")).toEqual({ id: 1 });
  });
});

describe("resolver rejects duplicate/mismatched IDs and records identity", () => {
  const F = "src/lib/office.functions.ts";
  const dev = (file: string, name: string, extra = "") => Buffer.from(JSON.stringify({ file: `/${file}?tss-serverfn-split${extra}`, export: `${name}_createServerFn_handler` })).toString("base64url");
  const res = (status: number, body: string) => ({ status, text: async () => body });
  test("one name served with two different IDs is rejected", async () => {
    const body = `createClientRpc("${dev(F, "deleteJob")}"); createClientRpc("${dev(F, "deleteJob", "&v=2")}")`;
    const r = await resolveServerFns("http://t", [{ file: F, name: "deleteJob" }], async (u) => u === `http://t/${F}` ? res(200, body) : res(404, ""));
    expect(r.ids).toEqual({}); expect(r.missing).toEqual([`${F}#deleteJob`]); expect(r.conflicts.length).toBe(1);
  });
  test("a mismatched file in the served module is ignored -> missing", async () => {
    const r = await resolveServerFns("http://t", [{ file: F, name: "restoreJob" }], async (u) => u === `http://t/${F}` ? res(200, `createClientRpc("${dev("src/lib/portal.functions.ts", "restoreJob")}")`) : res(404, ""));
    expect(r.missing).toEqual([`${F}#restoreJob`]);
  });
  test("resolved dev run records target and build identity", async () => {
    const r = await resolveServerFns("http://t", [{ file: F, name: "getPipeline" }], async (u) => u === `http://t/${F}` ? res(200, `createClientRpc("${dev(F, "getPipeline")}")`) : res(404, ""));
    expect(r.target).toBe("http://t"); expect(r.buildIdentity).toMatch(/^dev:[0-9a-f]{16}$/); expect(r.missing).toEqual([]);
  });
});
