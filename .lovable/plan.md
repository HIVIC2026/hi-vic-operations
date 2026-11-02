# Safety check: owner always $349, HIV pays electrician $275

## a) Where Orlando's $350 comes from
Two saved prices, both $350:
- **Reinsulate's own price list** (version 2, from 30 Oct) has a safety-check line of $318.18 + GST = **$350**. Because Reinsulate pays its own electricians, the owner's quote uses this line. This is what HV-3193's preview used.
- **ORLANDO POWERED's saved electrician rate** is **$350** ("Agreed with Reinsulate 29 Oct – PIESA paid to Reinsulate"). Orlando's own price list also has $318.18 + GST = $350.

Every way the owner's safety-check price can differ from $349 today:
1. Installer pays its own electricians (or in-house) → the installer's own price-list safety-check line (Reinsulate $350).
2. Installer's usual / approved electrician → that electrician's saved rate (Orlando $350).
3. Installer typed a "different electrician" price on a Mitti/older job → that typed price.
4. HIV website leads → the $349 site setting (correct; could be changed by editing the setting).

## b) What the electrician is paid now
- **HIV jobs:** each electrician's own saved rate — Tom Lowe $349, Orlando $350 (TEST electricians $200/$205). The fallback "standard electrician cost" setting is **empty**. **Nothing pays $275 today.**
- **Installer jobs:** the same saved rate is used if HIV pays; if the installer pays its own electrician, HIV pays the installer and the installer pays the electrician (no amount set by us).
- Set in: the office electrician-rates screen (one rate per electrician) and each business's price list.

## c) The fix
1. **One owner price:** the safety-check line on every owner quote (installer jobs and HIV jobs) always comes from the single $349 setting. Installer price lists, electrician rates and typed prices no longer change what the owner pays.
2. **HIV jobs payout $275:** on HIV website-lead jobs, the electrician payout and the Money/profit screens use $275 inc GST, whichever electrician does it. Stored as one office setting (filled with $275), not per electrician.
3. **Orlando's fee:** correct Orlando's saved rate and the $350 lines (Orlando's and Reinsulate's price lists) through the normal office rate screens, with reason "Jo 3 Nov: safety check $349". Separate data step after the build, only with Jo's OK, showing before/after.

**Question for Jo (not decided) — installer jobs:**
- My assumption: owner pays $349 to HIV; HIV passes the full $349 to the installer, who pays their own electrician (Reinsulate → Orlando). 
- Alternatives: HIV pays the electrician $275 directly on installer jobs too; or HIV pays the electrician their agreed rate. I will ask with choice boxes before building that part.

## d) Live jobs and quotes affected (no changes made)
- Open real quotes with a safety-check line other than $349: **none**.
- **HV-3193** (Reinsulate) preview would show $350 — stays unchanged as Jo asked; the fix would make any new draft show $349.
- Pending safety-check offer: **HV-3682** (Tom Lowe, $349 rate shown, HIV job) — under the new rule his payout would be $275, not $349. Flag for Jo: this offer was already shown to Tom at $349.
- Price lists with $350: Reinsulate (real), [TEST PARTNER] Reinsulate (test, left alone), ORLANDO POWERED.

## e) Tests (written first)
- Owner safety check = $349 for: HIV lead; installer job with own electricians (Reinsulate $350 list); usual electrician with $350 rate; typed different-electrician price.
- HIV job payout = $275 whatever the electrician's saved rate; Money/profit screens agree.
- Installer job payout follows Jo's answer.
- Accepted/issued quotes keep their recorded amounts (no silent change).
- TEST jobs and two-business separation unchanged.

## Not included
No sends, publishing, or data changes. Installer agreement wording unchanged. HV-3193 untouched.
