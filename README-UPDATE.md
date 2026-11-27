# J.A.R.V.I.S. Movie Bot — Feature Update

## Files
Copy the `src/` directory files into the same paths in your repository. Add the SQL migration file under `supabase/migrations/`.

## Railway Variables
Add `OWNER_JID` as a private Railway variable. Format: `947XXXXXXXX@s.whatsapp.net` (your own WhatsApp number with country code; do not share it in chat).
Existing variables remain required: `DASHBOARD_USER`, `DASHBOARD_PASSWORD`, `TMDB_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Supabase
Run `supabase/migrations/202611270001_bot_features.sql` in Supabase SQL Editor.

## Commands
`.mv`, `.tv`, `.id`, `.popular`, `.trending`, `.top`, `.upcoming`, `.fav`, `.watchlist`, `.help`, `.menu`, `.status`, `.ping`, `.about`, `.settings`.

## Admin
Owner only:
`.settings admin add 947XXXXXXXX`
`.settings admin remove 947XXXXXXXX`
`.settings maintenance on|off`

Owner and authorized Admin:
`.settings welcome <message>`
`.settings welcome reset`

New Admins are granted only `settings:welcome` permission by default. The Owner is configured using Railway `OWNER_JID`.

## Notes
- Existing `connection.ts`, `state.ts`, `safety.ts`, pairing/session files and package dependencies are unchanged.
- Favorites and watchlist need the SQL migration.
- Movie/TV metadata uses TMDB. This update does not add unauthorized movie file downloads.
- After copying files, run `npm run typecheck` and `npm run build` before deploying.
