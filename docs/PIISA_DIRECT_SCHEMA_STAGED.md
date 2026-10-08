# PIISA published direct fields — verified revision 18

Read-only GET through the existing Mitti integration confirmed master `template_f6a2597479164eb181453eb335ce5125`, revision `18-4e68255daacb467ebea71cedbb81ce56`. The reduced full definition is registered in `piisa-direct-published.data.json`; items, labels, types, conditional rules, mandatory flags and page order are pinned. Any change pauses the direct mapping.

- Eight direct crew name/certificate IDs match readback; four obsolete chooser IDs are absent. Lead fields required; additional names optional with certificates conditional on a name. Prefill uses the assigned company's verified roster only; unknown or mismatched entered name/CII blocks verification.
- Product photo remains `0a587e0e-9787-464e-be40-7cdd2c636b87`, first in Part 7. Typed product prompt is absent. After-work media is only completed video and final plan. Sixteen STOP instructions remain, including the exact household action.
- Readback also revealed a NEW signature ID `83caffa2-e9c8-4315-885f-5337a4389372` and only “Installation date”; removed completion/name/date fields are not prefilled. Historical audits keep their own crew/signature shape.
- Portal aliases/UI now use Jo's short eight evidence sentences plus “Unclear or incomplete evidence may be rejected by the Essential Services Commission (ESC).” Actual readback confirms all eight short labels match exactly; no remote label edit was performed. The before-video ID is actually `49c8ef21-dd6a-41e0-a4ae-acb0c53e7ada` and additional installer 3 name is `1bc12288-7517-4d43-a1b3-c2235ae250dc`; observed IDs override transcription differences.
- Same-audit original label bytes are copied idempotently to private product evidence on the existing sync path. Changed bytes invalidate review; unmatched or missing photos fail closed. Existing office Verify confirms brand/model/R and final-plan installed area. Quote products and pre-install measurements never substitute for installed facts.
- Verified product answers populate the unchanged original official Part 7. Missing review/area, mismatched photos or failed Part 7 filling blocks final declaration. Subsequent sync and AP gates recheck product review without rewriting historical signed records.

No real audit creation, signing, worker approval, communications, database migration or portal publication performed. Only isolated mocked persistence tests run.

Validation: 124 focused checks pass in ten isolated files, including real-original Word Part 7 rendering and mocked same-audit photo idempotence/invalidation. Latest preview build OK. An inadvertently broad test runner was stopped at timeout; it reported unrelated pre-existing failures and is not claimed passed.
