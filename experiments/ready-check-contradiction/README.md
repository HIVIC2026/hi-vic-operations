# Ready Check contradiction spike — sample only

No app route, production caller, blocking gate, database access, integration call or notification is added. Existing partial-inspection quoting and parser labels/mappings are unchanged. No standalone demo screen was added: tests exercise the isolated function instead.

## Real-data adapter

`validator.ts` accepts `ReturnType<typeof parseAudit>` by a type-only import. Tests pass synthetic `item_id`, `parent_id`, `responses.selected[{label}]`, `inactive` records through the existing `src/lib/mitti.core.ts` parser; they do not claim these are live inspections.

The parser exposes active repeated `areas` with `key`, `label`, `present`, `rValue`, `rValueBand`, an active-answer `snapshot`, and `modifiedAt`. The spike reads the exact final outcome from that snapshot and checks **every** active area, not `patch.existing_r_value` (which records the minimum). It does not filter out garages/other active areas for this narrowly requested contradiction rule.

Existing `ready-check-answers.core.ts`, `ready-check-complete.core.ts`, and `mitti-complete.core.ts` already check eligibility/completion; none is changed or called as a new gate.

The parser maps `Above R2.0` to `at_or_above_r2`; this loses the distinction between an above-only answer and an inclusive band. The spike treats that answer as disqualifying but does **not** claim it captures R2.0 equality. Numeric R2.0 is tested separately. Missing/unknown R or insulation presence cannot yield `no_contradiction`.

## Freshness and limitations

Freshness is a mandatory explicit experiment input: `current`, `stale`, `unsynced`, or `unknown`. No freshness interval is invented. Only `current` may return `no_contradiction` or `already_failed`; stale/unknown results retain known contradictions but include an unable-to-verify note. Even `no_contradiction` is not clearance, eligibility or permission to quote.

Repository source has a GET audit reader, modified timestamps and stored sync status/time/error paths. These are available integration mechanisms, **not proof** that a phone's unsynced edits are available. No live payload, API capability, current template, credentials or phone behaviour was checked in this experiment. The snapshot drops parent IDs, so per-area raw band text cannot safely be reconstructed from repeated snapshot labels alone. Grouping relies on the current parser's area-name/measurement detection; a completely unnamed/unmeasured repeat can be omitted by that parser. Live use needs explicit completeness/expected-area coverage before trusting that list.

## Before live “Check before leaving”

- Agree and approve the correction wording and whether/where Mitti can present it; this repository spike shows no live UI.
- Verify a supported read-only way to obtain the latest onsite edits, sync acknowledgement/revision and expected active repeat count. Treat offline, missing, failed and stale reads as unable to verify.
- Verify audit/job/template identity and authorized access; preserve area-instance identity and raw R answers if distinguishing exact band wording is needed.
- Test with authorized TEST inspections on real phones: second-area contradictions, hidden branches, changed answers, partial repeats, offline edits, resync and repeated/out-of-order responses.
- Keep it advisory unless a separate workflow change is explicitly authorized; retain partial-inspection quoting policy and existing guards.

Sample command: `bun test tests/ready-check-contradiction-spike.test.ts`.