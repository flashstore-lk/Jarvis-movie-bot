import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';

export function createDashboard() {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  const auth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const header = req.headers.authorization ?? '';
    const expected = 'Basic ' + Buffer.from(`${env.DASHBOARD_USER}:${env.DASHBOARD_PASSWORD}`).toString('base64');
    if (header !== expected) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Movie Assistant Admin"');
      res.status(401).send('Authentication required');
      return;
    }
    next();
  };

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'whatsapp-movie-assistant' }));
  app.get('/', auth, (_req, res) => {
    res.type('html').send(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Movie Assistant Admin</title>
<style>
body{font-family:system-ui;background:#0b1020;color:#e8efff;margin:0;padding:28px}
main{max-width:760px;margin:auto}.card{background:#151e33;border:1px solid #263653;border-radius:16px;padding:22px;margin:14px 0}
h1{color:#54d8ee}small{color:#9eb0cc}.pill{color:#8df0c2}
</style></head><body><main><h1>WhatsApp Movie Assistant</h1>
<p class="pill">Admin console • v1.0 starter</p>
<div class="card"><h2>Service status</h2><p>Backend is running.</p><p><small>WhatsApp pairing QR is printed in the hosting logs during first startup.</small></p></div>
<div class="card"><h2>Configuration</h2><p>Provider: ${env.MEDIA_PROVIDER}</p><p>Supabase: ${env.SUPABASE_URL ? 'Configured' : 'Not configured'}</p><p>Media delivery stays disabled until an authorized provider adapter is implemented.</p></div>
<div class="card"><h2>Next setup steps</h2><ol><li>Configure environment variables.</li><li>Use persistent storage for <code>auth_info/</code>.</li><li>Connect Supabase using <code>supabase/schema.sql</code>.</li><li>Implement and verify an authorized media provider.</li></ol></div>
</main></body></html>`);
  });
  return app;
}
