
# J.A.R.V.I.S. WhatsApp Movie Bot

WhatsApp bot starter built with:

- Node.js
- TypeScript
- Baileys
- Supabase
- Express
- Docker

## Requirements

- Node.js 20+
- Supabase project
- Persistent Node.js hosting

## Installation

Install dependencies:

```bash
npm install
```

Create your environment file:

```bash
cp .env.example .env
```

Configure your environment variables.

Run TypeScript checks:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

Start:

```bash
npm start
```

Development:

```bash
npm run dev
```

## Supabase

Run the SQL in:

supabase/schema.sql

Use the Supabase service role key only
as a server-side environment variable.

Never upload real secrets to GitHub.

## WhatsApp

The first connection displays a QR code
in the server logs.

Scan it using a separate test account.

Persist the auth_info directory between
restarts.

## Dashboard

Open:

/admin

The dashboard uses HTTP Basic Authentication.
Use HTTPS and a strong password.

## CineSubz integration

Set `MOCHI_API_KEY` as a private Railway environment variable.
Movie search and movie details use CineSubz only. TV search and movie
discovery commands continue to use TMDB. Authorized download requests
are dispatched to the GitHub Actions worker, validated and processed in
temporary runner storage, then delivered by the existing Railway
Baileys session. See `DOWNLOAD-SYSTEM-SETUP.md` for the required Railway
variables, GitHub Actions secrets, and Supabase migration.

`TMDB_API_KEY` remains required for TV search and discovery commands.
The adult-content filter remains enabled.

## Important

Baileys is an unofficial WhatsApp Web integration.
Review WhatsApp's terms and account risks before use.

Only connect media providers and distribute
content when you have the required permission.
