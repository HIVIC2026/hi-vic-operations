import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { refreshInstallerJob } from "../src/components/trade/job-cache";

test("successful installer save refreshes active job read models and home, not another job", async () => {
  const qc = new QueryClient();
  let saved = false;
  const keys = ["intake-progress", "my-intake-job", "rc-draft", "blockers", "trade-job-status", "evidence", "job"];
  const watchers = keys.map((key) => new QueryObserver(qc, { queryKey: [key, "test-job"], queryFn: async () => saved ? "current" : "old" }));
  watchers.push(new QueryObserver(qc, { queryKey: ["trade-home"], queryFn: async () => saved ? "current" : "old" }));
  const unsub = watchers.map((observer) => observer.subscribe(() => {}));
  await Promise.all(watchers.map((observer) => observer.refetch()));
  qc.setQueryData(["intake-progress", "other-job"], "unchanged");
  saved = true;
  await refreshInstallerJob(qc, "test-job");
  for (const key of keys) expect(qc.getQueryData([key, "test-job"])).toBe("current");
  expect(qc.getQueryData(["trade-home"])).toBe("current");
  expect(qc.getQueryData(["intake-progress", "other-job"])).toBe("unchanged");
  unsub.forEach((stop) => stop());
  qc.clear();
});

test("a failed refresh remains a read error, not a failed save or fabricated progress", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let fail = false;
  const observer = new QueryObserver(qc, { queryKey: ["intake-progress", "test-job"], queryFn: async () => { if (fail) throw new Error("interrupted read"); return "previous"; } });
  const stop = observer.subscribe(() => {});
  await observer.refetch();
  fail = true;
  await refreshInstallerJob(qc, "test-job");
  expect(observer.getCurrentResult().isError).toBe(true);
  expect(observer.getCurrentResult().data).toBe("previous");
  stop(); qc.clear();
});