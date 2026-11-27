# J.A.R.V.I.S. Movie Bot — Full Project Update

## What changed in this update

- Fixed Self-Chat processing: messages from the linked account are accepted only when the chat is the linked account's own Self-Chat.
- Added runtime Chat Mode handling through Setting `01`:
  - `public`: private chats, including Self-Chat; groups are ignored.
  - `private`: only the linked account's Self-Chat.
  - `group`: groups only. The Owner can still use `.settings` from Self-Chat to change the mode.
- Group messages use the participant JID as the actor identity while replies are sent to the group chat.
- Owner/Admin checks for `.settings` use the sender identity, not the reply destination.
- Normalized phone-number JIDs so `947XXXXXXXX` and `947XXXXXXXX@s.whatsapp.net` compare consistently.
- Optimized the 55-setting panel to fetch stored values in one Supabase request instead of 55 sequential requests.
- Setting `06` / `40` (`auto_react`) now controls the processing reaction.
- Added `.settings` to the maintenance-mode command allowlist so the Owner can turn maintenance mode off.
- Fixed discovery pagination state so `A - More...` works for `.popular`, `.trending`, `.top`, and `.upcoming`.

## Chat Mode commands

Open the panel:

```text
.settings
```

Change the mode using Setting `01`:

```text
.settings 01 A
```

- `A` = public
- `B` = private
- `C` = group

The Owner is configured using the private Railway variable `OWNER_JID`, preferably in this format:

```text
947XXXXXXXX@s.whatsapp.net
```

Do not share the value in chat or commit it to GitHub.

## Deployment

1. Replace the files in your GitHub repository with the files from this ZIP, preserving the folder structure.
2. Confirm Railway environment variables are still configured:
   - `DASHBOARD_USER`
   - `DASHBOARD_PASSWORD`
   - `TMDB_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OWNER_JID`
3. The Supabase migration already included in `supabase/migrations/` should remain in the repository. If it has not been run yet, execute it in Supabase SQL Editor.
4. Railway should build with `npm run build` and start with `npm start`.

## Important notes

- Existing pairing website, Baileys authentication/session storage, Supabase schema, and Railway configuration are preserved.
- Favorites and Watchlist require the included Supabase migration.
- Movie and TV details are metadata from TMDB. This project does not add unauthorized movie-file downloading.
- Several settings in the 55-item panel are stored in Supabase but still need separate runtime integrations. The panel does not mean every listed automation feature is already active.
