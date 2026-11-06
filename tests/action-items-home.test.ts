// Installer redesign — Action items home data (plan Task 5): stop reasons and who a job waits on.
import { describe, expect, test } from "bun:test";
import { classifyPrestartFailures } from "../src/lib/prestart.core";
import { tradeSafeFailures } from "../src/lib/go-email.core";
const { homeStops } = await import("../src/lib/action-items.server");
const { waitingOnFor } = await import("../src/lib/action-items.core");

const now = new Date("2026-11-06T01:00:00Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

describe("homeStops", () => {
  test("stop reason from prestart", async () => {
    const line = "Electrical clearance is not valid: no electrician booked";
    const safe = tradeSafeFailures(classifyPrestartFailures([line], { start: inDays(2), now }))[0]?.line;
    expect(safe).toBeTruthy();
    const r = await homeStops([{ jobId: "a", installAt: inDays(2) }], now, async () => [line]);
    expect(r.get("a")).toBe(safe!);
  });
  test("prestart read failure keeps the screen", async () => {
    const r = await homeStops([{ jobId: "a", installAt: inDays(2) }, { jobId: "b", installAt: inDays(3) }], now, async (id) => { if (id === "a") throw new Error("down"); return []; });
    expect(r.get("a")).toBeNull();
    expect(r.get("b")).toBeNull();
  });
  test("install 8 days away isn't checked", async () => {
    let called = 0;
    const r = await homeStops([{ jobId: "a", installAt: inDays(8) }, { jobId: "b", installAt: null }], now, async () => { called++; return ["x"]; });
    expect(called).toBe(0);
    expect(r.size).toBe(0);
  });
});

describe("waitingOnFor", () => {
  const w = (kind: string, o: Partial<Parameters<typeof waitingOnFor>[0]> = {}) => waitingOnFor({ kind, title: "", channel: "hivic_sourced", ownerFirst: "SAM", electricianName: "james wood", ...o });
  test("by box kind", () => {
    expect(w("waiting_quote", { title: "Quote being prepared" })).toBe("Home Insulation Victoria");
    expect(w("waiting_quote", { title: "Waiting for the owner to decide" })).toBe("Sam");
    expect(w("piesa_booked")).toBe("James (electrician)");
    expect(w("waiting_electrician_book")).toBe("James (electrician)");
    expect(w("waiting_deposit")).toBe("Sam");
    expect(w("after_install")).toBe("Home Insulation Victoria");
    expect(w("after_install", { channel: "installer_sourced" })).toBe("Sam");
  });
});
