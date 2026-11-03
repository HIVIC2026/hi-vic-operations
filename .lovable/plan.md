# Team members: mobile, email and date of birth required for everyone

Note: the version built at 2:37pm already requires mobile + date of birth for installers, and mobile + date of birth + email for electricians. The only change left is to make **email required for installers too**.

## 1. Form and server changes
- One shared rule: every new team member (installer or electrician) needs an Australian mobile, an email and a date of birth.
- Team page "Add" form: email box marked required; the Add button explains what is missing.
- Server refuses the add on every path (business Team add, office add, the installer Team add database step) with plain wording:
  - "Add an Australian mobile (04xx xxx xxx)."
  - "Add an email address."
  - "Add their date of birth."
- Date of birth stays private, as now.

## 2. Other ways a worker gets added
- Office add and business Team add: covered above.
- Worker's own sign-up link: has an email, but doesn't ask for date of birth — the prompt shows afterwards (still open, not changed).
- No bulk import of workers exists.

## 3. Existing live workers now also missing an email (no data changes)
Installers with no email:
- RAPID INSULATION (22): Anthony Nguyen, Austin Field, Damon Langley, Damon Leonard, Dylan Ashfield, Finn Easdale, Gabriel Buchanan, George Bacolas, Harrison Bell, James Murray, Jarrell Seth, Joseph Calarco, Leroy Robins, Liam Zontanos, Louis Booker, Louis Lunn, Madhik Wooden, Mark Forday, Nathaniel Winters, Sebastian Semercioglu, Yaqub Daghistani, Yewan Kospelawatta.
- Reinsulate: Wayne Fletcher.

The earlier list of missing mobiles/dates of birth still stands. The Team page prompt adds email, e.g. "Add Wayne's mobile and email". Still open: there is no box on the Team page yet to fill in a missing date of birth or email.

## 4. Tests
- Installer with no email is refused; with all three it's accepted.
- Electrician rules unchanged (all three required).
- Prompt wording includes email for installers.
- Re-run Team tests and typecheck. No sends, no publishing.
