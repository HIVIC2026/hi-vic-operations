# Saved Spots by Area, Ranked Best to Worst — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jo can tick any saved spot on Choose installer › To release, shown grouped by nearby area and ranked Best → Weak using owner answers, photos (Jo's or AI), quick taps, the Google roof check and online listings.

**Architecture:** Two pure cores (`saved-spot-rank.core.ts` for band/score/reason/tags, `saved-spot-areas.core.ts` for ~10 km grouping) feed the existing To release loader and a new "By area" view. Three feeders write `property_facts` that the ranker reads: a roof check (Google Solar only, ranking-only, never Gate 1), an AI photo check (Lovable gateway, like `coes-check.server.ts`), and a listing-facts endpoint that Claude's nightly scheduled task posts to. Send drops only the "likely eligible" rule.

**Tech Stack:** TanStack Start + React, Supabase (Postgres + storage), bun test (`bun run test`), Lovable AI gateway via `@ai-sdk/openai`.

**Spec:** `docs/superpowers/specs/2026-11-03-saved-spots-by-area-design.md`

## Global Constraints

- Area radius: **10 km** (reuse `distanceM` from `geo.core`). Every saved spot in exactly one group; no min size, no cap; groups recomputed on each load, never stored.
- Group heading: top 2–3 suburbs by count joined with " · " + " (n)"; biggest groups first, tie → group holding the best-ranked home.
- Order inside a group: said yes → waiting for owner → Best → Good → OK → Weak → score.
- Bands (verbatim): **Best** = Jo's `looks_eligible` OR AI "none"/"under_r2". **Good** = owner said no insulation. **OK** = thin, loose-fill, patchy, under R2, or "not sure". **Weak** = thicker / "has insulation" no detail, unit not top floor, AI "over_r2", or no insulation answer.
- Jo's desk check always beats the AI. The AI never cancels, never messages, never writes `desk_check_status`.
- Tags (verbatim): "Life support" (red, no rank change), "No street address", "Listing says: …", "AI: confirm", "AI: looks over R2 — confirm", "Not checked yet".
- Send: up to 10, any band, any area; all existing blockers except `likelyEligible` stay. No "are you sure".
- Roof check: Google Solar Building Insights only; facts `roof_form`, `site_roof_risk`, `building_ground_footprint`; **must not** call `autoDecideEligibility` or touch `jobs.eligibility_*` (property intelligence was retired from Gate 1 on 4 Oct 2026 — keep it that way). Skip postcode-only homes. TEST jobs never call Google.
- AI photo check: TEST jobs get a stubbed verdict, never reach the gateway (same rule as `coes-check.server.ts`).
- Owner-facing texts, quick taps, reminders, batch close and installer runs: **no change**.
- Wording: never "HIV" on screen — "Home Insulation Victoria"; normal case for capitalised names (`displayName`).

## Review Focus

1. **A saved spot with no coordinates and no postcode centre** — must still appear (in "Location not known") and still be tickable. Test in Task 2 + Task 4.
2. **Jo's desk check says looks_eligible but AI says over_r2** — must stay Best, no AI tag. Test in Task 1.
3. **A Weak spot ticked and Sent** — Send must not refuse it for eligibility; it must still refuse an opted-out or already-batched home. Test in Task 3.
4. **Google Solar key missing / 404 / quota hit** — the roof check records nothing, throws nothing, and retries later; the list still loads. Test in Task 6.
5. **Listing endpoint called twice for the same home, or with a fact key not on the allow-list** — one current `listing_check` row; disallowed keys rejected with 400. Test in Task 7.

---

### Task 1: Ranking core

**Files:**
- Create: `src/lib/saved-spot-rank.core.ts`
- Test: `tests/saved-spot-rank.core.test.ts`

**Interfaces:**
- Produces:
  - `type SpotBand = "best" | "good" | "ok" | "weak"`
  - `type SpotFacts = { insulation: "none" | "present" | "unknown" | null; insulationDetail: "thin" | "loose_fill" | "patchy" | "under_r2" | "thicker" | null; deskCheck: "looks_eligible" | "pending" | "not_needed" | null; aiPhoto: "none" | "under_r2" | "over_r2" | "cant_tell" | null; propertyType: "house" | "townhouse" | "apartment" | null; topFloor: "yes" | "no" | null; areaM2: number | null; roofForm: "pitched" | "low_slope_flat" | "mixed" | null; complexRoof: boolean; tapsHatch: "yes" | "no" | "not_sure" | null; tapsRoof: "sloped" | "flat" | "some" | "not_sure" | null; listing: { found: boolean; floorPlan: boolean; type: string | null; storeys: number | null; checked: boolean } | null; lifeSupport: boolean; streetKnown: boolean; spotSavedAt: string }`
  - `spotBand(f: SpotFacts): SpotBand`
  - `spotScore(f: SpotFacts, nowMs: number): number` (higher = better, only meaningful inside a band)
  - `spotReason(f: SpotFacts): string` e.g. `"No insulation · house · ~200 m² · floor plan found · pitched roof"`
  - `spotTags(f: SpotFacts): string[]` (exact tag copy from Global Constraints)
  - `insulationDetailFromDesk(reason: string | null): SpotFacts["insulationDetail"]` — maps the stored desk reasons: contains "thin/loose-fill" → `"loose_fill"`, "loose-fill insulation only" → `"loose_fill"`, "less than R2" → `"under_r2"`, "Owner-declared existing insulation" → `null`.
  - `BAND_ORDER: readonly SpotBand[] = ["best","good","ok","weak"]`

- [ ] **Step 1: Write failing tests** — one `it` per rule:
  - `looks_eligible` → best; AI `under_r2` with desk `pending` → best + tag "AI: confirm"; desk `looks_eligible` + AI `over_r2` → best, no AI tag (Review Focus 2); AI `over_r2` with no desk check → weak + "AI: looks over R2 — confirm"; AI `cant_tell` → band from answers.
  - insulation `none` → good; `present` + `under_r2` → ok; `unknown` → ok; `present` + null detail → weak; apartment + topFloor `no` → weak.
  - Score: house > townhouse > apartment (same band, else equal); 200 m² > 100 m²; listing floorPlan true > none; roof pitched > null > low_slope_flat; tapsRoof flat < not_sure; listing storeys 2 < null; older spotSavedAt > newer (tie-break only).
  - Tags: lifeSupport → includes "Life support" and `spotBand` unchanged vs same facts with lifeSupport false; streetKnown false → "No street address"; listing.checked false → "Not checked yet"; listing type "townhouse" when propertyType "house" → `"Listing says: townhouse"`, and score lower than the same facts with no mismatch.
  - `spotReason` for `{insulation:"none", propertyType:"house", areaM2:200, listing floorPlan true, roofForm:"pitched"}` equals `"No insulation · house · ~200 m² · floor plan found · pitched roof"`.

- [ ] **Step 2: Run** `bun test tests/saved-spot-rank.core.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the functions above. Score = weighted sum; keep weights as named constants at the top so they can be tuned (house 30 / townhouse 20 / apartment 0; area ≤ 40 pts scaled by m²/5 capped; floor plan 15, listing found 5; pitched 10, flat −20; taps hatch yes + roof sloped 10, taps roof flat −20; listing mismatch −15, storeys ≥2 −10; complex roof −3; waiting days × 0.1).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(saved-spots): ranking core — bands, score, reason, tags`

### Task 2: Area grouping core

**Files:**
- Create: `src/lib/saved-spot-areas.core.ts`
- Test: `tests/saved-spot-areas.core.test.ts`

**Interfaces:**
- Consumes: `distanceM` (`geo.core`).
- Produces:
  - `type AreaHome = { jobId: string; lat: number | null; lng: number | null; suburb: string; rankKey: number }` (`rankKey` = position in the global best-first order; lower = better)
  - `type AreaGroup = { key: string; heading: string; jobIds: string[]; locationKnown: boolean }`
  - `groupByArea(homes: AreaHome[]): AreaGroup[]`
- Algorithm: same densest-first greedy as `suggestBatches` (try each located home as centre, take every untaken home within 10 km, keep the largest, remove, repeat) with **no min/max**. Homes with null lat/lng → one final group, heading `"Location not known (n)"`, `locationKnown: false`. Order groups by size desc, tie by min `rankKey`. `key` = sorted first jobId (stable).

- [ ] **Step 1: Failing tests:** every input jobId appears exactly once across groups; two homes 12 km apart → two groups; three homes within 3 km → one group; null-location home lands in "Location not known (1)" last; heading `"Rowville · Knox · Ferntree Gully (14)"` from suburb counts (3 most common, ties alphabetical); single isolated home → group of 1.
- [ ] **Step 2: Run** `bun test tests/saved-spot-areas.core.test.ts` — FAIL.
- [ ] **Step 3: Implement** `groupByArea`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(saved-spots): group saved spots into ~10 km areas`

### Task 3: Send anyone who saved a spot

**Files:**
- Modify: `src/lib/area-batch.server.ts:148-158` (the `likelyEligible` block in `batchCandidates`)
- Modify: `src/lib/area-batch.core.ts` — delete `likelyEligible`/`LikelyFacts` if no other caller remains (grep confirms only `area-batch.server.ts` uses it).
- Test: `tests/a48-b2-area-batch-core.test.ts` (remove likelyEligible tests), add `tests/saved-spots-send-anyone.test.ts`

**Interfaces:**
- Consumes: `batchCandidates`, `sendBatch` (unchanged signatures).
- Produces: `batchCandidates` no longer refuses with "its answers don't look likely eligible yet".

- [ ] **Step 1: Failing test** (same mocking style as `tests/sweep-batch.test.ts` / `tests/in-house-batch-server.test.ts`): a saved spot with insulation `present` and no detail is returned by `batchCandidates({ jobIds:[id], requireLocation:false })`; an opted-out spot is still refused with "the owner hasn't saved a spot"; a spot with an open batch is still refused (Review Focus 3).
- [ ] **Step 2: Run** `bun test tests/saved-spots-send-anyone.test.ts` — FAIL on the first case.
- [ ] **Step 3: Remove** the likely-eligible check (and the now-unused `declaredExtras`/`roof` reads it alone needed).
- [ ] **Step 4: Run** `bun run test` — PASS (update/remove the old likelyEligible assertions in `a48-b2-area-batch-core.test.ts`).
- [ ] **Step 5: Commit** `feat(saved-spots): Send any saved spot — drop the likely-eligible block`

### Task 4: To release loader carries rank, area facts and links

**Files:**
- Modify: `src/lib/installer-waiting.server.ts` (`loadInstallerWaitingList`)
- Modify: `src/lib/installer-waiting-columns.core.ts` (`InstallerWaitingRow`)
- Test: `tests/installer-waiting-rank.test.ts`

**Interfaces:**
- Consumes: Task 1 (`spotBand`, `spotScore`, `spotReason`, `spotTags`, `insulationDetailFromDesk`), Task 2 (`groupByArea`).
- Produces on `InstallerWaitingRow` (new optional fields): `band: SpotBand; score: number; reason: string; tags: string[]; lat: number | null; lng: number | null; satelliteUrl: string | null; listingUrl: string | null`. And on `InstallerWaitingList`: `areas: AreaGroup[]` (built from to_release rows only).
- Reads (batched, like the existing loader): `lead_campaign_responses` (`desk_check_status, desk_check_reason, saved_insulation`), current `property_facts` with keys `coordinates, roof_form, site_roof_risk, building_ground_footprint, listing_check, ai_photo_check`, the latest `quick_taps_answered` event details (hatch, roof), `jobs.life_support`, property `enrichment.base44.declared` / `raw.answers` (property_type, top_floor). Postcode-only homes use `postcodeCentre` for lat/lng and `streetKnown:false`.
- `satelliteUrl` = `https://www.google.com/maps/place/${encodeURIComponent(address)}/data=!3m1!1e3` only when the address has a street number; else null.

- [ ] **Step 1: Failing test** with a stubbed admin client: three rows (no insulation house 200 m²; desk looks_eligible; present no detail) → bands best/good/weak, reasons non-empty, `areas` contains all three ids once; a row with no coordinates and unknown postcode → `areas` last group "Location not known (1)" (Review Focus 1).
- [ ] **Step 2: Run** `bun test tests/installer-waiting-rank.test.ts` — FAIL.
- [ ] **Step 3: Implement** the reads and mapping.
- [ ] **Step 4: Run** `bun run test` — PASS.
- [ ] **Step 5: Commit** `feat(saved-spots): To release rows carry band, reason, tags, area groups`

### Task 5: "By area" view; remove Suggested batches

**Files:**
- Create: `src/components/portal/saved-spots-by-area.tsx`
- Modify: `src/components/portal/InstallerWaitingScreen.tsx:197-260` (view switch, default "By area"; remove `<AreaBatchSuggestions>` at line 223)
- Modify: `src/components/portal/choose-installer.tsx` (delete `AreaBatchSuggestions`), `src/lib/area-batch.functions.ts` + `area-batch.server.ts` (delete `getAreaBatchSuggestions`/`batchSuggestions` if unused after this)
- Test: `tests/saved-spots-by-area.test.tsx` (style of `tests/choose-installer-single-batch.test.tsx`)

**Interfaces:**
- Consumes: Task 4 list (`rows`, `areas`), existing `TickSendBar`, `tickableForSend`, `batchRowLine`.
- Produces: `SavedSpotsByArea({ list, ticked, onToggle }: { list: InstallerWaitingList; ticked: string[]; onToggle: (id: string) => void })`.
- Inside To release: a two-option switch **"By area" | "Table"**, default "By area"; the existing search/filter table is the "Table" option unchanged. Ticks are shared between both views and feed the existing `TickSendBar`.
- Each area: heading; then said-yes rows, waiting rows, then Best/Good/OK/Weak (band chip), each row: job number, owner, suburb, size, estimate, waiting since, reason line, tags (Life support red), Satellite link, listing link. Phone: cards; computer: rows (both required).

- [ ] **Step 1: Failing test:** renders area headings in `list.areas` order; first area shows a said-yes row above a Best row above a Weak row; a Weak row's checkbox is enabled; ticking rows from two areas shows "2 ticked" in the Send bar; "Suggested batches" text is absent; switching to "Table" shows the existing column headings.
- [ ] **Step 2: Run** `bun test tests/saved-spots-by-area.test.tsx` — FAIL.
- [ ] **Step 3: Implement** the component and the switch; delete the Suggested batches box and its now-dead server function.
- [ ] **Step 4: Run** `bun run test && bun run lint` — PASS.
- [ ] **Step 5: Commit** `feat(saved-spots): By area view on To release; remove Suggested batches`

### Task 6: Roof check (Google Solar, ranking only)

**Files:**
- Create: `src/lib/roof-check.server.ts`
- Modify: `src/routes/api/public/hooks/post-intake.ts` (after the existing sweeps: `await (await import("@/lib/roof-check.server")).roofCheckTick({ limit: 5 }).catch(() => {})`)
- Test: `tests/roof-check.test.ts`

**Interfaces:**
- Consumes: `runSolar`, `providerConfigFromEnv`, `defaultProviderHttp` (`providers.gather.ts`); `ensurePropertyCoordinates`.
- Produces: `runRoofCheck(jobId: string, http?: ProviderHttp): Promise<"done" | "skipped" | "failed">`; `roofCheckTick(opts: { limit: number }): Promise<{ done: number; failed: number }>`.
- Picks saved spots (`stage = ready_check_ready_to_schedule`, `spot_saved_at` set, not opted out, street address known, not `qa_test`) with **no current `roof_form` fact**, newest saved first. Writes only `roof_form`, `site_roof_risk`, `building_ground_footprint`, `solar_summary` facts (supersede old current rows for those keys only). Logs one `roof_checked` workflow event (internal). Never imports `eligibility.server` or `postintake.server`.
- A failed lookup (no key, non-200, timeout) writes a `roof_check_failed` event with the reason and is retried at most once a day (skip if a `roof_check_failed` exists in the last 24 h).

- [ ] **Step 1: Failing tests** with a fake `ProviderHttp`: success → 3 facts written, `jobs` not updated; HTTP 404 → `"failed"`, no facts, no throw (Review Focus 4); missing key → `"skipped"`; postcode-only home → not picked; TEST job → not picked; second tick within 24 h of a failure skips it.
- [ ] **Step 2: Run** `bun test tests/roof-check.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run test` — PASS.
- [ ] **Step 5: Commit** `feat(saved-spots): roof check from Google Solar for saved spots (ranking only)`
- [ ] **Step 6 (Jo, after merge):** in Google Cloud › Google Maps Platform › Quotas, set Solar API Building Insights to **300 requests/day**. Check `GOOGLE_SOLAR_API_KEY` is set in the Lovable project secrets.

### Task 7: Listing facts endpoint (for Claude's nightly check) + load last night's results

**Files:**
- Create: `src/routes/api/public/hooks/listing-facts.ts`, `src/lib/listing-facts.core.ts`, `src/lib/listing-facts.server.ts`
- Test: `tests/listing-facts.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/public/hooks/listing-facts?limit=N` (cron-secret Bearer, `authenticateCronRequest`) → `[{ jobId, jobNumber, address, suburb, postcode }]` in spec order: saved spots with a street address and no current `listing_check`, newest spot first for spots saved in the last 2 days, then by band Best → Weak (Task 1 `spotBand`), then oldest saved first.
  - `POST /api/public/hooks/listing-facts` body `{ results: ListingResult[] }`, where `type ListingResult = { jobId: string; status: "found" | "not found"; url: string | null; source: string | null; floorAreaM2: number | null; landM2: number | null; storeys: number | null; beds: number | null; yearBuilt: number | null; hasFloorPlan: boolean | null; propertyType: string | null; roof: string | null }`. Writes one current `property_facts` row `fact_key = "listing_check"`, `source_type = "listing"`, value = the result (supersedes the previous current row). Rejects any extra keys with 400; never touches other tables.
  - `listingResultValid(x: unknown): x is ListingResult` in the core.
- Task 1's `SpotFacts.listing` reads this value (`checked: true`, `found: status === "found"`).

- [ ] **Step 1: Failing tests:** POST twice for one job → exactly one current `listing_check` (Review Focus 5); body with `{ jobId, status, foo: 1 }` → 400; GET orders a 1-day-old Weak spot before an old Best spot, and an old Best before an old Weak; a home with a current `listing_check` is not returned; no Bearer → 401.
- [ ] **Step 2: Run** `bun test tests/listing-facts.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run test` — PASS.
- [ ] **Step 5: Commit** `feat(saved-spots): listing facts endpoint for the nightly check`
- [ ] **Step 6 (after deploy):** read last night's results from the "saved spots ranked" artifact (`73e4d32e-3f2c-4108-b086-c7722d4cb1d6`, the `res` field per spot), map them to `ListingResult` (only `status` found / not found; skip "not searched"), POST them in batches of 50. Report the count written.

### Task 8: AI photo check

**Files:**
- Create: `src/lib/photo-check.core.ts`, `src/lib/photo-check.server.ts`
- Modify: `src/lib/owner-capture.server.ts:112-113` (after `markCampaignMediaReceived`: `void (await import("./photo-check.server")).checkOwnerMedia(jobId).catch(() => null)`)
- Modify: `src/routes/api/public/hooks/post-intake.ts` (`photoCheckTick({ limit: 2 })` after the roof tick — clears the 66 waiting, then anything a failed run left)
- Test: `tests/photo-check.test.ts`

**Interfaces:**
- Consumes: the gateway setup from `coes-check.server.ts` (`createOpenAI` with `https://ai.gateway.lovable.dev/v1`, same model), `documents` rows `kind = "intake_media"` in bucket `job-files`.
- Produces:
  - Core: `PHOTO_CHECK_PROMPT` (asks for strict JSON `{ verdict: "none" | "under_r2" | "over_r2" | "cant_tell", reason: string }`, reason ≤ 120 chars, "loose-fill, thin, patchy, sparse or perished counts as under_r2"); `photoVerdictFrom(text: string): { verdict, reason }` (anything unparsable → `cant_tell`).
  - Server: `checkOwnerMedia(jobId: string): Promise<"done" | "skipped" | "failed">` — sends up to 4 most recent media files as file parts (videos included; if the gateway rejects a file type → `cant_tell`), 40 s timeout; writes one current `property_facts` row `fact_key = "ai_photo_check"`, `source_type = "ai"`, value `{ verdict, reason, document_ids, checked_at }`; logs `ai_photo_checked` (internal). Skips if the latest media is older than the current `ai_photo_check`. TEST jobs → stub verdict `"under_r2"`, no gateway call. Never writes `lead_campaign_responses`, `jobs` or messages.
  - `photoCheckTick(opts: { limit: number })` — saved spots with `media_received_at` set and no current `ai_photo_check`, oldest media first.

- [ ] **Step 1: Failing tests:** `photoVerdictFrom` parses each verdict and returns `cant_tell` for junk; `checkOwnerMedia` on a TEST job writes the stub and never calls the gateway (spy); gateway timeout → `"failed"`, nothing written, no throw; `desk_check_status` row unchanged after a run; re-run with no newer media → `"skipped"`.
- [ ] **Step 2: Run** `bun test tests/photo-check.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run test` — PASS.
- [ ] **Step 5: Commit** `feat(saved-spots): AI photo check on owner uploads`

### Task 9: Ship, nightly scheduled task, QA

- [ ] **Step 1:** Whole-branch review (`superpowers:requesting-code-review`), fix findings, `bun run test && bun run lint && bun run build` all pass.
- [ ] **Step 2:** Push branch `feat/saved-spots-by-area`, open the pull request (body per repo PR rules). **Stop — Jo chooses who merges.**
- [ ] **Step 3 (after merge + publish):** QA in the running portal with the TEST office login: To release opens By area; a Weak TEST spot and a TEST spot from another area can be ticked and Sent to a covering TEST installer; Table view still works; Suggested batches gone.
- [ ] **Step 4 (after merge):** run Task 7 Step 6 (load last night's results).
- [ ] **Step 5 (after merge):** create the nightly scheduled task (name "Saved spots listing check", ~11:40pm Sydney, cloud). Its prompt: GET the queue (limit 40) with the cron secret; for each address, search for a listing of that exact house (max 3 searches, never owner names, never guess numbers, only what the page says); POST results; message Jo only if the endpoint errors.
- [ ] **Step 6:** Tell Jo in one line what's live and that the Google daily cap (Task 6 Step 6) is hers to set.
