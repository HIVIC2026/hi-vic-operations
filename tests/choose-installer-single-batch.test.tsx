import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { afterEach, expect, mock, test } from "bun:test";

const calls: { fn: string; data: unknown }[] = [];
let releaseState = "none";
let history: unknown[] = [];
let failure = false;
const stub = (id: string) => Object.assign(() => undefined, { id });
mock.module("@/lib/offer-dispatch.functions", () => ({ listChooseTrades: stub("list") }));
mock.module("@/lib/spot-release.functions", () => ({
  getSpotRelease: stub("loadRelease"),
  releaseSpotFn: stub("release"),
}));
mock.module("@/lib/area-batch.functions", () => ({
  sendAreaBatchFn: stub("batch"),
  getAreaBatchSuggestions: stub("suggestions"),
  getBatchesReadyToSend: stub("ready"),
}));
mock.module("@/lib/installer-run.functions", () => ({
  offerRunFn: stub("offer"),
  returnBatchFn: stub("return"),
}));
mock.module("@/components/portal/panels", () => ({
  Section: ({ children }: { children: React.ReactNode }) => children,
}));
mock.module("@/components/portal/jobfile", () => ({
  useJobFile: () => ({ data: { timeline: history }, isError: false, isPending: false }),
}));
const messages: string[] = [];
mock.module("sonner", () => ({
  toast: { success: (m: string) => messages.push(m), error: (m: string) => messages.push(m) },
}));
mock.module("@tanstack/react-start", () => ({
  useServerFn:
    (fn: { id: string }) =>
    async ({ data }: { data: unknown }) => {
      calls.push({ fn: fn.id, data });
      if (failure) throw new Error("Nothing was sent");
      history = [
        {
          at: "2026-11-01T01:00:00Z",
          detail: { event_type: "area_batch_sent", batch_id: "b1", installer_name: "TEST Bravo" },
        },
      ];
      return fn.id === "batch" ? { homes: 1, held: 1 } : { mode: "offered" };
    },
}));
const trade = {
  id: "test-biz",
  business: "TEST Bravo",
  inArea: true,
  distanceKm: null,
  areaNote: "Covers 3000",
  rate: 12,
  rateUnit: "per m²",
  blocker: null,
  alreadyOffered: null,
};
let openOffer: unknown = null;
mock.module("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey[0] === "choose-trades"
        ? {
            channel: "hivic_sourced",
            stage: "ready_check_ready_to_schedule",
            hasInstaller: false,
            isTestJob: true,
            openOffer,
            matching: [trade],
            others: [
              { ...trade, id: "blocked", business: "Blocked TEST", blocker: "No certificate" },
            ],
          }
        : { state: releaseState, line: "Owner confirmation" },
    isError: false,
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
const React = await import("react");
const { render, fireEvent, act, cleanup } = await import("@testing-library/react");
const { ChooseInstallerPanel } = await import("../src/components/portal/choose-installer");
afterEach(() => {
  cleanup();
  calls.length = 0;
  messages.length = 0;
  releaseState = "none";
  history = [];
  failure = false;
  openOffer = null;
});
const mount = () => render(React.createElement(ChooseInstallerPanel, { jobId: "qa-test-job" }));

test("waiting TEST job sends one job through the existing batch action, then reads back the saved batch", async () => {
  const r = mount();
  await act(async () => {
    fireEvent.click(r.getByRole("button", { name: "Send" }));
  });
  expect(calls).toEqual([
    { fn: "batch", data: { jobIds: ["qa-test-job"], businessId: "test-biz" } },
  ]);
  expect(messages).toEqual(["Sent to 1 owner for TEST Bravo · 1 text held (see the job)"]);
  expect(r.queryByRole("button", { name: "Send" })).toBeNull();
  cleanup();
  expect(mount().queryByRole("button", { name: "Send" })).toBeNull();
});
test("blocked installers cannot send and failed sends stay waiting", async () => {
  failure = true;
  const r = mount();
  fireEvent.click(r.getByRole("button", { name: /Show 1 more/ }));
  expect(r.getAllByRole("button", { name: "Send" })[1]?.hasAttribute("disabled")).toBe(true);
  await act(async () => {
    fireEvent.click(r.getAllByRole("button", { name: "Send" })[0] as HTMLElement);
  });
  expect(messages).toEqual(["Nothing was sent"]);
  expect(r.getAllByRole("button", { name: "Send" })).toHaveLength(2);
});
test("confirmed owners keep Release, pending owners and open offers cannot Send", async () => {
  releaseState = "confirmed";
  const r = mount();
  await act(async () => {
    fireEvent.click(r.getByRole("button", { name: "Release" }));
  });
  expect(calls[0]).toEqual({
    fn: "release",
    data: { jobId: "qa-test-job", businessId: "test-biz" },
  });
  cleanup();
  releaseState = "pending";
  expect(mount().queryByRole("button", { name: "Send" })).toBeNull();
  cleanup();
  releaseState = "none";
  openOffer = { business: "TEST Bravo" };
  expect(mount().queryByRole("button", { name: "Send" })).toBeNull();
});
