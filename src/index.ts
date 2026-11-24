import { env } from './config/env.js';
import { createDashboard } from './dashboard.js';
import { startWhatsApp } from './bot/connection.js';

const app = createDashboard();
app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`Dashboard listening on port ${env.PORT}`);
});

startWhatsApp().catch((error) => {
  console.error('WhatsApp startup failed:', error);
  process.exitCode = 1;
});
