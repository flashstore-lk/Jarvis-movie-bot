import express from "express";

import { env } from "./config/env";
import dashboard from "./dashboard";
import pairing from "./pairing";

import { startWhatsApp } from "./bot/connection";

const app = express();

app.disable("x-powered-by");

app.use(
  express.json({
    limit: "32kb"
  })
);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "jarvis-movie-bot"
  });
});

app.use("/admin", dashboard);
app.use("/pairing", pairing);

app.listen(env.port, () => {
  console.log(
    `Server listening on port ${env.port}`
  );

  void startWhatsApp().catch(error => {
    console.error(
      "WhatsApp startup failed:",
      error
    );
  });
});
