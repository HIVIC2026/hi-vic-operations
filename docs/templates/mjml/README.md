# Portal email designs (MJML)

These are the MJML email refresh drafts of 27 Oct 2026. Jo did NOT approve them: every email with a picture in `docs/designs` follows her design (`docs/templates/owner|installer|electrician|invoices/*.html`), not these files. One file per email, named `<who>_<code>.mjml`, filled with TEST sample data. `notes/` says what changed from the old design.

- The live emails are built by each renderer in `src/lib/*` through `mjEmail` (`src/lib/mail-mjml.core.ts`), which compiles with `src/lib/mjml-lite.core.ts` (the server runs on Cloudflare, where real MJML can't run).
- `bun scripts/check-mjml-lite.ts` proves `mjml-lite` gives the same HTML as real MJML 5 for every file here.
- To preview with real MJML: `npm i -D mjml@5` in a scratch folder, then `node build.mjs` here (writes `dist/`).
- Shared look: `partials/head.mjml` (classes), `partials/header.mjml`, `partials/footer-owner.mjml` / `footer-trade.mjml`. Change `mjml-lite.core.ts` to match if you change these.
