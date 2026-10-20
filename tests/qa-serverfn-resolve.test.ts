import { describe, expect, test } from "bun:test";
import { buildCandidate, decodeDevId, devIdsFromModule, resolveServerFns } from "../scripts/qa-serverfn-resolve";

const dev = (file: string, name: string) => Buffer.from(JSON.stringify({ file: `/${file}?tss-serverfn-split`, export: `${name}_createServerFn_handler` })).toString("base64url");
const F = "src/lib/office.functions.ts";
const res = (status: number, body: string) => ({ status, text: async () => body });

describe("QA server-function ID resolver", () => {
  test("decodes the framework dev format", () => expect(decodeDevId(dev(F, "getPipeline"))).toEqual({ file: `/${F}?tss-serverfn-split`, export: "getPipeline_createServerFn_handler" }));
  test("reads dev IDs only for the expected file", () => {
    const text = `x.handler(createClientRpc("${dev(F, "getPipeline")}")); y.handler(createClientRpc("${dev("src/lib/other.ts", "listByStatus")}"))`;
    expect(devIdsFromModule(text, F)).toEqual({ getPipeline: dev(F, "getPipeline") });
  });
  test("dev target: IDs come from the served transform, not a hash", async () => {
    const r = await resolveServerFns("http://t", [{ file: F, name: "getPipeline" }], async (u) => u === `http://t/${F}` ? res(200, `createClientRpc("${dev(F, "getPipeline")}")`) : res(404, ""));
    expect(r.mode).toBe("dev"); expect(r.ids[`${F}#getPipeline`]).toBe(dev(F, "getPipeline")); expect(r.missing).toEqual([]);
  });
  test("build target: hash accepted only when present in served compiled client", async () => {
    const c = buildCandidate({ file: F, name: "getPipeline" });
    const pages: Record<string, string> = { "http://t/": `<script type="module" src="/assets/main.js"></script>`, "http://t/assets/main.js": `import("./route.js")`, "http://t/assets/route.js": `rpc("${c}")` };
    const r = await resolveServerFns("http://t", [{ file: F, name: "getPipeline" }, { file: F, name: "listByStatus" }], async (u) => pages[u] ? res(200, pages[u]!) : res(404, ""));
    expect(r.mode).toBe("build"); expect(r.ids[`${F}#getPipeline`]).toBe(c); expect(r.missing).toEqual([`${F}#listByStatus`]);
  });
  test("nothing served: unresolved (diagnostic), no IDs invented", async () => {
    const r = await resolveServerFns("http://t", [{ file: F, name: "getPipeline" }], async () => res(404, ""));
    expect(r.mode).toBe("unresolved"); expect(r.ids).toEqual({}); expect(r.missing.length).toBe(1);
  });
  test("live preview: real Office IDs resolve from the served transform", async () => {
    const r = await resolveServerFns("http://localhost:8080", [{ file: F, name: "getPipeline" }, { file: F, name: "listByStatus" }, { file: "src/lib/portal.functions.ts", name: "setEligibility" }]).catch(() => null);
    if (!r) return; // preview not reachable in this environment
    expect(r.mode).toBe("dev"); expect(r.missing).toEqual([]);
  });
});
