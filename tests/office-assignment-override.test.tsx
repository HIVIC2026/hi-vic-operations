// Focused regression harness (happy-dom) for the Office "Assign anyway" Mitti-override panel.
// Covers P1-R2-S18: client-side reason validation (>=5 chars, shared rule), button disabled
// while invalid, panel stays open on a failed mutation, and closes only on confirmed success.
//
// The harness reproduces the exact pending-panel markup and the exact fixed click handler from
// src/routes/_authenticated/admin.jobs.$jobId.tsx (the Assignments component). The assign call
// is injected so we can simulate success ({ ok: true }) and failure (undefined, matching the
// real useAction contract which returns undefined when the server action throws).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, describe, expect, test } from "bun:test";
const { render, act, cleanup, fireEvent } = await import("@testing-library/react");
const React = await import("react");
const { mittiOverrideAccepted } = await import("../src/lib/mitti-membership.core");

afterEach(() => cleanup());

type AssignResult = { ok: true } | undefined;

// Mirrors the fixed Assign-anyway panel: controlled reason input + guarded button that closes
// the panel only when the mutation confirms success. Keeps the same validation/close contract.
function PanelHarness({ assign }: { assign: (reason: string) => Promise<AssignResult> }) {
  const [pending, setPending] = React.useState<boolean>(true);
  const [why, setWhy] = React.useState("");
  if (!pending) return React.createElement("div", { "data-testid": "closed" }, "panel closed");
  return React.createElement(
    "div",
    { "data-testid": "panel" },
    React.createElement("input", {
      "data-testid": "reason",
      value: why,
      minLength: 5,
      onChange: (e: { target: { value: string } }) => setWhy(e.target.value),
    }),
    React.createElement(
      "button",
      {
        "data-testid": "assign",
        disabled: !mittiOverrideAccepted(why),
        onClick: async () => {
          const res = await assign(why);
          if (res?.ok === true) setPending(false);
        },
      },
      "Assign anyway",
    ),
  );
}

function mount(assign: (reason: string) => Promise<AssignResult>) {
  const r = render(React.createElement(PanelHarness, { assign }));
  const reason = () => r.container.querySelector('[data-testid="reason"]') as HTMLInputElement;
  const button = () => r.container.querySelector('[data-testid="assign"]') as HTMLButtonElement;
  const open = () => !!r.container.querySelector('[data-testid="panel"]');
  const type = async (v: string) => { await act(async () => { fireEvent.change(reason(), { target: { value: v } }); }); };
  const click = async () => { await act(async () => { fireEvent.click(button()); }); };
  return { r, reason, button, open, type, click };
}

describe("S18 · Mitti override reason validity (shared rule)", () => {
  test("empty reason is rejected", () => {
    expect(mittiOverrideAccepted("")).toBe(false);
    expect(mittiOverrideAccepted("    ")).toBe(false);
  });
  test("reason shorter than 5 (trimmed) is rejected", () => {
    expect(mittiOverrideAccepted("ab")).toBe(false);
    expect(mittiOverrideAccepted(" abc ")).toBe(false); // 3 chars after trim
  });
  test("valid reason (>=5 trimmed) is accepted", () => {
    expect(mittiOverrideAccepted("urgent")).toBe(true);
    expect(mittiOverrideAccepted("Office will email evidence instead")).toBe(true);
  });
});

describe("S18 · Assign-anyway button gating", () => {
  test("button disabled for empty reason", async () => {
    const h = mount(async () => ({ ok: true }));
    expect(h.button().disabled).toBe(true);
  });
  test("button disabled for reason shorter than 5 chars", async () => {
    const h = mount(async () => ({ ok: true }));
    await h.type("ab");
    expect(h.button().disabled).toBe(true);
  });
  test("button enabled once reason is valid", async () => {
    const h = mount(async () => ({ ok: true }));
    await h.type("valid reason");
    expect(h.button().disabled).toBe(false);
  });
});

describe("S18 · Panel open/close follows confirmed mutation outcome", () => {
  test("failed mutation (undefined) keeps the panel open", async () => {
    let calls = 0;
    const h = mount(async () => { calls++; return undefined; }); // simulates useAction swallowing a thrown WorkflowError
    await h.type("valid reason");
    await h.click();
    expect(calls).toBe(1);
    expect(h.open()).toBe(true); // panel must NOT close on failure
  });
  test("successful mutation ({ ok: true }) closes the panel", async () => {
    let calls = 0;
    const h = mount(async () => { calls++; return { ok: true }; });
    await h.type("valid reason");
    await h.click();
    expect(calls).toBe(1);
    expect(h.open()).toBe(false); // panel closes only after confirmed success
  });
  test("a non-ok truthy-looking value does NOT close the panel (contract-accurate check)", async () => {
    // Guards against the 'truthy == success' assumption: only res?.ok === true may close.
    const h = mount(async () => (({ ok: false }) as unknown as AssignResult));
    await h.type("valid reason");
    await h.click();
    expect(h.open()).toBe(true);
  });
});
