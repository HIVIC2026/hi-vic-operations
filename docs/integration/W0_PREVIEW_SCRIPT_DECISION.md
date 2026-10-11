# W0 decision — scripts.preview (Phase 1 urgent integration)

Keep baseline `"preview": "vite preview"` on `phase1-urgent-integration` for LOCAL QA on isolated Supabase.

Delivery variant (production Cloudflare preview), recorded for the DEPLOY stage only — NOT applied here:
    "preview": "npx --yes wrangler@4.149.0 dev .output/server/index.mjs --config .output/server/wrangler.json"

Rationale: the wrangler variant needs a built `.output/` and targets Cloudflare runtime; deploy is out of scope.
The `demo` script from Delivery is out of urgent scope and is intentionally NOT imported.
Decision owner: W0. Final preview-script choice to be confirmed by Jet at deploy time.
