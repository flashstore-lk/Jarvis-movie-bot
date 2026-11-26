# J.A.R.V.I.S. Movie Bot — Free-plan update

This update is designed to keep the existing project structure and existing
Railway/Supabase deployment. It does not create a new project and does not
change your linked WhatsApp session format.

## Files in this ZIP

Copy these files into the matching paths in your existing repository:

- `src/bot/commands.ts`
- `src/bot/safety.ts`
- `src/services/media-provider.ts`
- `.env.example`
- `supabase/schema.sql`

Do not delete other source files.

## What this update changes

- Sends poster images through the same bounded outbound queue as text messages.
- Fixes the missing-rating output (`N/A/10`).
- Adds title relevance ranking to TMDB search results.
- Limits search query length and selection index input.
- Adds `.status`.
- Preserves TMDB adult-content filtering.
- Keeps media file delivery disabled unless an authorized distributor is configured.
- Adds the missing `jarvis_auth_state` Supabase table used by `src/bot/auth-store.ts`.

## Supabase setup

1. Open the existing `whatsapp-bot` Supabase project.
2. Open SQL Editor.
3. Run the updated `supabase/schema.sql`.
4. Do not share or commit the service-role key.

If the tables already exist, the script uses `create table if not exists`.

## Railway Variables

Keep your existing values. Confirm these are present:

- `PORT` (Railway normally injects this; do not hardcode a public port)
- `DASHBOARD_USER`
- `DASHBOARD_PASSWORD`
- `PAIRING_API_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_STORAGE_DRIVER=supabase`
- `SESSION_ID=jarvis-primary`
- `SESSION_SECRET`
- `TMDB_API_KEY`

`SESSION_SECRET` must be a 32-byte key represented as 64 hex characters or Base64.
Never paste secrets into GitHub or a chat.

## Build locally before upload

```bash
npm ci
npm run typecheck
npm run build
```

After those pass, upload the replacement files to the existing `main` branch.
Railway should deploy from the connected repository.

## Free-plan note

This update does not download or retain movie files on Railway. It only handles
metadata and WhatsApp text/poster responses. Railway usage and free-plan quotas
can change; check the Railway Usage page for the current limits.

Do not use this project to download or redistribute copyrighted media unless
you have explicit permission from the rights holder or an authorized provider.
