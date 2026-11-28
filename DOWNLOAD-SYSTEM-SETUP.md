# J.A.R.V.I.S. Download System Setup

This update adds a GitHub Actions worker, temporary runner storage, FFprobe/FFmpeg validation and splitting, an authenticated Railway delivery endpoint, WhatsApp document delivery, and Supabase job history. It does not alter the existing Baileys authentication volume.

## 1. Supabase

Run `supabase/migrations/202611280001_download_jobs.sql` in the SQL Editor of the existing `whatsapp-bot` project. The table is service-role-only; no public RLS policies are created.

## 2. Railway private variables

Add these variables to the existing `Jarvis-movie-bot` service in production. Do not paste their values into chats or commit them to GitHub.

- `MOCHI_API_KEY` — a newly rotated provider API key. The earlier key was exposed and should not be reused.
- `GITHUB_ACTIONS_TOKEN` — a fine-grained GitHub token restricted to `flashstore-lk/Jarvis-movie-bot`, with **Actions: Read and write** permission.
- `GITHUB_REPOSITORY` — `flashstore-lk/Jarvis-movie-bot`
- `GITHUB_BRANCH` — `main`
- `DOWNLOAD_WORKFLOW` — `download-worker.yml`
- `DOWNLOAD_DELIVERY_TOKEN` — a new long random secret (at least 32 random bytes; generate privately).

Keep all existing Railway variables, especially `OWNER_JID`, `SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_STORAGE_DRIVER`, and `SESSION_ID`. Do not change the `/app/auth_info` volume mount.

## 3. GitHub Actions repository secrets

In GitHub → Settings → Secrets and variables → Actions → New repository secret, add:

- `RAILWAY_DELIVERY_URL` = `https://jarvis-movie-bot-production.up.railway.app/internal/download-delivery`
- `RAILWAY_DELIVERY_TOKEN` = exactly the same secret value as Railway's `DOWNLOAD_DELIVERY_TOKEN`.

The workflow has `contents: read` only. The Railway-side GitHub token is used only to dispatch this workflow.

## 4. Upload and deploy

Upload the updated project files to the repository root, preserving the `.github` folder. The existing Railway GitHub integration will build the new `main` commit. Wait for a Railway deployment state of `SUCCESS` before testing.

## 5. WhatsApp usage

1. Search a movie with `.mv Movie Name`.
2. Reply with the search result number to open the CineSubz movie details.
3. Reply directly to that movie-details message with the quality number shown in the list. The final number is `ALL QUALITY` and queues every listed quality. No `.download` command is needed.
4. The GitHub worker downloads into its temporary runner workspace, validates the media, splits large video files with FFmpeg where possible, and uploads each part to the authenticated Railway endpoint.
5. Railway sends the file to the originating private chat or group using the existing WhatsApp session. Group requests require Owner/Admin permission `download:request`. The Owner can grant it with `.settings 36 A 947XXXXXXXX download:request` and revoke it with `.settings 36 B 947XXXXXXXX download:request`.

Download choices are tied to the exact movie-details message you reply to and are kept in memory for 20 minutes; reopen the movie details if they expire. GitHub runner files are deleted at the end of every job. Railway receives each part only long enough to send it; no permanent movie-file storage is added.

## Limits and safety

- Only HTTPS links are accepted. Private-network destinations and redirects to private hosts are rejected.
- Source files are limited to 1.5 GiB; individual Railway delivery parts are limited to 60 MiB.
- Large videos are split using stream-copy in Matroska containers. If FFmpeg cannot safely split a source, the job reports a failure instead of silently corrupting it.
- The existing adult-content filter remains enabled. The system is intended only for media the operator/provider is authorized to distribute.
- A successful GitHub workflow dispatch means the job was queued, not that WhatsApp delivery succeeded. Final status is sent by the worker callback.
