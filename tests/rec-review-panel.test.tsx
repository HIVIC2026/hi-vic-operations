// Mounted-component harness (happy-dom) for the agreement review gate with an injected loader.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, describe, expect, test } from "bun:test";
const { render, act, cleanup, fireEvent } = await import("@testing-library/react");
const React = await import("react");
const { RecReviewPanel } = await import("../src/components/rec/RecReviewPanel");
const core = await import("../src/lib/rec-onboarding.core");
const { REC_AGREEMENT_VERSION, recReviewGateOpen, resumeFailureMode, REC_INVALID_LINK_MESSAGE, applyMaterialReset } = core;
type RecData = import("../src/lib/rec-onboarding.core").RecData;
type Ready = { sha256: string; version: string } | null;

afterEach(() => cleanup());
const H = "a".repeat(64);
function deferred<T>() { let res!: (v: T) => void, rej!: (e: unknown) => void; const p = new Promise<T>((a, b) => { res = a; rej = b; }); return { p, res, rej }; }

/** Mirrors the page: owns d + ready and exposes the Continue gate. */
function harness(start: RecData, loads: Array<Promise<{ version: string; text: string; sha256: string }>>) {
  const state = { d: start, ready: null as Ready, calls: 0, setD: (_: RecData) => {} };
  function Host() {
    const [d, setD] = React.useState<RecData>(start);
    const [ready, setReady] = React.useState<Ready>(null);
    state.d = d; state.ready = ready; state.setD = setD;
    return React.createElement(RecReviewPanel, { d, preview: false, up: (p: Partial<RecData>) => setD((x) => applyMaterialReset(x, { ...x, ...p })), onReady: setReady, load: () => loads[Math.min(state.calls++, loads.length - 1)]! });
  }
  const r = render(React.createElement(Host));
  const gate = () => recReviewGateOpen(state.d, state.ready);
  const box = () => r.container.querySelector('input[type="checkbox"]') as HTMLInputElement;
  return { r, state, gate, box };
}

describe("QA-REV mounted review panel", () => {
  test("previously reviewed draft: reset on mount; pending load keeps Continue closed and box disabled", async () => {
    const l = deferred<{ version: string; text: string; sha256: string }>();
    const h = harness({ agreement_reviewed: true, trading_name: "Spark" }, [l.p]);
    await act(async () => {});
    expect(h.state.d.agreement_reviewed).toBe(false);
    expect(h.box().disabled).toBe(true);
    expect(h.gate()).toBe(false);
    await act(async () => { l.res({ version: REC_AGREEMENT_VERSION, text: "AGREEMENT", sha256: H }); });
    expect(h.box().disabled).toBe(false); expect(h.gate()).toBe(false); // loaded but not ticked
    await act(async () => { fireEvent.click(h.box()); });
    expect(h.gate()).toBe(true);
  });
  test("load failure: closed, Try again re-requests, success then opens only after tick", async () => {
    const ok = Promise.resolve({ version: REC_AGREEMENT_VERSION, text: "AGREEMENT", sha256: H });
    const h = harness({ agreement_reviewed: true }, [Promise.reject(new Error("net")), ok]);
    await act(async () => {});
    expect(h.r.getByRole("alert").textContent).toMatch(/Could not load/);
    expect(h.box().disabled).toBe(true); expect(h.gate()).toBe(false);
    await act(async () => { fireEvent.click(h.r.getByText("Try again")); });
    expect(h.state.calls).toBe(2); expect(h.box().disabled).toBe(false); expect(h.gate()).toBe(false);
  });
  test("wrong version or malformed hash fails closed", async () => {
    for (const bad of [{ version: "old", text: "x", sha256: H }, { version: REC_AGREEMENT_VERSION, text: "x", sha256: "nothex" }]) {
      const h = harness({}, [Promise.resolve(bad)]);
      await act(async () => {});
      expect(h.box().disabled).toBe(true); expect(h.gate()).toBe(false); cleanup();
    }
  });
  test("schedule edit while reviewed resets tick and ready; stale slow response cannot reopen", async () => {
    const first = Promise.resolve({ version: REC_AGREEMENT_VERSION, text: "OLD", sha256: H });
    const slow = deferred<{ version: string; text: string; sha256: string }>();
    const h = harness({ assessment_rate: 300 }, [first, slow.p]);
    await act(async () => {});
    await act(async () => { fireEvent.click(h.box()); });
    expect(h.gate()).toBe(true);
    await act(async () => { h.state.setD({ ...h.state.d, assessment_rate: 999 }); });
    expect(h.state.d.agreement_reviewed).toBe(false); expect(h.state.ready).toBeNull(); expect(h.gate()).toBe(false);
    expect(h.box().disabled).toBe(true);
    await act(async () => { slow.res({ version: REC_AGREEMENT_VERSION, text: "NEW 999", sha256: "b".repeat(64) }); });
    expect(h.state.ready?.sha256).toBe("b".repeat(64)); expect(h.gate()).toBe(false);
  });
});

describe("QA-RES resume failure mode (token never auto-cleared)", () => {
  test("invalid vs transient", () => {
    expect(resumeFailureMode(new Error(REC_INVALID_LINK_MESSAGE))).toBe("invalid");
    for (const e of [new TypeError("Failed to fetch"), new Error("Could not load your application."), null]) expect(resumeFailureMode(e)).toBe("retry");
  });
});
