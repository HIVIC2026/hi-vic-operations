# Recovery paths, part 2: findings waiting for their own design

Jo, 5 Nov 2026: these go in a second plan after the 20-step recovery plan. Each one still needs a design, spec and plan approved by Jo before any build.

1. **PIESA electrician + time change (installer portal, current booking form).** The form saves the new electrician first, then the time. If the time save fails, electrician B ends up on the old appointment and the installer only sees "Time could not be saved". Assigning can also send the electrician's job-link text and move the Mitti PIESA form. Reviewer's fix: save the person and time together, and only send the text / move the form once both are confirmed. Traced in code, and tested with a simulated booking failure. No live job checked yet.
