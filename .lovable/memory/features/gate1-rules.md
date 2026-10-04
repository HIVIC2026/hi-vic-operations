---
name: Gate 1 rules
description: Gate 1 eligibility rules — min building age 5 years; previous-upgrade and occupancy homeowner questions RETIRED 4 Oct 2026
type: feature
---
Gate 1 rules:
- Minimum building age 5 years for the relevant ceiling.
- RETIRED (4 Oct 2026, Jo's instruction): the homeowner questions "previous VEU ceiling insulation upgrade" and "rented vs owner-occupied" are deleted. The portal no longer asks, displays, or decides on them. Only confirmed previous Activity 48 evidence (properties.enrichment.previous_activity_48_confirmed) can fail the previous-activity rule; otherwise it passes. Occupancy is no longer reported in Gate 1 results. Historical stored answers remain in the database untouched.
- Supersedes the 3 Oct "previous-upgrade Yes → office review" rule.
- LOCKED phrases (4 Oct, Jo-accepted): "No confirmed previous Activity 48 for the same ceiling area" (pass) and "Previous Activity 48 for the same ceiling area confirmed" (fail). Always "same ceiling area", never "at the premises" — a record for a different ceiling area must not be described as premises-wide.
- Office-only prior-Activity-48 check on the Verified Eligibility card: three options (no confirmed evidence / confirmed same ceiling area / confirmed different ceiling area only); confirmed options require a note; missing check blocks Verified eligible without auto-review; same-area blocks and routes to office review; different-area-only does not block.
