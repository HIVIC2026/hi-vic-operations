# How trades get Mitti (decision 331, Jo 25 Oct 2026)

Mitti is built on SafetyCulture. The portal makes every job form (A1–A5) in **our** Mitti organisation and shares it with
the trade's Mitti user by email (`shareAudit` + owner change in `mitti.server.ts` / `fixes-day.server.ts`). So every
trade who fills a form needs a Mitti user in our organisation, with the exact email the portal holds.

## What happens automatically

| When (in the portal) | What the portal does in Mitti | Record (`admin_config_events`) |
|---|---|---|
| Office approves an electrician, or verifies an installer's CII | Searches Mitti by email (`POST /users/search`) | — |
| …found | Links the user on the profile (`mitti_user_id`), adds them to the **HIV trades** group | `mitti_user_linked` |
| …not found | Creates the user (seat from `MITTI_SEAT_FOR_ROLE`, lite), adds the group, then sends ONE message (text if they have a mobile, else email) | `mitti_user_invited` (recorded before the message) |
| Person removed from the business, or rejected | Deactivates the Mitti user the portal invited or linked (not if the same email is an active trade elsewhere) | `mitti_user_deactivated` |
| Approved again later | Reactivates the same Mitti user (never a second seat) | `mitti_user_reactivated` |
| Anything fails | Nothing else is tried; ONE item on Staff approvals with the plain reason | `mitti_access_failed` |

The message (route approved by Jo; SMS type `mitti_invite`, through `sendRealSms` or `sendOfficeEmail`, so the master
switch, the type's own switch, quiet hours, STOP and business approval all apply):

> You've been invited to Mitti, the app you'll use for Home Insulation Victoria job forms. Check your email from Mitti, set your password, and download the Mitti app.

TEST people (`@hivic.test` and other test addresses, TEST partners) are always skipped. Mitti rejects synthetic emails,
and TEST forms go to the test assignee.

Code: `src/lib/mitti-invite.core.ts` (pure rules), `src/lib/mitti-invite.server.ts`, hooked into worker approve, reject
and remove (`worker-links.functions.ts`) and CII verify (`worker-compliance.functions.ts`). Tests:
`tests/mitti-invite.core.test.ts`, `tests/mitti-invite.server.test.ts` (the Mitti client is mocked).

## Switches (all off today)

- `MITTI_AUTO_INVITE_ENABLED=true` (env) turns it on. When it is off, approvals and removals do nothing in Mitti.
- `MITTI_TRADES_GROUP_ID` (env) is the Mitti ID of the "HIV trades" group. Without it, people are not added to a group,
  and the Staff approvals item says so.
- `MITTI_USER_API_VERIFIED` (constant in `mitti-invite.core.ts`, false). Until a developer has run one probe with the real
  token, the portal only searches and links. No user is created, added to a group or deactivated: the office gets
  "invite needed" or "deactivate by hand" items instead.

## The Mitti API (sources)

The developer site could not be opened from the build environment. The endpoints below come from the public reference
pages, read through search, and must be confirmed on the probe:

- Search users: `POST /users/search` `{ "email": ["…"] }` (already in use).
- Create a user (legacy, marked deprecated but live): `POST /users`
  `{ firstname, lastname, email, password, seat_type }`. Mitti ignores the password if the user already exists. The portal
  sends a throwaway password and never stores it. The docs list `seat_type` as `free`/`full`, and whether `lite` is
  accepted here must be confirmed. https://developer.mitti.com/reference/thepubservice_adduser
- Bulk alternative: the create-or-update users job (`/users/v1/users/upsert/jobs…`), which needs the "Platform
  management: Users" and "Permissions" permissions and a full seat for the token user.
  https://developer.safetyculture.com/reference/usersservice_startcreateorupdateusersjob ·
  https://developer.mitti.com/reference/usersservice_initcreateorupdateusersjob
- Add a user to a group: `POST /groups/{group_id}/users` `{ "user_id": "…" }`. The user must already be in the organisation.
  https://developer.mitti.com/reference/thepubservice_addnewusertogroup
- Update a user (status/seat): `PUT /users/{user_id}`. The portal sends `{ "status": "inactive" }` or `{ "status": "active" }`.
  https://developer.safetyculture.com/reference/thepubservice_updateuser
- User provisioning (SCIM supports full, lite and guest seats; just-in-time provisioning supports full seats only):
  https://developer.mitti.com/docs/automate-user-management-with-user-provisioning
- API access needs a Premium or Enterprise plan and a service-user or user API token.

**Probe checklist** (developer, real token, a real non-synthetic address):

1. Create the user and check the seat type in Mitti.
2. Check that Mitti emails them to set a password. If it does not, switch to the upsert job or the "Require password
   reset" option.
3. Add them to the group.
4. Share one test form and complete it on the lite seat.
5. Deactivate the user.

Then set `MITTI_USER_API_VERIFIED = true`.

## Seats and cost (what Jo must check in the Mitti admin)

- **Seat types** (https://help.safetyculture.com/001741):
  - **Full**: unlimited.
  - **Lite**: can START 1 inspection a month on monthly billing, or 12 a year on annual billing. Training is full;
    administration and inspections are limited.
  - **Guest**: can START 3 inspections over the seat's lifetime. People invited by link or email get a guest seat by default.

  The caps count inspections a person **starts**. The portal starts the forms and shares them, and we believe editing and
  completing a shared form does not count, but no source confirms it. **Confirm on the probe.**
- **Installers who start their own A1 in Mitti** (Mitti-first pickup) start inspections themselves. On a lite seat that is
  one a month, so busy installers may need **full** seats. Electricians (A3/A4 are always made by the portal) should be
  fine on lite. Jo decided Lite for all trades (decision 340, below).
- **Cost:** lite seats have been quoted at about $5 per user per month on paid plans (third-party review). Full seats cost
  much more. Adding or changing seats is charged pro rata to the end of the billing period
  (https://help.safetyculture.com/000130). Changing seat types needs a Premium or Enterprise plan
  (https://help.safetyculture.com/001742).
- **Licence count:** if automatic seat purchasing is ON, every new trade buys a seat. If it is OFF, creating a user beyond
  the licence count fails, and the office sees a "could not create" item. **Deactivating a user frees the seat but does
  NOT reduce the seat count or the bill** (https://help.safetyculture.com/000046). Jo or the office must lower the licence
  count in the Mitti admin if the seat will not be reused.
- **Templates:** share the A1–A5 templates once with the **HIV trades** group, so group members can open them (needed for
  installers who start A1 themselves).

## Decided — Decision 340 (Jo, 25 Oct 2026)

- **Seat type:** Lite seats for trades — installers and electricians alike (`MITTI_SEAT_FOR_ROLE` = lite for both).
- **Who pays: we pay.** Home Insulation Victoria pays for every trade seat (`MITTI_SEATS_PAID_BY`). Seats are not charged
  back to the partner business, and nothing in the portal bills a trade for Mitti access.

## Still for Jo

1. **Licence count / auto-purchase:** whether new trades may buy seats automatically, or the office keeps a fixed count.
2. When the probe has passed, switch on `MITTI_AUTO_INVITE_ENABLED` and set `MITTI_TRADES_GROUP_ID`.
