# Mitti bridge correctness fix

## Scope
Change only `src/lib/mitti.core.ts` and focused Mitti regression tests. No templates, records, settings, workflow, pricing, email, Base44, deployment, or delivery changes.

## Implementation
- Require nonblank `jobNumber`, `address`, `ownerName`, and `assessorName` before creating an audit.
- Resolve prefill fields by exact normalized label first; allow prefix fallback only when it produces exactly one candidate. Report missing or ambiguous required mappings and block audit creation.
- Replace permissive substring number extraction with strict finite parsing. Accept safe legacy numeric forms such as `R1.5`, currency formatting, and explicit units only when the whole value is valid.
- Reject negative physical values and fractional counts; never round counts into integers. Add review issues for malformed, negative, or fractional supplied values rather than silently coercing them.
- Detect repeated candidate area fields. Never use a repeated-zone value as a whole-house aggregate and never sum zones without a validated aggregate field/schema; leave area unset and add an office-review issue.
- Treat “No rectification required” as a preliminary B1 result only. Do not set imported `piesa_outcome` to `pass`; leave PIESA clearance pending for the existing authoritative process. Preserve explicit rectification-required failure where safe.
- Preserve raw snapshots and existing non-completing sync behavior.

## Validation
- Add focused regressions for blank required prefill values, ambiguous prefix mappings, repeated-zone areas, malformed/negative measurements and R-values, fractional/negative counts, and incomplete B1 clearance.
- Update the directly affected scope regression so imported “No rectification required” remains pending.
- Run focused Mitti/scope tests and TypeScript validation only.

## Remaining limits to report
- Draft template structures remain unverified and inactive.
- Repeated-zone values are intentionally not aggregated until a validated zone schema/boundary exists.
- Imported B1 data cannot establish an authoritative PIESA pass.
