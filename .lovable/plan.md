## Fix the one build error from PR #54 (only if Jo approves)

The merge is in, but the preview build stops on one type error in `src/lib/mitti-retry.server.ts` (line 108).

### Change
- In `mitti-retry.server.ts`, change the type of `BOOKING_KIND` from `Record<MittiFormKind, string>` to `Record<MittiFormKind, "ready_check" | "assessment" | "rectification" | "installation">`. The values and behaviour stay the same.

### Not included
- No cron schedule, no `MITTI_API_USER_ID` secret, no publishing, no data changes, no sends.

### Check
- Typecheck and build come back clean, and `src/routeTree.gen.ts` still lists `/api/public/hooks/mitti-retry`.
