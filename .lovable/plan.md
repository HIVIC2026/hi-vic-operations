# Verify Mitti pickup addresses

## What's happening now
When an installer starts a Ready Check in Mitti, the portal creates the job using the address exactly as the installer typed it. The portal already has an automatic address check for website and email enquiries, but it skips Mitti jobs. That's why HV-3722 was saved as "9 shelley St spring gully", with no suburb or postcode.

## 1. Where the check runs
- Straight after the job is created from Mitti, before the Ready Check form is linked to it.
- It uses the same check and the same rules as the website enquiry check (search, then details, Victoria only). It doesn't add a second set of rules.
- If the address service is slow or down, the job is still created with the typed address and the check is tried again later. **The pickup is never blocked.**
- The save goes through the normal recorded path, so the job history shows what changed, when, and the address it came from.

## 2. What counts as a confident match
All of these must be true (these are the existing enquiry rules):
- The lookup finds exactly one address that fits.
- It's in Victoria, with a street, suburb and 4-digit postcode starting with 3.
- The house number matches what was typed, the street name agrees, and the suburb agrees if one was typed. Capitals don't matter, so "spring gully" matches "Spring Gully".
- The verified version replaces the typed address: street (correct capitals), suburb, postcode and state.

## 3. When there's no confident match
- The typed address stays as it is.
- The job gets an office flag, "Address to confirm", in Needs me. The flag shows the possible matches the lookup found, if any.
- The flag clears once the office saves a full Victorian address on the job.
- Nothing is sent to anyone and the job's stage doesn't change.

## 4. Fixing existing picked-up jobs
I checked the live data (read-only). Four jobs have been picked up from Mitti:

| Job | Saved now | Plan |
|---|---|---|
| HV-3722 | 9 shelley St spring gully (no suburb or postcode) | Run the check once. Expected result: 9 Shelley Street, Spring Gully VIC 3550, if Google confirms one match. Otherwise flag it "Address to confirm". |
| HV-3121 | 1 Test Street, Testville 3999 | Leave as is (old test record). |
| HV-3129, HV-3134 | E2E test streets, Reservoir 3073 | Leave as is (TEST jobs). |

Changing HV-3722 is a live data change, so I'll do it only after you approve it separately. I'll show you the exact result before saving it.

## 5. Tests (written first)
- A typed address with wrong capitals and no suburb or postcode, with one Victorian match: the verified street, suburb, postcode and state are saved.
- Several possible matches, a non-Victorian match, or a different house number: the typed address is kept and "Address to confirm" is flagged.
- The address service times out or errors: the job is still created and linked, and a retry is recorded.
- A repeat pickup or retry doesn't flag the job twice or overwrite an address the office has already fixed.
- The flag clears once a full address is saved.
- TEST jobs use a pretend address service, so no real lookup happens.
- Then the related tests and the full comparable test run.

## Technical details
- In `mitti-pickup-auto.server.ts`, after `upsertEnquiry`, call the existing `resolveAddress` from `address-complete.server` with `serverAddressLookup`. Save through `saveEnquiryDetails` and record `address_completed` or `address_lookup_unresolved` with `needs_office`.
- Let the 15-minute address sweep also include `installer_mitti` jobs at the Ready Check stages, using the same 7-day once-only rule.
- Add the "Address to confirm" Needs me row to office-needs, driven by `address_lookup_unresolved` while the address is still incomplete.
- No database changes and no new settings.
