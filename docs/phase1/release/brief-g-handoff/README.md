# Brief G handoff — ready-to-paste copies of the integrated UI fix

These files are **exact copies** of the files on branch `r1/brief-g-preview-integration`
(commit created by cherry-picking `98c16685` onto `origin/main` @ `79d7e6fb`).

They exist for one reason: if the owner prefers to apply the fix by pasting into the
Lovable editor instead of pushing to GitHub, these are the two files to paste.

| File | Pastes over | MD5 |
| --- | --- | --- |
| `choose-trade.tsx.txt` | `src/components/portal/choose-trade.tsx` | `d65b2c25b771de1a019c45d78beae21a` |
| `mitti.tsx.txt` | `src/components/portal/mitti.tsx` | `1e1ce0cdf1eb75b51b97d142103d3800` |
| `PATCH.diff` | unified diff against `origin/main` (reference only) | — |

The `.txt` suffix is deliberate: `tsconfig.json` only includes `src/**/*.ts(x)`, so a copy
under `docs/` can never be type-checked, bundled or shipped by accident. Strip the
suffix when pasting.

## What changed (and what did not)

Only two files change. Nothing else in the repository is touched.

- `choose-trade.tsx` — adds `const [err, setErr] = useState<string | null>(null)`,
  clears it at the start of each attempt, stores the failure message in `catch`, and
  renders it as `<p role="alert">` above the Send button. The existing `toast.error`
  call is **kept**.
- `mitti.tsx` — replaces `useAction(...)` with `useServerFn(...)` for the three Mitti
  calls, so the failure message is no longer swallowed by `useAction`'s internal
  `catch`. Adds the same `err` state and `<p role="alert">`. Success toasts and
  `invalidateQueries()` behaviour are preserved.

Backend functions, guards, RLS, auth, assignments, business rules, external
integrations and the database schema are untouched.

## Verification already done on this exact content

- `npx tsc --noEmit` → exit 0, no output.
- `bun test tests/brief-e-silent-action-feedback.test.tsx` → 5 pass / 0 fail.
- `bun test tests/offer-dispatch.test.ts` → 6 pass / 0 fail.
- `bun test tests/mitti.core.test.ts` → 27 pass / 0 fail.
- `bun test tests/t3-mitti-async-claim.test.ts` → 19 pass / 0 fail.
