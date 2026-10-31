# Read-only investigation: pre-existing failing tests

Nothing is edited, no live SQL, no sends, no publishing. The only output is a report in chat.

## Step 1 — `tests/a3-a4-role-isolation-db.test.ts`
- Read the test and list what it protects: which roles it checks, which records each role must not see, and where `intakeProgressGate` is used.
- Read commit `bdf1da3c` (19 Oct) to see what `intakeProgressGate` did and what replaced it.
- Search the current code for the same check under another name: intake progress or stage gating, and any role or RLS checks it relied on.
- Verdict: "still protected by X (file)" or "protection lost when the export was removed", with evidence.

## Step 2 — Run the failing tests
- `bun test tests/*quote*` (about 38 failures expected).
- Full suite through the output-limited runner, with output saved to /tmp (about 236–241 failures expected). Record the exact failing count and the list of test names.
- Run each file that fails alone as well. This shows which failures only happen when files leak mocks into each other (bucket C).

## Step 3 — Sort every failure into exactly one bucket
- **A, stale test:** the test pins old wording, an old rule, a removed function or a file path, and the code matches the current `docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md` and `src/config/workflow-decisions.ts`.
- **B, real bug:** the code breaks a rule that is still current.
- **C, test-harness problem:** mock leakage, a missing fixture, a crash or a timeout. This includes failures that pass when the file runs alone.
- **D, unclear:** the rule's status needs Jo's decision.
- For each failure, check the assertion against the current decisions file and the source-of-truth doc before choosing A or B. When it's unclear, it goes in D, not A.

## Report format
- Totals per bucket. The four totals must add up to the full failure count.
- A and C: counts by file.
- B and D: every item listed with its file, test name and a one-line reason.
- Item 1 verdict at the top.
