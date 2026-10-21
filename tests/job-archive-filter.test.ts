import { expect, test } from "bun:test";
import { jobArchiveFilter } from "../src/lib/job-list-page.core";

test("444 archived TEST jobs produce a compact exclusion, not a 17KB UUID request", () => {
  const rows = Array.from({ length: 444 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, source: "qa_test", qa_archived_at: "2026-10-21T00:00:00Z" }));
  expect(jobArchiveFilter(rows)).toEqual({ visible: "source.is.null,source.neq.qa_test", archivedOtherIds: [] });
  expect(jobArchiveFilter(rows).visible.length).toBeLessThan(100);
});

test("live TEST jobs remain included while every archived source stays excluded", () => {
  const result = jobArchiveFilter([
    { id: "live-test", source: "qa_test", qa_archived_at: null },
    { id: "archived-test", source: "qa_test", qa_archived_at: "2026-10-21" },
    { id: "archived-other", source: "base44", qa_archived_at: "2026-10-21" },
    { id: "archived-null", source: null, qa_archived_at: "2026-10-21" },
  ]);
  expect(result.visible).toBe("source.is.null,source.neq.qa_test,id.in.(live-test)");
  expect(result.archivedOtherIds).toEqual(["archived-other", "archived-null"]);
});