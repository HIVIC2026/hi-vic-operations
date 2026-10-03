import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, describe, expect, test } from "bun:test";
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const React = await import("react");
const { VerifiedAddressInput } = await import("../src/components/onboarding/VerifiedAddressInput");
type ResolvedAddress = import("../src/lib/rec-onboarding.core").ResolvedAddress;

afterEach(() => cleanup());
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const detail = (label = "30 Dash Street, Richmond VIC 3121"): ResolvedAddress => ({ label, street: "Dash Street", suburb: "Richmond", state: "VIC", postcode: "3121", country: "AU", provider: "google_places_au" });
const style = {};

function harness(provider: { search: (query: string) => Promise<{ id: string; label: string }[]>; details: (id: string) => Promise<ResolvedAddress | null> }, victoriaOnly = false) {
  const state = { value: "", resolved: null as ResolvedAddress | null };
  const pendingStates: boolean[] = [];
  function Host() {
    const [value, setValue] = React.useState("");
    const [resolved, setResolved] = React.useState<ResolvedAddress | null>(null);
    state.value = value; state.resolved = resolved;
    return React.createElement(VerifiedAddressInput, { value, resolved, onChange: setValue, onSelect: setResolved, inputStyle: style, mutedColor: "#555", provider, victoriaOnly, onPendingChange: (pending: boolean) => pendingStates.push(pending) });
  }
  return { ...render(React.createElement(Host)), state, pendingStates };
}

async function typeAndWait(r: ReturnType<typeof harness>, text = "30 dash") {
  const input = r.getByRole("combobox");
  fireEvent.focus(input); fireEvent.change(input, { target: { value: text } });
  await act(async () => { await new Promise((done) => setTimeout(done, 330)); });
  return input;
}

describe("verified address picker", () => {
  test("outside click during pending details never leaves the field locked", async () => {
    const pending = deferred<ResolvedAddress | null>();
    const r = harness({ search: async () => [{ id: "p1", label: "30 Dash Street, Richmond VIC 3121" }], details: () => pending.promise });
    const input = await typeAndWait(r);
    await act(async () => { fireEvent.pointerDown(r.getByRole("option")); });
    expect(r.pendingStates).toEqual([true]);
    fireEvent.pointerDown(document.body);
    await act(async () => { pending.resolve(detail()); });
    expect(r.pendingStates).toEqual([true, false]);
    expect(r.state.resolved?.postcode).toBe("3121");
    fireEvent.focus(input); fireEvent.change(input, { target: { value: "31 Dash" } });
    expect(r.state.value).toBe("31 Dash");
    expect(r.state.resolved).toBeNull();
  });

  test("selection precedes blur and retains a picked house number", async () => {
    const r = harness({ search: async () => [{ id: "p1", label: "15 Main Street, Golden Point Ballarat, VIC" }], details: async () => detail("Main St, Golden Point VIC 3350") });
    await typeAndWait(r, "15 main");
    await act(async () => { fireEvent.pointerDown(r.getByRole("option")); });
    expect(r.state.value).toBe("15 Main St, Golden Point VIC 3350");
    expect(r.state.resolved?.label).toBe("15 Main St, Golden Point VIC 3350");
  });

  test("provider failure remains unverified and permits a new search", async () => {
    let calls = 0;
    const r = harness({ search: async () => [{ id: "p1", label: "30 Dash Street, Richmond VIC 3121" }], details: async () => { calls += 1; if (calls === 1) throw new Error("down"); return detail(); } });
    const input = await typeAndWait(r);
    await act(async () => { fireEvent.pointerDown(r.getByRole("option")); });
    expect(r.state.resolved).toBeNull();
    expect(r.getByText(/couldn't verify/).textContent).toContain("couldn't verify");
    fireEvent.focus(input); fireEvent.change(input, { target: { value: "30 dash again" } });
    await act(async () => { await new Promise((done) => setTimeout(done, 330)); });
    await act(async () => { fireEvent.pointerDown(r.getByRole("option")); });
    expect(r.state.resolved?.postcode).toBe("3121");
  });

  test("Victorian origin rejects a resolved interstate address", async () => {
    const r = harness({ search: async () => [{ id: "p1", label: "1 George St, Sydney NSW 2000" }], details: async () => ({ ...detail("1 George St, Sydney NSW 2000"), state: "NSW", postcode: "2000" }) }, true);
    await typeAndWait(r, "1 george");
    await act(async () => { fireEvent.pointerDown(r.getByRole("option")); });
    expect(r.state.resolved).toBeNull();
    expect(r.getByText(/service area needs to be in Victoria/).textContent).toContain("Victoria");
  });
  test("ROOT repro: outside click while pending, then new text replaces the pick and unlocks", async () => {
    const pending = deferred<ResolvedAddress | null>();
    const r = harness({ search: async (q) => q.startsWith("300") ? [{ id: "p3", label: "300 Collins Street, Melbourne VIC" }] : [{ id: "p2", label: "200 Collins Street, Melbourne VIC" }], details: (id) => id === "p2" ? pending.promise : Promise.resolve(detail("300 Collins St, Melbourne VIC 3000")) });
    const input = await typeAndWait(r, "200 Collins Street Melbourne");
    await act(async () => { fireEvent.pointerDown(r.getByRole("option")); });
    expect(r.state.value).toBe("200 Collins Street, Melbourne VIC");
    fireEvent.pointerDown(document.body); // click "Business details" heading
    fireEvent.focus(input); fireEvent.change(input, { target: { value: "300 Collins Street Melbourne" } });
    expect(r.state.value).toBe("300 Collins Street Melbourne");
    expect(r.pendingStates).toEqual([true, false]);
    await act(async () => { await new Promise((done) => setTimeout(done, 330)); });
    expect(r.getByRole("option").textContent).toBe("300 Collins Street, Melbourne VIC");
    // The cancelled 200 lookup resolving late must not overwrite the new text.
    await act(async () => { pending.resolve(detail("200 Collins St, Melbourne VIC 3000")); });
    expect(r.state.value).toBe("300 Collins Street Melbourne");
    expect(r.state.resolved).toBeNull();
    await act(async () => { fireEvent.pointerDown(r.getByRole("option")); });
    expect(r.state.resolved?.label).toBe("300 Collins St, Melbourne VIC 3000");
    expect(r.pendingStates).toEqual([true, false, true, false]);
  });

  test("mobile blur echo of the picked label does not cancel the pending pick", async () => {
    const pending = deferred<ResolvedAddress | null>();
    const r = harness({ search: async () => [{ id: "p1", label: "30 Dash Street, Richmond VIC 3121" }], details: () => pending.promise });
    const input = await typeAndWait(r);
    await act(async () => { fireEvent.pointerDown(r.getByRole("option")); });
    fireEvent.change(input, { target: { value: "30 Dash Street, Richmond VIC 3121" } });
    await act(async () => { pending.resolve(detail()); });
    expect(r.state.resolved?.postcode).toBe("3121");
    expect(r.pendingStates).toEqual([true, false]);
  });
});
