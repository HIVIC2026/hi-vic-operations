# Bulk-import owner journeys

## Build
- Replace direct stage placement with two guarded import journeys: Ready Check for “Not visited”, and quote-first for “Visited” or “Quoted”. Keep “Installed” as retained history outside live work.
- Create one secure owner journey link per confirmed row. It will show the installer introduction, confirm owner/property details, capture the required commercial consent/signature, then branch to Ready Check times or the existing quote and booking screens.
- Queue—not send—the initial owner email/text and day 2, 5, and 10 reminders. At day 14 without a response, surface an office Needs me item.
- Restrict Ready Check and installation offers to the originating installer. Preserve the selected electrician’s exclusive safety-check route with no automatic fallback.
- Show the exact waiting party and current step in installer My work, and derive the matching office Pipeline status.

## Validation
- Extend practice-database tests for journey state, immutable attribution, queued messages, reminder dates, signed-consent blocking, and exclusive offers.
- Extend Scenario E to cover both journeys across owner, installer, electrician, and office views using TEST data only.
- Check the owner and trade screens at 390px, run focused tests and type checks, and confirm the preview build is healthy.

## Safety
- Preview only. No publishing, outgoing messages, switch changes, or writes to real jobs.
- Existing quote release, payment, PIESA, evidence, and workflow gates remain authoritative.
- The official Activity 48 VEEC assignment remains post-install; the owner’s early signature is the existing commercial acceptance/consent, never a premature final assignment.
