// S64 focused render-branch test for the electrician manual result form.
// Uses happy-dom to render the component in isolation and verifies:
// - Form renders with the correct structure
// - Fields are present with correct labels
// - manualResultEntry predicate works correctly
// - Saved feedback displays when onPut returns a timestamp
import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const { render, cleanup } = await import("@testing-library/react");
import { ElectricianManualResult, manualResultEntry } from "@/components/portal/electrician-manual-result";
import { melbourneToday } from "@/lib/melbourne-time.core";

describe("ElectricianManualResult render branch", () => {
  // afterEach(() => cleanup());

  test("form renders with correct structure when not locked", () => {
    const { container } = render(<ElectricianManualResult value={{}} locked={false} savedAt={null} onPut={(k, v) => {}} />);
    // Ensure heading exists
    expect(container.querySelector('h2')?.textContent).toContain("Electrical assessment · manual entry");
    // Ensure key controls are present
    expect(container.textContent).toContain("Switchboard condition");
    expect(container.textContent).toContain("RCDs present");
    expect(container.textContent).toContain("RCDs to install");
    expect(container.textContent).toContain("Life support onsite");
    expect(container.textContent).toContain("Hazards");
    expect(container.textContent).toContain("Notes");
    expect(container.textContent).toContain("Assessment date");
    expect(container.textContent).toContain("No electrical fixes required");
    expect(container.textContent).toContain("PIESA outcome");
  });

  test("manualResultEntry predicate returns true when no Mitti link and not complete", () => {
    expect(manualResultEntry({ external_mitti_id: null, status: "draft" })).toBe(true);
    expect(manualResultEntry({ external_mitti_id: null, status: "in_progress" })).toBe(true);
    expect(manualResultEntry({ external_mitti_id: null, status: "pending" })).toBe(true);
  });

  test("manualResultEntry predicate returns false when Mitti link present", () => {
    expect(manualResultEntry({ external_mitti_id: "mitti-123", status: "draft" })).toBe(false);
    expect(manualResultEntry({ external_mitti_id: "mitti-123", status: "in_progress" })).toBe(false);
  });

  test("manualResultEntry predicate returns false when assessment is complete", () => {
    expect(manualResultEntry({ external_mitti_id: null, status: "complete" })).toBe(false);
    expect(manualResultEntry({ external_mitti_id: "mitti-123", status: "complete" })).toBe(false);
  });

  test("manualResultEntry predicate returns true for null assessment (shows manual entry for new assessments)", () => {
    expect(manualResultEntry(null)).toBe(true);
    expect(manualResultEntry(undefined)).toBe(true);
  });

  test("saved feedback displays when timestamp provided", () => {
    const { container } = render(<ElectricianManualResult value={{}} locked={false} savedAt="10:30 AM" onPut={() => {}} />);
    expect(container.textContent).toContain("Saved 10:30 AM");
  });

  test("saved feedback hides when no timestamp", () => {
    const { container } = render(<ElectricianManualResult value={{}} locked={false} savedAt={null} onPut={() => {}} />);
    expect(container.textContent).not.toContain("Saved");
  });

test("fields are disabled when locked", () => {
  const { container } = render(<ElectricianManualResult value={{}} locked={true} savedAt={null} onPut={(k, v) => {}} />);
  // When locked, Choice buttons should be disabled
  const buttons = container.querySelectorAll('button');
  for (const btn of buttons) {
    expect(btn.hasAttribute('disabled')).toBe(true);
  }
});

// S64 integration + future-date rule: the manual form is the only way to set assessed_on without Mitti,
// so the input itself must refuse a date past the Melbourne calendar day.
test("assessment date input is capped at today (Australia/Melbourne)", () => {
  const { container } = render(<ElectricianManualResult value={{}} locked={false} savedAt={null} onPut={(k, v) => {}} />);
  const date = container.querySelector('input[type="date"]') as HTMLInputElement | null;
  expect(date).not.toBeNull();
  expect(date!.getAttribute('max')).toBe(melbourneToday());
  expect(container.textContent).toContain("cannot be in the future");
});

test("an existing assessment date is shown back to the electrician", () => {
  const { container } = render(<ElectricianManualResult value={{ assessed_on: "2026-10-18" }} locked={false} savedAt={null} onPut={(k, v) => {}} />);
  const date = container.querySelector('input[type="date"]') as HTMLInputElement | null;
  expect(date!.value).toBe("2026-10-18");
});

test("a locked (completed) assessment renders no editable control", () => {
  const { container } = render(<ElectricianManualResult value={{ assessed_on: "2026-10-18" }} locked={true} savedAt={null} onPut={(k, v) => {}} />);
  for (const el of container.querySelectorAll('input, button, textarea')) {
    expect(el.hasAttribute('disabled')).toBe(true);
  }
});
});
