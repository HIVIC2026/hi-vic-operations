# Task 7b report: remove the hidden "xx" from the Statement of rights
Status: DONE.
- scripts/clean-statement-of-rights.py (pikepdf): drops only the one TJ on page 1 that shows exactly "xx" (font /F4, Tm 63.384 638.86; content-stream op 250). Refuses (exit 1, writes nothing) if text at that position is not "xx", if another "xx" show exists elsewhere, or if the match count is not exactly 1. Writes via temp file + rename.
- docs/esc-forms/veu-statement-of-rights-clean.pdf, sha256 1b131870bdb849641641014483725c1232c39eca8619adb16560520dd28144a1. Original untouched (6af6ff4d...df6e).
- scripts/embed-statement-of-rights.ts now embeds the clean file; src/lib/statement-of-rights.data.ts regenerated (138145 bytes); data and core headers record ESC v1.2 20240501, original sha, Jo's 3 Nov 2026 instruction, clean sha.
- Tests (tests/statement-of-rights.test.ts): RED first (clean sha/file missing, "xx" still in text), then GREEN, 6 pass. Covers embedded bytes == clean file + sha, original sha unchanged, no standalone xx, per-page word sequence equals original minus "xx", 2 pages, pdftoppm -r 72 PNGs byte-equal for both pages (visible skip message if pdftoppm missing), script refusal on the clean file.
Concerns: the clean PDF is a pikepdf re-save (size 141061 -> 138145 bytes), so it is not a byte-minimal edit; text and render verified identical apart from "xx". Full suite not run. Unrelated uncommitted changes in the working tree were left alone.

## Fix round 1
- Missing pdftotext/pdftoppm now throws (test FAILS with a clear message) instead of skipping.
- clean script refuses when output realpath equals input realpath (same path, symlink, or ./ alias); original never overwritten.
- New synthetic-PDF tests (built with pikepdf in the test): control success, wrong text at position, two matches, extra xx elsewhere, same-path/symlink output. 11 pass.
