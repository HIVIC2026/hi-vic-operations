# Official-form approval gaps

Review date: 20 October 2026. Internal review note; no approval, mapping or portal changes made.

## Current draft state

The following versions and flags come from the prior read-only database evidence supplied for this review:

| Draft | Recorded version | Active | Approved |
| --- | --- | --- | --- |
| Installer post-installation declaration | `DEECA-PIISA-March-2026-DRAFT` | `true` | `false` |
| Final Activity 48 VEEC assignment | `Activity48-VEEC-Assignment-v16-DRAFT` | `true` | `false` |

Active selection does not establish approval.

The following row identities were subsequently verified by a read-only query on 20 October 2026. SHA-256 covers the exact stored body text, not a rendered document or the complete template record. Both rows have `form_fields = []`; any code-derived prefill still requires the source/evidence mapping review below.

| Draft | Row ID | Stored body SHA-256 |
| --- | --- | --- |
| `Activity48-VEEC-Assignment-v16-DRAFT` | `a3c1b3e5-b40b-414d-9359-05b529c45790` | `f9457bcd31d73b102aebb2bcb03c37e08012ea1c150cd9e44ab7eb5b83a6779f` |
| `DEECA-PIISA-March-2026-DRAFT` | `774b1a70-2b0d-4249-b455-317b8ddb0f05` | `09a8da4286a3f4e9640944b778e1974310d53d70671647569dde3575e2b81d99` |

## Verified primary sources

- **DEECA, Pre-installation installer safety assessment (Insulation)**, dated **March 2026** on page 5: https://www.energy.vic.gov.au/__data/assets/pdf_file/0029/783380/VEU-pre-installation-installer-safety-assessment.pdf
  - Page 1 requires completion before installation. Part 8, on page 4, records the lead installer's pre-installation declaration about the assessment, safe working arrangements, intended installation compliance and checks at the start of additional installation days. It contains installer name, signature and date. It does not attest that installation has been completed.
- **DEECA, Ceiling insulation requirements for industry**, page last updated **15 October 2026**: https://www.energy.vic.gov.au/victorian-energy-upgrades/installers/insulation-requirements-for-industry
  - Places PIISA under pre-installation requirements and directs providers to the ESC ceiling-insulation activity resources.

## Source not yet verified

Prior indexed ESC update: **Stage two of VEU ceiling insulation activity starts 1 October 2026 — updated requirements for accreditation**:

https://www.esc.vic.gov.au/victorian-energy-upgrades/updates-reports-reviews-and-data/updates-veu-program/stage-two-veu-ceiling-insulation-activity-starts-1-october-2026-updated-requirements-accreditation

The indexed update is a retrieval lead. Direct retrieval of the current ESC activity page and the linked release page returned HTTP 404 in this review, although search still indexes the activity page and its 1 October assignment-form entry. The exact current official assignment's title, edition, body, effective date and signature requirements remain unverified. The portal label `v16` is not proof of equivalence to the current ESC form.

## Required before AP approval

**Installer post-installation draft:** identify and record the authoritative basis for a separate completed-work declaration, then review the exact wording. The March 2026 PIISA and its Part 8 cannot alone substantiate this draft's post-installation purpose. Validate every completion statement against actual job facts and linked evidence; predicted dates or proposed products must not become assertions of completed work. Confirm the signing installer's identity, authority, required timing and the evidence retained with the signed record.

**Activity 48 assignment draft:** obtain the current official assignment and applicable ESC activity guidance. Record source URL, document title, edition/date, stated applicability, retrieval date and original-file SHA-256. Compare the specific portal draft item by item, including declarations, required fields, instructions, notices and signature blocks. Confirm authorised signers, sequence and timing from that source; the portal's existing installer → AP → homeowner sequence still requires validation.

**Both drafts:** use the verified row IDs and stored-body hashes above to identify the drafts, complete a field-to-source/evidence mapping, and inspect a rendered signed example. Missing or stale required facts must block signing. Bind AP approval to the exact reviewed version and content, preserving earlier signed records unchanged. Keep both drafts unapproved until these checks are complete.
