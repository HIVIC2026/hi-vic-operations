# Install day form — old build prompt (superseded)

**Superseded (24 Oct 2026, decisions 260–266).** The install day form is now a NEW Mitti template, `A3 – Install day`,
built from `docs/MITTI_INSTALL_FORM_FIX_PROMPT.md` — that file is the only build prompt. Its wording is fixed in
`src/lib/install-day.core.ts` and `tests/install-day.test.ts` fails if the two drift apart.

What moved where:

- **Safety plan (SWMS):** not on the form. The portal writes it from job facts and the crew sign it on the installer's
  job page (decision 261, `src/lib/swms.core.ts`); the pre-start check blocks until it is signed. The form only asks
  "Is the safety plan for this job signed?".
- **Before-work videos:** taken per ceiling area at the Ready Check (decision 264, Ready Check prompt Q27).
- **After-work evidence:** two multi-file items on the install day form (after videos, depth photos), at least one file
  per Ready Check area (decision 263).
- **Per-area product and m²:** the Ready Check record (decision 263).
- **Official PIISA Part 5 lights / cables / downlights:** filled from the job's signed PIESA (decision 262).
- **Official PIISA Part 6 existing insulation:** filled from the Ready Check record (decision 262).

The old "A3 - PIISA + AP Evidence" template keeps working for forms already completed on it: its wording stays readable
as aliases in `src/lib/piisa-a3.core.ts` and `src/lib/install-evidence.core.ts`.
