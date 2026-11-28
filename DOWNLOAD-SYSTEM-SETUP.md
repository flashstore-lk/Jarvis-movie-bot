# J.A.R.V.I.S. CineSubz + Download System Setup

This update restores CineSubz-only movie search for `.mv` and `.movie`, connects CineSubz movie details and authorized download-link resolution, and repairs the GitHub Actions → Railway → WhatsApp delivery code.

## 1. CineSubz search behavior

- `.mv <movie name>` and `.movie <movie name>` search the CineSubz API only.
- Search results are mapped from `data.movies[]` (`title`, `url`, `type`, `image`, `rating`, `badge`).
- Reply to a result number to load the CineSubz info endpoint.
- The movie details flow calls the CineSubz download resolver and displays its returned HTTPS links as quality/options.
- No TMDB fallback is used for `.mv` or `.movie`.
- TMDB remains in use for `.tv`, `.id`, `.popular`, `.trending`, `.top`, and `.upcoming`.

The configured API base is `https://mochi-apis.koyeb.app`; the key is read from the private Railway variable `MOCHI_API_KEY`.

## 2. Supabase migration

Run `supabase/migrations/202611280001_download_jobs.sql` in the SQL Editor of the existing `whatsapp-bot` project. This creates the `download_jobs` table with RLS enabled and no public policies. The backend uses the server-side service-role key.

## 3. Railway private variables

Keep existing variables and add/check:

- `MOCHI_API_KEY` — CineSubz API key; use a valid private value and do not commit it.
- `CINESUBZ_API_BASE_URL` — `https://mochi-apis.koyeb.app`
- `GITHUB_ACTIONS_TOKEN` — fine-grained GitHub token restricted to `flashstore-lk/Jarvis-movie-bot`, with Actions: Read and write.
- `GITHUB_REPOSITORY` — `flashstore-lk/Jarvis-movie-bot`
- `GITHUB_BRANCH` — `main`
- `DOWNLOAD_WORKFLOW` — `download-worker.yml`
- `DOWNLOAD_DELIVERY_TOKEN` — long random private secret.

Keep existing `OWNER_JID`, `SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_STORAGE_DRIVER`, and `SESSION_ID`. Do not change the `/app/auth_info` volume mount. Do not paste secret values into chat or commit them to GitHub.

## 4. GitHub Actions repository secrets

In `masterhub206-wq/jarvis` → Settings → Secrets and variables → Actions, verify:

- `RAILWAY_DELIVERY_URL` = `https://jarvis-movie-bot-production.up.railway.app/internal/download-delivery`
- `RAILWAY_DELIVERY_TOKEN` = the same secret value as Railway's `DOWNLOAD_DELIVERY_TOKEN`.

The worker repository and workflow must remain the separate `masterhub206-wq/jarvis` repository.

## 5. Deploy and test

1. Upload the changed files from this update to the `flashstore-lk/Jarvis-movie-bot` repository, preserving the folder paths.
2. Run the Supabase migration once.
3. Wait until Railway reports a new deployment as `SUCCESS`.
4. Test `.mv Deadpool`, reply to a result number, then reply to the movie-details message with a displayed quality number.
5. The final quality number selects all options.

A GitHub workflow dispatch only means the job was queued; final WhatsApp delivery is confirmed by the worker callback.

## 6. Runtime handling

The worker validates HTTPS sources, rejects private-network destinations, checks media responses, uses temporary runner storage, and sends files through the authenticated Railway endpoint. It removes its temporary workspace when the job ends. The bot records job state in Supabase. The existing adult-content filter and group Owner/Admin download permission checks are retained.
