# Fix signed installer visibility and REC address selection

## Goal
Make signed installer applications reliably visible in the office review queue, and make both REC address fields retain a tapped verified address on desktop and mobile.

## Changes
- Correct the office partner list classification/filtering so a signed installer application with `status = new` and source `portal_installer_onboarding` appears under **Review queue → Installers → Onboarding form (signed application)**.
- Remove duplicate office action entries for the same signed application while retaining one clear review action linked to its enquiry.
- Extract the duplicated REC/installer address picker into a shared tested component without changing address validation rules.
- Fix selection ordering so the picker marks a selection in progress before blur, prevents stale search/detail responses from reopening or clearing it, always releases the selection lock, and preserves unit/house numbers.
- Show provider failures without accepting free text as a verified address.

## Verification
- Add regression tests for office classification and signed-application visibility.
- Add mounted interaction tests for mouse/touch selection, blur ordering, stale async responses, provider failure, replacement, and number retention.
- Verify saved/resumed REC business and service-origin selections, desktop and phone rendering, focused tests, type checks, wording scan, and preview build.
- Do not sign, approve, reset, email, or alter any real application.

## Constraints
- Preserve the already-applied installer signing hotfix and all signed records.
- These fixes are newer than deployment `bca6021e-a3e7-4af0-b138-367ecaf7c130`; do not attribute them to that deployment.
- Do not publish unless separately requested after verification.
