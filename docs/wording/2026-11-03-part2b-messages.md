# Part 2b messages (installers add their own electricians)

The two real messages (1 and 2) were approved by Jo on 3 Nov 2026, exactly as written, and their flags are now ON in code: the welcome text sends through the normal text sender and the rejection email goes to real installer offices through `sendOfficeEmail` (both still sit behind the usual switches — `customer_comms_enabled`, the per-type text switch, the trade-messages pause). Everything else is on-screen words with no approval flag, listed so you can check the words. Placeholders in {braces} are filled in by the portal.
Wording below is copied exactly from the code.

Installer offices are emailed, never texted. The electrician gets one text (no login).

---

## 1. Welcome text to the electrician

Approved by Jo 3 Nov 2026.

- Code: `welcomeSmsText` in `src/lib/my-electricians.core.ts` (sent from `officeApproveInstallerElectrician` in `src/lib/my-electricians.server.ts`)
- Channel: text
- Goes to: the electrician the installer added, once, when the Home Insulation Victoria office approves them. Never sent again for the same electrician.
- Approval flag: SMS type `installer_added_electrician_welcome` has `wordingApproved: true` in `src/lib/sms.core.ts` (flipped 3 Nov 2026). While it was `false` the text was held and the held attempt recorded on the texts list as "blocked: Wording not approved yet". Note: electricians approved before the flip will NOT get the text sent later (the held attempt counts as handled).
- {first} is the electrician's first name (or "there" if blank); {installer} is the installer's business name (or "your installer").

```
Hi {first}, {installer} has added you as their electrician with Home Insulation Victoria. They'll send you jobs to book. Cheers, the Home Insulation Victoria team
```

## 2. Rejection email to the installer office

Approved by Jo 3 Nov 2026.

- Code: `rejectionEmail` in `src/lib/my-electricians.core.ts` (sent from `officeRejectInstallerElectrician` in `src/lib/my-electricians.server.ts` through `sendOfficeEmail`)
- Channel: email
- Goes to: the installer's office email, when the office clicks Reject on the electrician they added and types a reason
- Approval flag: `REJECTION_EMAIL_APPROVED = true` in `src/lib/my-electricians.core.ts` (flipped 3 Nov 2026). While it was `false`, real installers got nothing and the hold was written on the event ("held: wording not approved yet"); TEST installers always got the email.
- {name} is the electrician's name (or "Your electrician"); {reason} is what the office typed

Subject:
```
{name} wasn't approved
```
Body:
```
{name} wasn't approved: {reason}. Fix it in My electricians.
```

## 3. Office Needs me lines (shown to the Home Insulation Victoria office)

Not emails or texts. Lines in the Needs me "system" list, tag "Partner", button "Open" (opens the electrician's business page). Code: `approveElectricianLine` and `finishApprovingElectricianLine` in `src/lib/my-electricians.core.ts`, built by `pendingInstallerElectricianItems` in `src/lib/my-electricians.server.ts`. No approval flag (office-only).

| When | Exact line |
|---|---|
| An installer added an electrician and the office hasn't approved or rejected them yet | `Approve electrician {electrician} — added by {installer}` |
| The office approved them but a step didn't finish (person approval, portal profile, installer link, or the welcome text not recorded) | `Finish approving electrician {electrician} — added by {installer}` |

If the electrician's name is blank it reads "name not given"; if the installer's name is blank it reads "an installer". A held welcome text counts as recorded, so the hold alone does not raise the "Finish approving …" line.

## 4. Office card on the electrician's business page

On-screen words, no approval flag. Code: `InstallerElectricianCard` in `src/routes/_authenticated/admin.partners_.business.$businessId.tsx`.

- Panel title: `Added by {installer}`
- Works for: `{installer} only · not offered Home Insulation Victoria's own leads · no agreement needed`
- Status pill: `Approved` / `Not approved` + the reason / `Paperwork expired` / `Waiting for approval`
- Checks (all good): `Paperwork complete and in date`
- Checks (half-done approval): `Approved, but not finished — the electrician's approval, their portal profile, the installer's link or the welcome text is still missing. Finish approval completes it.`
- Buttons: `Approve`, `Reject`, `Finish approval`
- Under a blocked Approve: `Approve unlocks when every check passes. There is no override.`
- Reject dialog: title `Not approving this electrician?`, description `The installer sees this reason in My electricians and can fix it and resubmit.`, box hint `What needs fixing`, button `Reject`
- Toasts: `Electrician approved`, `Approval finished`, `Not approved — the installer has been told`

Checklist reasons (`approveChecklist` in `src/lib/my-electricians.core.ts`), one line each:
`REC number is missing` · `Licence number is missing` · `Licence photo is missing` · `Licence expiry is missing` · `Licence has expired` · `Public liability certificate is missing` · `Public liability is under $5 million` · `Public liability expiry is missing` · `Public liability has expired` · `WorkCover certificate is missing` · `WorkCover expiry is missing` · `WorkCover has expired`

## 5. Installer's "My electricians" screen

On-screen words, no approval flag. Code: `src/components/trade/my-electricians.tsx`, `src/routes/_authenticated/field.business_.electricians.tsx`, `statusChip` in `src/lib/my-electricians.core.ts`.

Link on My business (`src/routes/_authenticated/field.business.tsx`):
```
My electricians
Add electricians for your own jobs and see where each one stands
```

Page title and intro line:
```
My electricians
Electricians you add for your own jobs. Home Insulation Victoria checks their paperwork before they're approved.
```
Non-installer business sees: `Only installer businesses add their own electricians.`

List heading `On your list`. Empty list: `Nobody yet. Add your electrician below.`
Each row shows the name, then `Licence to {date} · Public liability to {date}` (or `No licence expiry on file` / `No public liability on file`).

Status chips (`statusChip`):

| Status | Chip |
|---|---|
| approved | `Approved` (green) |
| waiting | `Waiting for approval` (blue) |
| expired | `Expired — update their documents` (pink) |
| not approved | `Not approved: {reason}` (pink). If no reason: `Not approved: ask Home Insulation Victoria` |

A not-approved row also has a `Fix and resend` link.

Add form intro (under the heading `Add an electrician`):
```
Electricians you add here can do the safety check (PIESA) and electrical upgrades on your own jobs. Home Insulation Victoria checks their paperwork before they're approved. Electricians who join through here only work on your jobs — they aren't offered Home Insulation Victoria's own leads.
```
WorkCover question: `Does this electrician employ anyone, including themselves through a company?` with the tick `Sole trader with no staff — no WorkCover needed`. Buttons `Add electrician` / `Cancel`; while working `Uploading files…` / `Adding…`.

Fix and resend form: heading `Fix and resend`, shows `Not approved: {reason}`, note `Upload every document again, even the ones that were fine.`, button `Send again` (`Sending…`).

Toasts after sending:
- New electrician: `{name} added. Home Insulation Victoria will check their paperwork.`
- Already approved with Home Insulation Victoria: `{name} is already approved with Home Insulation Victoria — added to your list.`
- Resend: `{name} sent again. Home Insulation Victoria will check their paperwork.`

Form checks (`addElectricianProblems`), shown under the field:
`Add their name` · `Add their email` · `Add their mobile` · `Add their REC number` · `Add their licence number` · `Licence expiry must be in the future` · `Add a photo of their licence` · `Add the public liability certificate` · `Public liability must be at least $5 million` · `Public liability expiry must be in the future` · `Add the WorkCover certificate` · `WorkCover expiry must be in the future` · `Tick that they're a sole trader with no staff` · `Answer the WorkCover question`

## 6. Installer-facing refusal messages (when an add can't go ahead)

On-screen errors on the add form, no approval flag. Code: `decideMatch` and the primary-key clash branch of the add in `src/lib/my-electricians.server.ts`.

| When | Exact message |
|---|---|
| The electrician is already on this installer's list (waiting, or already linked) | `Already on your list` |
| Another installer added the same electrician and the office hasn't decided yet | `This electrician is already waiting for approval` |
| This installer's own electrician was rejected | `Not approved: {reason}. Fix it in My electricians.` |
| Another installer's electrician was rejected, or the existing record isn't a live pending one | `This electrician can't be added right now — contact Home Insulation Victoria` |
| The electrician is approved but their licence, public liability or WorkCover has lapsed | `Their paperwork has expired. Ask them to update it with Home Insulation Victoria.` |
| Fix and resend on someone not rejected | `They're still waiting for approval — nothing to fix yet.` |
| Fix and resend on someone already approved | `They're already approved — nothing to resubmit.` |
| Fix and resend on someone not theirs | `This electrician isn't on your list.` |

Office-side errors (same file): `Give a reason for not approving them.` · `This electrician wasn't added by an installer.` · `Already approved.` · `Approved, but the electrician's login could not be approved ({error}). Click Approve again to finish.` · `Approved, but the electrician's portal profile could not be set up ({error}). Click Approve again to finish.` · `Approved, but the installer's link could not be switched on. Click Approve again to finish.` · `Approved, but the welcome text couldn't be sent ({error}). Click Approve again to retry it.`

## 7. Add a job: electrician pick

On-screen words, no approval flag. Code: `src/components/trade/add-job-flow.tsx`, `ELECTRICIAN_CARD` in `src/lib/add-job-flow.core.ts`, `src/lib/electrician-choice.core.ts`.

Every approved electrician linked to the installer is offered. The usual one (from My business) is first and preselected, labelled `My usual electrician ({name})`; the rest show by name.

Empty-list hint (nobody approved to pick), unchanged words from Part 2, now shown whenever the list is empty:
- Usual electrician set but not approved yet: `{name} can be picked here once they finish onboarding with Home Insulation Victoria.`
- No usual electrician: `To use your own electrician, add them under My business first.`

Save-time problems (`electrician-choice.core.ts`): `Choose who does the electrical safety check.` · `Add your usual electrician under My business › Electrician first.` · `That electrician isn't on your list.` (new in Part 2b)

---

Not new in Part 2b, so not listed above: the electrician's link text and the office emails once a job is handed over (Part 2, `docs/wording/2026-11-03-part2-messages.md`) work the same for an installer-added electrician.
