# P1-R3-S70 — Tracked Environment Files: Security Audit & Safe Remediation

**Project:** Home Insulation Victoria · **Phase:** 1 · **Round:** RC1
**Step:** P1-R3-S70-TRACKED-ENV-SECURITY-AUDIT-01 · **Executor:** R3 · **Date:** 2026-10-15
**Priority:** P1 — Security Hygiene

> No secret values appear in this report. All inspection was read-only. No production credentials were rotated or revoked; no Git history was rewritten; nothing was pushed or deployed.

---

## 1. Scope & method

Read-only Git inspection of tracked environment files across **all local branches**, value-redacted key-name and value-*shape* classification (never the value), full-history blob scan for privileged key names, and static code analysis of how configuration is loaded. Validation limited to local Bun tests / TypeScript; **never run against production**.

## 2. Findings

### 2.1 Tracked env files
- **`.env` is tracked**, and it is present on **all 46 local branches** (identical blob) — including `main`, `release/p1-rc1`, `release/p1-rc1-com04`, and all `w*/`, `r*/`, `qa/`, `integration/` branches.
- **`.gitignore` contains no `env` rule** → nothing prevents `.env` from being (re)committed.
- **No `.env.example`/sample** existed prior to this task.

### 2.2 Contents of tracked `.env` (key names only; values redacted)
| Key | Nature |
|---|---|
| `SUPABASE_PROJECT_ID` / `VITE_SUPABASE_PROJECT_ID` | Public project reference |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | Public hosted Supabase project URL (`https://<project-ref>.supabase.co`) |
| `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable (anon) key — public by design, RLS-gated |

- **No** `service_role`, `anon` secret JWT, `_SECRET`, `SERVICE_KEY`, `sk_live`/`sk_test`, `password`, or `private_key` entries are present in the tracked `.env`.
- Value-shape probe: only URL-shaped and short opaque/publishable values; **no JWT (`eyJ…`) or secret-key-prefixed values**.

### 2.3 Where privileged secrets actually come from (code analysis)
Privileged credentials are read **exclusively from the process environment**, never from the tracked `.env`, and the server **fails closed** if they are absent:
- `src/integrations/supabase/client.server.ts` → `process.env['SUPABASE_SERVICE_ROLE_KEY']` (throws "Missing Supabase environment variable(s)" if unset).
- `src/integrations/supabase/cron-auth.ts` → `process.env['LOVABLE_CRON_SECRET']`, `LOVABLE_CRON_SECRET_PREVIOUS`.
- Browser/SSR client reads only the **publishable** vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) — public by design.

### 2.4 Git history
- Exactly **one** distinct `.env` blob has ever existed (single commit `652df004 "Changes"`).
- A scan of **all** historical `.env` blobs found **no** privileged key names. → **No evidence that a real secret was ever committed and later removed.**

### 2.5 Tooling default-load behaviour
- Vite auto-loads `.env`; `VITE_`-prefixed vars are **inlined into the client bundle by design** (acceptable only because they are publishable/public). Server reads via `process.env`.

## 3. Risk classification

**PUBLIC_CONFIGURATION_ONLY** — the tracked `.env` contains only public/publishable Supabase configuration. A public Supabase URL + publishable anon key is **not** equivalent to a leaked service-role key, and no privileged credential is present in the working tree or in history.

- Production URL present: **YES** (public by nature).
- Real/privileged secrets present (tree or history): **NO** (service-role & cron secrets are environment-only).
- Git history exposure of secrets: **NO** (single clean blob, no privileged names ever).

**RISK_LEVEL: LOW.** This is a **hygiene** issue, not a credential leak. Residual risk: because `.env` is tracked and un-ignored, a future contributor could accidentally add a real secret to the already-tracked file and commit it. The remediation below closes that gap.

## 4. Affected branches
All 46 local branches carry the identical public-config `.env`. No branch carries a privileged secret. (Branch list captured in audit; omitted here for brevity.)

## 5. Safe remediation plan (prepared; non-destructive)

**Prepared artifacts (committed locally with this report):**
1. **`.env.example`** — safe template documenting the public vars and explicitly marking `SUPABASE_SERVICE_ROLE_KEY` / `LOVABLE_CRON_SECRET(_PREVIOUS)` as **server-side-only, never committed**.
2. **Proposed `.gitignore` patch** (`docs/phase1/security/S70_gitignore_proposed_patch.txt`): add `.env`, `.env.*`, `!.env.example`.

**Owner-gated step (NOT performed automatically — startup-dependency decision):**
- Untrack the committed public `.env` via `git rm --cached .env` **after** confirming CI / Lovable Cloud / sibling worktrees can obtain the public vars from `.env.example` + environment. (Non-breaking on disk; keep the file locally.)

**Secret scanning recommendation:** add a pre-commit hook / CI secret scanner (e.g., gitleaks or `git-secrets`) blocking `*_SERVICE_ROLE_KEY`, JWT (`eyJ`), and `sk_` patterns, plus any `.env` not matching the ignore rule.

**Credential rotation inventory:** **Not required** — no real secret was exposed. (If the owner nonetheless wishes precautionary rotation of the publishable anon key, it is low-impact and non-privileged; the service-role key was never exposed.)

**Git history remediation:** **Not required** for secrets. If the owner later wants the public `.env` purged from history for cleanliness, that is an optional, coordinated `filter-repo`/BFG operation — **out of scope here** (would rewrite shared history; explicitly not authorized).

**Agent/worktree migration guidance:** new worktrees should copy `.env.example`→`.env` locally and export server secrets via environment; do not re-commit `.env` once the ignore rule lands.

## 6. Validation evidence
- **Bun tests:** representative suite green with current config — `tests/jo-email-templates.test.ts` **31 pass / 0 fail**. The publishable vars remain resolvable; no test depends on a privileged secret being in `.env`.
- **TypeScript:** project `tsc` behaviour unchanged (audit added no code; `.env.example` is non-code).
- **Build / local Supabase:** publishable config (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`) continues to resolve from `.env`/env; `.env.example` mirrors the exact variable names Vite/SSR expect, so local builds and local Supabase remain functional.
- **COM-04 safety guards:** **unaffected** — `customer_comms_enabled` / `save_my_spot_real_send_enabled` are read from `workflow_settings` (DB, default locked), **not** from env. The audit changes no send path.

## 7. Required owner actions
1. Approve applying the `.gitignore` additions.
2. Decide on the `git rm --cached .env` untrack step after confirming startup dependencies.
3. (Optional) enable the recommended secret-scanning pre-commit/CI hook.
4. (Optional, low priority) precautionary rotation of the publishable anon key — not security-required.

## 8. Commit
Local commit only (branch `r3/p1-rc1-com08-templates`). Not pushed, not merged. SHA recorded in the final response.
