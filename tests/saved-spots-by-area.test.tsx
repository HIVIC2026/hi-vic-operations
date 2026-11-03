// Saved spots by area (3 Nov 2026), Task 5: To release opens on "By area" — area headings in the list's order, said yes →
// waiting → Best → Good → OK → Weak inside each area, any plain saved spot tickable (Weak too), ticks shared with the
// Table and the Send bar. The Suggested batches box is gone.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, expect, mock, test } from "bun:test";
import { createElement } from "react";

const stub = (id: string) => Object.assign(() => undefined, { id });
mock.module("@tanstack/react-router", () => ({
  Link: ({
    children,
    to: _to,
    params: _p,
    search: _s,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params?: unknown;
    search?: unknown;
  }) => createElement("a", { href: "#", ...rest }, children),
}));
mock.module("@/lib/installer-waiting.functions", () => ({ getInstallerWaitingList: stub("list") }));
mock.module("@/lib/area-batch.functions", () => ({
  sendAreaBatchFn: stub("batch"),
  getInstallersForHomesFn: stub("installers"),
  getBatchesReadyToSend: stub("ready"),
}));
mock.module("@/lib/offer-dispatch.functions", () => ({ listChooseTrades: stub("trades") }));
mock.module("@/lib/spot-release.functions", () => ({
  getSpotRelease: stub("loadRelease"),
  releaseSpotFn: stub("release"),
}));
mock.module("@/lib/in-house-batch.functions", () => ({
  allocateInHouseBatch: stub("give"),
  getInHouseGiveForJob: stub("loadGive"),
  getInHouseBatches: stub("inHouse"),
}));
mock.module("@/lib/installer-run.functions", () => ({
  offerRunFn: stub("offer"),
  returnBatchFn: stub("return"),
}));
mock.module("@/components/portal/panels", () => ({
  Section: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("@/components/portal/jobfile", () => ({
  useJobFile: () => ({ data: { timeline: [] }, isError: false, isPending: false }),
}));
mock.module("@/components/portal/in-house-handoff", () => ({ InHouseHandoff: () => null }));
mock.module("@/hooks/use-me", () => ({ useMe: () => ({ data: { roles: ["admin"], user: { id: "u1" } } }) }));
mock.module("sonner", () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }));
mock.module("@tanstack/react-start", () => ({
  useServerFn: (fn: { id: string }) => async () => ({ fn: fn.id }),
}));

const NOW = Date.parse("2026-11-03T00:00:00Z");
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  jobNumber: id.toUpperCase(),
  ownerName: `Owner ${id}`,
  suburb: "Rowville",
  postcode: "3178",
  areaM2: 120,
  areaKind: "website",
  insulation: "no",
  estimateDollars: 900,
  spotSavedAt: "2026-10-20T00:00:00Z",
  waitingFrom: "2026-10-20T00:00:00Z",
  coverage: { installer: true, electrician: true },
  lastOffer: null,
  isTest: false,
  ...extra,
});
const list = {
  now: NOW,
  rows: [
    row("hv-1", { batch: { kind: "said_yes" }, band: "ok", score: 1 }),
    row("hv-2", {
      band: "best",
      score: 5,
      reason: "No insulation · house",
      satelliteUrl: "https://maps.example/sat",
      listingUrl: "https://listing.example/1",
      estCeiling: { m2: 170, source: "above" as const },
    }),
    row("hv-3", { band: "weak", score: 9, tags: ["Life support", "Not checked yet"] }),
    row("hv-4", { band: "good", score: 2, suburb: "Knox", postcode: "3152" }),
    row("hv-5", {
      band: "best",
      score: 3,
      suburb: "Knox",
      postcode: "3152",
      batch: { kind: "waiting", installerName: "Sample Co" },
    }),
  ],
  // jobIds deliberately not in display order — the view sorts them.
  areas: [
    { key: "a", heading: "Rowville (3)", jobIds: ["hv-3", "hv-2", "hv-1"], locationKnown: true },
    { key: "b", heading: "Knox (2)", jobIds: ["hv-4", "hv-5"], locationKnown: true },
  ],
};
let waitingUpdatedAt = 0; // the list's dataUpdatedAt (a last copy is shown while it equals the seeded time)
mock.module("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    dataUpdatedAt: queryKey[0] === "installer-waiting" ? waitingUpdatedAt : 0,
    isSuccess: true,
    isPlaceholderData: false,
    data:
      queryKey[0] === "installer-waiting"
        ? list
        : queryKey[0] === "installers-for-homes"
          ? { installers: [{ id: "b1", name: "Sample Co" }] }
          : queryKey[0] === "area-batches"
            ? []
            : undefined,
    isError: false,
    isPending: false,
    isFetching: false,
    refetch: async () => {},
  }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));

const React = await import("react");
const { render, fireEvent, cleanup, within } = await import("@testing-library/react");
const { InstallerWaitingScreen } = await import("../src/components/portal/InstallerWaitingScreen");
afterEach(() => cleanup());
const mount = () => render(React.createElement(InstallerWaitingScreen));
const jobsIn = (el: HTMLElement) =>
  [...el.querySelectorAll("[data-spot]")].map((e) => e.getAttribute("data-spot"));

test("opens on By area: headings in list.areas order; said yes above Best above Weak; waiting above Best", () => {
  const r = mount();
  expect(r.getByRole("button", { name: "By area" }).getAttribute("aria-pressed")).toBe("true");
  const areas = r.getAllByRole("region").filter((e) => e.hasAttribute("data-area"));
  expect(areas.map((a) => within(a).getByRole("heading").textContent)).toEqual([
    "Rowville (3)",
    "Knox (2)",
  ]);
  expect(jobsIn(areas[0]!)).toEqual(["hv-1", "hv-2", "hv-3"]);
  expect(jobsIn(areas[1]!)).toEqual(["hv-5", "hv-4"]);
  expect(within(areas[0]!).getByText("Owner hv-1 said yes · free Ready Check")).toBeTruthy();
});

test("each spot shows band, reason, tags, estimated ceiling and links (new tab)", () => {
  const r = mount();
  const best = r.container.querySelector('[data-spot="hv-2"]') as HTMLElement;
  expect(within(best).getByText("Best")).toBeTruthy();
  expect(within(best).getByText("No insulation · house")).toBeTruthy();
  expect(within(best).getByText(/Est. ceiling ~170 m² \(from above\)/)).toBeTruthy();
  const sat = within(best).getByRole("link", { name: "Satellite" });
  expect(sat.getAttribute("href")).toBe("https://maps.example/sat");
  expect(sat.getAttribute("target")).toBe("_blank");
  expect(within(best).getByRole("link", { name: "Listing" }).getAttribute("href")).toBe(
    "https://listing.example/1",
  );
  const weak = r.container.querySelector('[data-spot="hv-3"]') as HTMLElement;
  expect(within(weak).getByText("Weak")).toBeTruthy();
  expect(within(weak).getByText("Life support").className).toContain("text-rose");
  expect(within(weak).queryByRole("link", { name: "Satellite" })).toBeNull();
  expect(within(weak).queryByRole("link", { name: "Listing" })).toBeNull();
});

test("a Weak row can be ticked; ticks from two areas show 2 ticked; said yes / waiting rows can't be ticked", () => {
  const r = mount();
  const weakBox = r.getByRole("checkbox", { name: "Tick HV-3 for Send" });
  expect(weakBox.hasAttribute("disabled")).toBe(false);
  expect(r.getByRole("checkbox", { name: "Tick HV-1 for Send" }).hasAttribute("disabled")).toBe(
    true,
  );
  expect(r.getByRole("checkbox", { name: "Tick HV-5 for Send" }).hasAttribute("disabled")).toBe(
    true,
  );
  fireEvent.click(weakBox);
  fireEvent.click(r.getByRole("checkbox", { name: "Tick HV-4 for Send" }));
  expect(r.getByText("2 ticked")).toBeTruthy();
});

test("Suggested batches is gone", () => {
  const r = mount();
  expect(r.queryByText(/Suggested batches/)).toBeNull();
});

test("Table shows the existing column headings and keeps the ticks", () => {
  const r = mount();
  fireEvent.click(r.getByRole("checkbox", { name: "Tick HV-3 for Send" }));
  fireEvent.click(r.getByRole("button", { name: "Table" }));
  expect(r.getAllByText("Suburb (postcode)").length).toBeGreaterThan(0);
  expect(r.getAllByText("Waiting since").length).toBeGreaterThan(0);
  expect(r.getByText("1 ticked")).toBeTruthy();
  expect(
    (r.getByRole("checkbox", { name: "Tick HV-3 for Send" }) as HTMLInputElement).checked,
  ).toBe(true);
});

// Task 9: the last copy on this device draws at once; Send waits for the fresh copy.
const { seedLastCopy } = await import("../src/lib/office-last-copy");
const { writeLastCopy } = await import("../src/lib/trade-cache");
const { installerWaitingKey } = await import("../src/lib/office-list-keys.core");

function showLastCopy() {
  localStorage.clear();
  const key = installerWaitingKey(false);
  writeLastCopy("u1", "installer-waiting", { k: JSON.stringify(key), d: list });
  let stored: unknown;
  const qc = { getQueryData: () => undefined, setQueryData: (_k: unknown, d: unknown) => { stored = d; } };
  expect(seedLastCopy(qc as never, "u1", "installer-waiting", key)).toBe(true);
  expect(stored).toEqual(list);
  waitingUpdatedAt = JSON.parse(localStorage.getItem("hiv-last:v1:u1:installer-waiting")!).at;
}

test("from the last copy: the list draws, 'Updating…' shows, and Send is disabled saying 'Updating…'", () => {
  showLastCopy();
  const r = mount();
  expect(r.container.querySelectorAll("[data-spot]").length).toBe(5);
  expect(r.container.querySelector("[data-last-copy-updating]")?.textContent).toBe("Updating…");
  fireEvent.click(r.getByRole("checkbox", { name: "Tick HV-3 for Send" }));
  const send = r.getByRole("button", { name: "Updating…" }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  expect(r.queryByRole("button", { name: "Send" })).toBeNull();
});

test("once the fresh copy has arrived: no 'Updating…' line and Send is enabled", () => {
  showLastCopy();
  waitingUpdatedAt += 1000; // fresh data replaced the copy
  const r = mount();
  expect(r.container.querySelector("[data-last-copy-updating]")).toBeNull();
  fireEvent.click(r.getByRole("checkbox", { name: "Tick HV-3 for Send" }));
  expect((r.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
});

test("no last copy (first visit): today's behaviour, Send enabled", () => {
  waitingUpdatedAt = 0;
  const r = mount();
  expect(r.container.querySelector("[data-last-copy-updating]")).toBeNull();
  fireEvent.click(r.getByRole("checkbox", { name: "Tick HV-3 for Send" }));
  expect((r.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
});

test("the same screen in the Table view also holds Send until fresh", () => {
  showLastCopy();
  const r = mount();
  fireEvent.click(r.getByRole("checkbox", { name: "Tick HV-3 for Send" }));
  fireEvent.click(r.getByRole("button", { name: "Table" }));
  expect((r.getByRole("button", { name: "Updating…" }) as HTMLButtonElement).disabled).toBe(true);
});
