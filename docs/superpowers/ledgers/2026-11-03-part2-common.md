# Common rules for every Part 2 task
- Repo: /home/claude/hi-vic-operations, branch part2-electrician-calls-and-books. Do not push. Do not dispatch subagents.
- Tests: `bun test <file>` ONE FILE AT A TIME (multi-file runs leak mocks here). xlsx is not installed; ignore xlsx-only failures. Type check: `bunx tsc --noEmit -p .` (main is 0 errors).
- Some source-pin tests already fail on main (esc-collection-notice, fixes-times, install-clearance). Note them, don't fix them.
- TDD with RED/GREEN evidence. Follow existing patterns (pure *.core.ts plus *.server.ts; PGlite tests use tests/helpers/pglite-postgrest-shim.ts; pending SQL lives in docs/pending-migrations with a matching .undo.sql, code reads new columns fail-closed — see src/lib/AGENTS.md).
- Trade messages pass `{ businessId: <recipient business>, jobId }` to tradeMessagesPausedNow; office emails use sendOfficeEmail with `pauseJobId`.
- Installer offices are emailed, never texted. Electricians get texts with a no-login link. New wording is held (wordingApproved:false / unapproved template) until Jo approves it.
- Plain-English UI copy: "Home Insulation Victoria" in full, "electrical upgrades" never "fixes", "safety check (PIESA)".
- Commit: `git -c user.name=Claude -c user.email=noreply@anthropic.com commit`, and end the message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CfFAPGALdx4ZEAytjeq8iV
- Report: write the full report (what you did, RED/GREEN commands and output, files, self-review, concerns) to the report path given. Reply with ONLY: Status (DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT), commits, a one-line test summary, concerns, report path. Under 15 lines. If something's unclear, use NEEDS_CONTEXT; don't guess.
