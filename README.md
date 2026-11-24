# WhatsApp Movie Assistant — v1.0 starter

A hosting-independent Node.js/TypeScript starter with a Baileys private-chat bot,
a password-protected admin status page, optional Supabase search history, Docker
support, and an explicit authorized-media-provider interface.

## Important limitations

- The media provider is **disabled by default**. Implement `AuthorizedMediaProvider`
  only for files you own or have documented distribution rights to.
- This starter does not scrape or redistribute third-party commercial movie files.
- 18+ / R / NC-17 / TV-MA results are filtered by default.
- Baileys is an unofficial WhatsApp Web integration. It may be incompatible with
  WhatsApp changes and may carry account/terms risks. Use an account you are
  authorized to operate and review WhatsApp's terms.
- Use persistent storage for `auth_info/`; losing it may require pairing again.

## Local setup

1. Install Node.js 22 or newer.
2. Copy `.env.example` to `.env`.
3. Set `DASHBOARD_PASSWORD` (16+ chars) and `SESSION_SECRET` (32+ chars).
4. Optionally configure Supabase values and run `supabase/schema.sql`.
5. Run:

   ```bash
   npm install
   npm run dev
   ```

6. Scan the QR code shown in the server logs using the WhatsApp account's
   Linked Devices screen.
7. Open `http://localhost:3000` and sign in using the dashboard credentials.

## Docker

```bash
cp .env.example .env
docker compose up --build -d
docker compose logs -f
```

The compose file uses a named volume for WhatsApp session persistence.

## Hosting

Any host that supports a long-running Node.js process or Docker container,
outbound WebSocket connections, and persistent storage can run this app.
For ephemeral/container hosts, attach a persistent disk to `/app/auth_info`.
Do not deploy this as a serverless function: the WhatsApp socket needs a
long-running process.

## Supabase

Create a Supabase project, run `supabase/schema.sql` in the SQL editor, then set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The service-role key is server-only. Never commit `.env` or expose this key.

## Provider integration

Implement the `AuthorizedMediaProvider` interface in
`src/services/media-provider.ts` after confirming rights and the provider's
official API documentation. Keep API keys in environment variables, validate
provider responses, rate-limit requests, and avoid logging signed URLs.

## Admin dashboard

The current dashboard is a minimal authenticated status/configuration page.
It is a starter, not a finished user-management console. Add role-based admin
accounts, CSRF protection, audit logging, and secure session cookies before
exposing sensitive admin actions publicly.
